/**
 * ADR-033 Guard: the authority route matrix. A core adjustment is recorded
 * only through the wellbeing hand-off, a manual proposal a second person
 * approved, or a migration batch a second person released.
 */
import { randomUUID } from 'node:crypto';

import { EVENT_TYPES, PERMISSION_ROLES } from '@revelation-srs/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { IntegrationBusPublisher } from '../src/platform/integration-bus/publisher.js';

import { recordApprovedAdjustment, wellbeingServiceJwt } from './helpers/adjustments.js';
import { startTestApp, type TestApp } from './helpers/test-app.js';

const published: Array<{ type: string; payload: unknown }> = [];
const spyBus = {
  isConnected: () => true,
  publish: (type: string, _v: string, _t: string, _c: string, _cls: string, payload: unknown) => { published.push({ type, payload }); return Promise.resolve(); },
  connect: () => Promise.resolve(),
  close: () => Promise.resolve(),
} as unknown as IntegrationBusPublisher;

let ctx: TestApp;
let registryJwt: string;
let proposerJwt: string;
let approverJwt: string;
let secondApproverJwt: string;
let adviserJwt: string;
let adminJwt: string;

beforeAll(async () => {
  ctx = await startTestApp({ eventBus: spyBus });
  registryJwt = await ctx.makeJwt({ sub: 'registry-officer-1', roles: ['registry-administrator'] });
  proposerJwt = await ctx.makeJwt({ sub: 'disability-admin-1', roles: ['adjustment-proposer'] });
  approverJwt = await ctx.makeJwt({ sub: 'disability-head-1', roles: ['adjustment-approver'] });
  secondApproverJwt = await ctx.makeJwt({ sub: 'disability-head-2', roles: ['adjustment-approver'] });
  adviserJwt = await ctx.makeJwt({ sub: 'adviser-1', roles: ['wellbeing-advisor'] });
  adminJwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
}, 120_000);

beforeEach(() => { published.length = 0; });

afterAll(async () => { await ctx?.teardown(); });

const auth = (jwt: string) => ({ authorization: `Bearer ${jwt}` });

async function student(code: string): Promise<{ personId: string; enrolmentId: string }> {
  const s = await ctx.app.inject({ method: 'POST', url: '/api/v1/students', headers: auth(registryJwt), payload: { legalFirstName: code, legalFamilyName: 'Authority' } });
  expect(s.statusCode).toBe(201);
  const personId = s.json<{ personId: string }>().personId;
  const e = await ctx.app.inject({
    method: 'POST', url: '/api/v1/enrolments', headers: auth(registryJwt),
    payload: { personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2027-28', startDate: '2027-09-20' },
  });
  expect(e.statusCode).toBe(201);
  return { personId, enrolmentId: e.json<{ enrolmentId: string }>().enrolmentId };
}

async function setManualPath(on: boolean): Promise<void> {
  const flags = (await ctx.app.inject({ method: 'GET', url: '/api/v1/feature-flags', headers: auth(adminJwt) })).json<Array<{ flagKey: string; featureFlagId: string }>>();
  const flag = flags.find((f) => f.flagKey === 'adjustments.manual-proposals.enabled');
  expect(flag, 'flag adjustments.manual-proposals.enabled is seeded').toBeDefined();
  await ctx.db.execute(sql`UPDATE feature_flag_assignment SET active_to = now() - interval '1 millisecond'
    WHERE flag_id = ${flag!.featureFlagId}::uuid AND tenant_id = ${ctx.tenantId}::uuid AND (active_to IS NULL OR active_to > now())`);
  const res = await ctx.app.inject({
    method: 'POST', url: `/api/v1/feature-flags/${flag!.featureFlagId}/assignments`, headers: auth(adminJwt),
    payload: { variantKey: on ? 'on' : 'off', activeFrom: new Date(Date.now() - 1000).toISOString() },
  });
  expect(res.statusCode).toBe(201);
}

const proposalBody = (enrolmentId: string, extra: Record<string, unknown> = {}) => ({
  enrolmentId, adjustmentTypeCode: 'extra-time', scopeCode: 'all', validFrom: '2027-09-01T00:00:00.000Z',
  amount: { value: 25, unitCode: 'percent-of-duration' },
  manualReasonCode: 'external-case-system', externalReference: 'DS-2027-0042', ...extra,
});

function propose(jwt: string, personId: string, body: Record<string, unknown>) {
  return ctx.app.inject({ method: 'POST', url: `/api/v1/students/${personId}/adjustment-proposals`, headers: auth(jwt), payload: body });
}

function decide(jwt: string, proposalId: string, body: Record<string, unknown>) {
  return ctx.app.inject({ method: 'POST', url: `/api/v1/adjustment-proposals/${proposalId}/decision`, headers: auth(jwt), payload: body });
}

async function coreRowsFor(personId: string): Promise<{ adjustments: number; distributions: number }> {
  const r = await ctx.db.execute(sql`SELECT
    (SELECT count(*) FROM reasonable_adjustment WHERE person_id = ${personId}::uuid)::int AS adjustments,
    (SELECT count(*) FROM adjustment_distribution d JOIN reasonable_adjustment a ON a.id = d.adjustment_id WHERE a.person_id = ${personId}::uuid)::int AS distributions`);
  return (r as unknown as Array<{ adjustments: number; distributions: number }>)[0]!;
}

describe('who holds the authority permissions', () => {
  const holders = (p: keyof typeof PERMISSION_ROLES) => [...(PERMISSION_ROLES[p] as string[])].sort();

  it('only the wellbeing service records a case adjustment; only an approver approves a manual one', () => {
    expect(holders('adjustment:record-approved')).toEqual(['wellbeing-service']);
    expect(holders('adjustment:approve-manual')).toEqual(['adjustment-approver']);
  });

  it('SME-6: registry and adjustment-proposer propose; never a wellbeing adviser or an approver', () => {
    expect(holders('adjustment:propose')).toEqual(['adjustment-proposer', 'registry-administrator']);
  });

  it('no role holds both adjustment:propose and adjustment:approve-manual', () => {
    const both = holders('adjustment:propose').filter((r) => holders('adjustment:approve-manual').includes(r));
    expect(both).toEqual([]);
  });

  it('adjustment-proposer holds adjustment:propose and nothing else', () => {
    const held = Object.entries(PERMISSION_ROLES).filter(([, roles]) => (roles as string[]).includes('adjustment-proposer')).map(([p]) => p);
    expect(held).toEqual(['adjustment:propose']);
  });
});

describe('POST /students/:personId/adjustments (service only)', () => {
  it('refuses registry administrators and wellbeing advisers', async () => {
    const s = await student('AUTH01');
    for (const jwt of [registryJwt, adviserJwt]) {
      const res = await ctx.app.inject({
        method: 'POST', url: `/api/v1/students/${s.personId}/adjustments`, headers: auth(jwt),
        payload: { enrolmentId: s.enrolmentId, adjustmentTypeCode: 'extra-time', scopeCode: 'exam', validFrom: '2027-09-01T00:00:00.000Z', sourceCaseId: randomUUID() },
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it('records a wellbeing-case adjustment from the service, and still needs the case', async () => {
    const s = await student('AUTH02');
    const { adjustmentId } = await recordApprovedAdjustment(ctx, s.personId, { enrolmentId: s.enrolmentId, adjustmentTypeCode: 'extra-time', scopeCode: 'exam', validFrom: '2027-09-01T00:00:00.000Z' });
    const got = await ctx.app.inject({ method: 'GET', url: `/api/v1/adjustments/${adjustmentId}`, headers: auth(registryJwt) });
    expect(got.json()).toMatchObject({ provenanceCode: 'wellbeing-case', manualProposalId: null });

    const noCase = await ctx.app.inject({
      method: 'POST', url: `/api/v1/students/${s.personId}/adjustments`, headers: auth(await wellbeingServiceJwt(ctx)),
      payload: { enrolmentId: s.enrolmentId, adjustmentTypeCode: 'extra-time', scopeCode: 'exam', validFrom: '2027-09-01T00:00:00.000Z' },
    });
    expect(noCase.statusCode).toBe(422);
  });
});

describe('manual adjustment proposals', () => {
  it('are refused while the manual path is off, which is the default', async () => {
    const s = await student('AUTH10');
    const res = await propose(registryJwt, s.personId, proposalBody(s.enrolmentId));
    expect(res.statusCode).toBe(403);
    expect(res.json<{ type: string }>().type).toBe('https://srs.example.com/errors/manual-adjustments-disabled');
  });

  describe('with the manual path on', () => {
    beforeAll(async () => { await setManualPath(true); });
    afterAll(async () => { await setManualPath(false); });

    it('may be proposed by registry and adjustment-proposer, not by a wellbeing adviser or an approver', async () => {
      const s = await student('AUTH11');
      expect((await propose(registryJwt, s.personId, proposalBody(s.enrolmentId))).statusCode).toBe(201);
      expect((await propose(proposerJwt, s.personId, proposalBody(s.enrolmentId))).statusCode).toBe(201);
      expect((await propose(adviserJwt, s.personId, proposalBody(s.enrolmentId))).statusCode).toBe(403);
      expect((await propose(approverJwt, s.personId, proposalBody(s.enrolmentId))).statusCode).toBe(403);
    });

    it('refuses notes, a source case, or any other field not in the contract', async () => {
      const s = await student('AUTH12');
      for (const extra of [{ notes: 'Diagnosed with ...' }, { sourceCaseId: randomUUID() }, { proposedBy: 'someone-else' }]) {
        const res = await propose(registryJwt, s.personId, proposalBody(s.enrolmentId, extra));
        expect(res.statusCode, JSON.stringify(extra)).toBe(400);
      }
    });

    it('refuses an unknown reason code, an empty or long external reference, and another person\'s enrolment', async () => {
      const s = await student('AUTH13');
      const other = await student('AUTH13B');
      expect((await propose(registryJwt, s.personId, proposalBody(s.enrolmentId, { manualReasonCode: 'because' }))).statusCode).toBe(422);
      expect((await propose(registryJwt, s.personId, proposalBody(s.enrolmentId, { externalReference: '   ' }))).statusCode).toBe(422);
      expect((await propose(registryJwt, s.personId, proposalBody(s.enrolmentId, { externalReference: 'x'.repeat(101) }))).statusCode).toBe(400);
      expect((await propose(registryJwt, s.personId, proposalBody(other.enrolmentId))).statusCode).toBe(404);
    });

    it('refuses a proposal about the proposer\'s own record', async () => {
      const s = await student('AUTH14');
      const self = await ctx.makeJwt({ sub: 'registry-self', roles: ['registry-administrator'], srsPersonId: s.personId });
      const res = await propose(self, s.personId, proposalBody(s.enrolmentId));
      expect(res.statusCode).toBe(403);
      expect(res.json<{ type: string }>().type).toBe('https://srs.example.com/errors/separation-of-duties');
    });

    it('leaves nothing for any reader of core adjustments until it is approved', async () => {
      const s = await student('AUTH15');
      const res = await propose(registryJwt, s.personId, proposalBody(s.enrolmentId));
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ statusCode: 'proposed' });

      const list = await ctx.app.inject({ method: 'GET', url: `/api/v1/students/${s.personId}/adjustments`, headers: auth(registryJwt) });
      expect(list.json()).toEqual([]);
      expect(await coreRowsFor(s.personId)).toEqual({ adjustments: 0, distributions: 0 });
      const tasks = await ctx.app.inject({ method: 'GET', url: '/api/v1/adjustment-tasks', headers: auth(registryJwt) });
      expect(tasks.json<Array<{ personId: string }>>().filter((t) => t.personId === s.personId)).toEqual([]);
      expect(published.filter((e) => e.type === EVENT_TYPES.ADJUSTMENT_APPROVED)).toEqual([]);
    });

    it('cannot be decided by its proposer, by the student it is about, or without the approver role', async () => {
      const s = await student('AUTH16');
      const { proposalId } = (await propose(proposerJwt, s.personId, proposalBody(s.enrolmentId))).json<{ proposalId: string }>();

      const proposerAlsoApprover = await ctx.makeJwt({ sub: 'disability-admin-1', roles: ['adjustment-approver'] });
      const own = await decide(proposerAlsoApprover, proposalId, { decisionCode: 'approved' });
      expect(own.statusCode).toBe(403);
      expect(own.json<{ type: string }>().type).toBe('https://srs.example.com/errors/separation-of-duties');

      const subject = await ctx.makeJwt({ sub: 'approver-who-is-student', roles: ['adjustment-approver'], srsPersonId: s.personId });
      const theirs = await decide(subject, proposalId, { decisionCode: 'approved' });
      expect(theirs.statusCode).toBe(403);
      expect(theirs.json<{ type: string }>().type).toBe('https://srs.example.com/errors/separation-of-duties');

      expect((await decide(registryJwt, proposalId, { decisionCode: 'approved' })).statusCode).toBe(403);
      expect(await coreRowsFor(s.personId)).toEqual({ adjustments: 0, distributions: 0 });
    });

    it('once approved by a second person, records one manual-approved adjustment and distributes it', async () => {
      const s = await student('AUTH17');
      const { proposalId } = (await propose(registryJwt, s.personId, proposalBody(s.enrolmentId))).json<{ proposalId: string }>();

      const res = await decide(approverJwt, proposalId, { decisionCode: 'approved' });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ adjustmentId: string; statusCode: string; decisionStatus: string }>();
      expect(body).toMatchObject({ proposalId, statusCode: 'approved', decisionStatus: 'applied' });

      const adjustment = await ctx.app.inject({ method: 'GET', url: `/api/v1/adjustments/${body.adjustmentId}`, headers: auth(approverJwt) });
      expect(adjustment.statusCode).toBe(200);
      expect(adjustment.json()).toMatchObject({
        provenanceCode: 'manual-approved', manualProposalId: proposalId, sourceCaseId: null, actorId: 'disability-head-1',
        adjustmentTypeCode: 'extra-time', scopeCode: 'all', amount: { value: 25, unitCode: 'percent-of-duration' },
      });
      const rows = await coreRowsFor(s.personId);
      expect(rows.adjustments).toBe(1);
      expect(rows.distributions).toBeGreaterThan(0);
      expect(published.filter((e) => e.type === EVENT_TYPES.ADJUSTMENT_APPROVED)).toHaveLength(1);

      const proposal = await ctx.app.inject({ method: 'GET', url: `/api/v1/adjustment-proposals/${proposalId}`, headers: auth(registryJwt) });
      expect(proposal.json()).toMatchObject({ statusCode: 'approved', adjustmentId: body.adjustmentId, decidedBy: 'disability-head-1' });

      const audit = await ctx.db.execute(sql`SELECT entity_type, action_type, actor_id, reason_text FROM audit_record
        WHERE entity_id IN (${proposalId}::uuid, ${body.adjustmentId}::uuid) ORDER BY occurred_at`);
      expect(audit as unknown as unknown[]).toEqual(expect.arrayContaining([
        expect.objectContaining({ entity_type: 'adjustment_proposal', action_type: 'create', actor_id: 'registry-officer-1' }),
        expect.objectContaining({ entity_type: 'adjustment_proposal', action_type: 'update', actor_id: 'disability-head-1', reason_text: 'approved' }),
        expect.objectContaining({ entity_type: 'reasonable_adjustment', action_type: 'create', reason_text: `Manual adjustment approved (proposal ${proposalId})` }),
      ]));

      // A second decision is a conflict, and records nothing more.
      expect((await decide(secondApproverJwt, proposalId, { decisionCode: 'rejected', reason: 'Too late' })).statusCode).toBe(409);
      expect((await coreRowsFor(s.personId)).adjustments).toBe(1);
    });

    it('a repeated approval effect finds the same adjustment', async () => {
      const s = await student('AUTH18');
      const { proposalId } = (await propose(registryJwt, s.personId, proposalBody(s.enrolmentId))).json<{ proposalId: string }>();
      const first = (await decide(approverJwt, proposalId, { decisionCode: 'approved' })).json<{ adjustmentId: string }>();
      // A retried effect records through the same key and authority, and finds the same adjustment.
      const replay = await ctx.app.adjustmentService.recordAuthorisedAdjustment(ctx.tenantId, s.personId, {
        enrolmentId: s.enrolmentId, adjustmentTypeCode: 'extra-time', scopeCode: 'all', validFrom: '2027-09-01T00:00:00.000Z',
        amount: { value: 25, unitCode: 'percent-of-duration' },
      }, { kind: 'manual-proposal', proposalId }, 'disability-head-1', `adjustment-proposal:${proposalId}`);
      expect(replay).toEqual({ adjustmentId: first.adjustmentId, replayed: true });
      expect((await coreRowsFor(s.personId)).adjustments).toBe(1);
    });

    it('a rejection needs a reason, and records no adjustment', async () => {
      const s = await student('AUTH19');
      const { proposalId } = (await propose(registryJwt, s.personId, proposalBody(s.enrolmentId))).json<{ proposalId: string }>();
      expect((await decide(approverJwt, proposalId, { decisionCode: 'rejected' })).statusCode).toBe(422);
      expect((await decide(approverJwt, proposalId, { decisionCode: 'rejected', reason: '   ' })).statusCode).toBe(422);
      const res = await decide(approverJwt, proposalId, { decisionCode: 'rejected', reason: 'No support plan on file' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ statusCode: 'rejected', adjustmentId: null });
      expect(await coreRowsFor(s.personId)).toEqual({ adjustments: 0, distributions: 0 });
    });

    it('refuses an approval whose adjustment has already ended, and leaves it proposed', async () => {
      const s = await student('AUTH20');
      const { proposalId } = (await propose(registryJwt, s.personId, proposalBody(s.enrolmentId, { validFrom: '2020-09-01T00:00:00.000Z', validTo: '2021-06-30T00:00:00.000Z' }))).json<{ proposalId: string }>();
      expect((await decide(approverJwt, proposalId, { decisionCode: 'approved' })).statusCode).toBe(422);
      const proposal = await ctx.app.inject({ method: 'GET', url: `/api/v1/adjustment-proposals/${proposalId}`, headers: auth(approverJwt) });
      expect(proposal.json()).toMatchObject({ statusCode: 'proposed' });
    });

    it('lists proposals for proposers and approvers, filtered by status and person', async () => {
      const s = await student('AUTH21');
      const { proposalId } = (await propose(proposerJwt, s.personId, proposalBody(s.enrolmentId))).json<{ proposalId: string }>();
      const res = await ctx.app.inject({ method: 'GET', url: `/api/v1/adjustment-proposals?statusCode=proposed&personId=${s.personId}`, headers: auth(approverJwt) });
      expect(res.statusCode).toBe(200);
      expect(res.json<Array<{ proposalId: string }>>().map((p) => p.proposalId)).toEqual([proposalId]);
      expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/adjustment-proposals', headers: auth(adviserJwt) })).statusCode).toBe(403);
    });
  });

  it('once the path is off again, approval is refused but a backlog can still be rejected', async () => {
    await setManualPath(true);
    const s = await student('AUTH30');
    const a = (await propose(registryJwt, s.personId, proposalBody(s.enrolmentId))).json<{ proposalId: string }>();
    const b = (await propose(registryJwt, s.personId, proposalBody(s.enrolmentId))).json<{ proposalId: string }>();
    await setManualPath(false);

    const approve = await decide(approverJwt, a.proposalId, { decisionCode: 'approved' });
    expect(approve.statusCode).toBe(403);
    expect(approve.json<{ type: string }>().type).toBe('https://srs.example.com/errors/manual-adjustments-disabled');
    expect((await decide(approverJwt, b.proposalId, { decisionCode: 'rejected', reason: 'Path closed' })).statusCode).toBe(200);
    expect(await coreRowsFor(s.personId)).toEqual({ adjustments: 0, distributions: 0 });
  });
});
