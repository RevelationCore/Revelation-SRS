/**
 * ADR-034 Guard: the withdrawal route matrix. An adjustment is ended early
 * only through its wellbeing case, a withdrawal a second person approved, or
 * the end of its enrolment; the old one-person /expire route is gone.
 */
import { randomUUID } from 'node:crypto';

import { EVENT_TYPES } from '@revelation-srs/domain';
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

beforeAll(async () => {
  ctx = await startTestApp({ eventBus: spyBus });
  registryJwt = await ctx.makeJwt({ sub: 'registry-officer-1', roles: ['registry-administrator'] });
}, 120_000);
beforeEach(() => { published.length = 0; });
afterAll(async () => { await ctx?.teardown(); });

const auth = (jwt: string) => ({ authorization: `Bearer ${jwt}` });

async function student(code: string): Promise<{ personId: string; enrolmentId: string }> {
  const s = await ctx.app.inject({ method: 'POST', url: '/api/v1/students', headers: auth(registryJwt), payload: { legalFirstName: code, legalFamilyName: 'Withdrawal' } });
  const personId = s.json<{ personId: string }>().personId;
  const e = await ctx.app.inject({ method: 'POST', url: '/api/v1/enrolments', headers: auth(registryJwt), payload: { personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2027-28', startDate: '2027-09-20' } });
  return { personId, enrolmentId: e.json<{ enrolmentId: string }>().enrolmentId };
}

async function caseAdjustment(s: { personId: string; enrolmentId: string }): Promise<{ adjustmentId: string; sourceCaseId: string }> {
  const sourceCaseId = randomUUID();
  const { adjustmentId } = await recordApprovedAdjustment(ctx, s.personId, { enrolmentId: s.enrolmentId, adjustmentTypeCode: 'extra-time', scopeCode: 'all', validFrom: '2026-09-01T00:00:00.000Z', amount: { value: 25, unitCode: 'percent-of-duration' } }, { sourceCaseId });
  return { adjustmentId, sourceCaseId };
}

async function handOff(personId: string, adjustmentId: string, payload: Record<string, unknown>, jwt?: string) {
  return ctx.app.inject({ method: 'POST', url: `/api/v1/students/${personId}/adjustments/${adjustmentId}/withdrawal`, headers: auth(jwt ?? await wellbeingServiceJwt(ctx)), payload });
}

const current = async (adjustmentId: string) => ((await ctx.db.execute(sql`SELECT valid_to, withdrawal_authority_code, withdrawal_reason_code, replacement_adjustment_id::text AS replacement, actor_id
  FROM reasonable_adjustment WHERE id = ${adjustmentId}::uuid AND recorded_until IS NULL`)) as unknown as Array<{ valid_to: Date | null; withdrawal_authority_code: string | null; withdrawal_reason_code: string | null; replacement: string | null; actor_id: string }>)[0]!;

describe('the retired one-person route', () => {
  it('POST /adjustments/:id/expire no longer exists', async () => {
    const s = await student('WD00');
    const { adjustmentId } = await caseAdjustment(s);
    expect((await ctx.app.inject({ method: 'POST', url: `/api/v1/adjustments/${adjustmentId}/expire`, headers: auth(registryJwt) })).statusCode).toBe(404);
    expect((await current(adjustmentId)).valid_to).toBeNull();
  });
});

describe('the wellbeing case withdrawal hand-off (ADR-034 item 4)', () => {
  it('refuses staff, even registry administrators and wellbeing advisers', async () => {
    const s = await student('WD01');
    const { adjustmentId, sourceCaseId } = await caseAdjustment(s);
    for (const roles of [['registry-administrator'], ['wellbeing-advisor'], ['adjustment-approver']]) {
      const res = await handOff(s.personId, adjustmentId, { sourceCaseId, withdrawalReasonCode: 'no-longer-needed' }, await ctx.makeJwt({ roles }));
      expect(res.statusCode, roles[0]).toBe(403);
    }
  });

  it('ends it now, records the authority and reason, withdraws the distributions, audits and publishes once', async () => {
    const s = await student('WD02');
    const { adjustmentId, sourceCaseId } = await caseAdjustment(s);
    const before = Date.now();
    const res = await handOff(s.personId, adjustmentId, { sourceCaseId, withdrawalReasonCode: 'student-request' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ adjustmentId, changed: true, withdrawalAuthorityCode: 'wellbeing-case', withdrawalReasonCode: 'student-request' });

    const row = await current(adjustmentId);
    expect(row).toMatchObject({ withdrawal_authority_code: 'wellbeing-case', withdrawal_reason_code: 'student-request' });
    expect(new Date(row.valid_to!).getTime()).toBeGreaterThanOrEqual(before - 1000);
    const wire = (await ctx.app.inject({ method: 'GET', url: `/api/v1/adjustments/${adjustmentId}`, headers: auth(registryJwt) })).json<Record<string, unknown>>();
    expect(wire).toMatchObject({ withdrawalAuthorityCode: 'wellbeing-case', withdrawalReasonCode: 'student-request' });

    const open = (await ctx.db.execute(sql`SELECT count(*)::int AS n FROM adjustment_distribution WHERE adjustment_id = ${adjustmentId}::uuid AND status_code IN ('pending', 'distributed', 'failed')`)) as unknown as Array<{ n: number }>;
    expect(open[0]!.n).toBe(0);
    expect(published.filter((e) => e.type === EVENT_TYPES.ADJUSTMENT_EXPIRED)).toHaveLength(1);

    const audit = (await ctx.db.execute(sql`SELECT actor_type, field_name, reason_code, reason_text FROM audit_record
      WHERE entity_type = 'reasonable_adjustment' AND entity_id = ${adjustmentId}::uuid AND action_type = 'update'`)) as unknown as Array<Record<string, string>>;
    expect(audit).toEqual([expect.objectContaining({ actor_type: 'integration', field_name: 'valid_to', reason_code: 'student-request', reason_text: `Adjustment withdrawn: student-request (case ${sourceCaseId})` })]);

    // A lost response is replayed: nothing more happens.
    const again = await handOff(s.personId, adjustmentId, { sourceCaseId, withdrawalReasonCode: 'student-request' });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ changed: false, withdrawalAuthorityCode: 'wellbeing-case' });
    expect(published.filter((e) => e.type === EVENT_TYPES.ADJUSTMENT_EXPIRED)).toHaveLength(1);
  });

  it('refuses another case (409 source-case-mismatch), another student (404) and unknown fields (400)', async () => {
    const s = await student('WD03');
    const other = await student('WD03B');
    const { adjustmentId, sourceCaseId } = await caseAdjustment(s);
    const mismatch = await handOff(s.personId, adjustmentId, { sourceCaseId: randomUUID(), withdrawalReasonCode: 'no-longer-needed' });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json<{ type: string }>().type).toBe('https://srs.example.com/errors/source-case-mismatch');
    expect((await handOff(other.personId, adjustmentId, { sourceCaseId, withdrawalReasonCode: 'no-longer-needed' })).statusCode).toBe(404);
    expect((await handOff(s.personId, adjustmentId, { sourceCaseId, withdrawalReasonCode: 'no-longer-needed', notes: 'Feeling better' })).statusCode).toBe(400);
    expect((await current(adjustmentId)).valid_to).toBeNull();
  });

  it('refuses a reason it may not give, and superseded without a current replacement of the same student', async () => {
    const s = await student('WD04');
    const other = await student('WD04B');
    const { adjustmentId, sourceCaseId } = await caseAdjustment(s);
    const { adjustmentId: theirs } = await caseAdjustment(other);
    for (const payload of [
      { withdrawalReasonCode: 'made-up' },
      { withdrawalReasonCode: 'enrolment-ended' },
      { withdrawalReasonCode: 'superseded' },
      { withdrawalReasonCode: 'superseded', replacementAdjustmentId: theirs },
      { withdrawalReasonCode: 'superseded', replacementAdjustmentId: adjustmentId },
      { withdrawalReasonCode: 'no-longer-needed', replacementAdjustmentId: theirs },
    ]) {
      expect((await handOff(s.personId, adjustmentId, { sourceCaseId, ...payload })).statusCode, JSON.stringify(payload)).toBe(422);
    }
    expect((await current(adjustmentId)).valid_to).toBeNull();
  });

  it('superseded names its replacement, which stays in force', async () => {
    const s = await student('WD05');
    const { adjustmentId, sourceCaseId } = await caseAdjustment(s);
    const { adjustmentId: replacement } = await caseAdjustment(s);
    const res = await handOff(s.personId, adjustmentId, { sourceCaseId, withdrawalReasonCode: 'superseded', replacementAdjustmentId: replacement });
    expect(res.statusCode).toBe(200);
    expect(await current(adjustmentId)).toMatchObject({ withdrawal_reason_code: 'superseded', replacement });
    expect((await current(replacement)).valid_to).toBeNull();
  });

  it('a migrated adjustment has no case to withdraw it through', async () => {
    const s = await student('WD06');
    const id = randomUUID();
    await ctx.db.execute(sql`INSERT INTO reasonable_adjustment (version_id, id, tenant_id, enrolment_id, person_id, adjustment_type_code, scope_code, actor_id, valid_from, recorded_at, provenance_code, migration_batch_id, migration_source_reference)
      VALUES (gen_random_uuid(), ${id}::uuid, ${ctx.tenantId}::uuid, ${s.enrolmentId}::uuid, ${s.personId}::uuid, 'separate-room', 'exam', 'migration-import', '2026-09-01', now(), 'migrated', gen_random_uuid(), 'sits:ADJ-9')`);
    const res = await handOff(s.personId, id, { sourceCaseId: randomUUID(), withdrawalReasonCode: 'no-longer-needed' });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ type: string }>().type).toBe('https://srs.example.com/errors/source-case-mismatch');
  });
});

describe('withdrawal proposals for manual, migrated and legacy adjustments (ADR-034 item 5)', () => {
  let proposerJwt: string; let adviserJwt: string; let approverJwt: string; let secondApproverJwt: string;
  beforeAll(async () => {
    proposerJwt = await ctx.makeJwt({ sub: 'disability-admin-1', roles: ['adjustment-proposer'] });
    adviserJwt = await ctx.makeJwt({ sub: 'adviser-1', roles: ['wellbeing-advisor'] });
    approverJwt = await ctx.makeJwt({ sub: 'disability-head-1', roles: ['adjustment-approver'] });
    secondApproverJwt = await ctx.makeJwt({ sub: 'disability-head-2', roles: ['adjustment-approver'] });
  });

  /** A migrated (or legacy-direct) adjustment, as the importer writes one. */
  async function migrated(s: { personId: string; enrolmentId: string }, provenance: 'migrated' | 'legacy-direct' = 'migrated'): Promise<string> {
    const id = randomUUID();
    await ctx.db.execute(sql`INSERT INTO reasonable_adjustment (version_id, id, tenant_id, enrolment_id, person_id, adjustment_type_code, scope_code, actor_id, valid_from, recorded_at, provenance_code, migration_batch_id, migration_source_reference)
      VALUES (gen_random_uuid(), ${id}::uuid, ${ctx.tenantId}::uuid, ${s.enrolmentId}::uuid, ${s.personId}::uuid, 'separate-room', 'exam', 'migration-import', '2026-09-01', now(), ${provenance},
        ${provenance === 'migrated' ? randomUUID() : null}::uuid, ${provenance === 'migrated' ? `sits:${id}` : null})`);
    return id;
  }
  const propose = (jwt: string, personId: string, adjustmentId: string, body: Record<string, unknown>) =>
    ctx.app.inject({ method: 'POST', url: `/api/v1/students/${personId}/adjustments/${adjustmentId}/withdrawal-proposals`, headers: auth(jwt), payload: body });
  const decide = (jwt: string, withdrawalId: string, body: Record<string, unknown>) =>
    ctx.app.inject({ method: 'POST', url: `/api/v1/adjustment-withdrawals/${withdrawalId}/decision`, headers: auth(jwt), payload: body });
  const body = (extra: Record<string, unknown> = {}) => ({ withdrawalReasonCode: 'student-request', externalReference: 'EMAIL-2026-11-20', ...extra });

  it('may be proposed by registry, adjustment-proposer and wellbeing-advisor, never by an approver', async () => {
    const s = await student('WP01');
    for (const [jwt, expected] of [[registryJwt, 201], [proposerJwt, 201], [adviserJwt, 201], [approverJwt, 403]] as const) {
      const id = await migrated(s);
      expect((await propose(jwt, s.personId, id, body())).statusCode).toBe(expected);
    }
  });

  it('refuses a wellbeing-case adjustment, an ended one, a second open proposal and the proposer\'s own record', async () => {
    const s = await student('WP02');
    const { adjustmentId: caseOne } = await caseAdjustment(s);
    const through = await propose(registryJwt, s.personId, caseOne, body());
    expect(through.statusCode).toBe(409);
    expect(through.json<{ type: string }>().type).toBe('https://srs.example.com/errors/withdrawal-through-case');

    const ended = await migrated(s);
    await ctx.db.execute(sql`UPDATE reasonable_adjustment SET valid_to = now() - interval '1 day' WHERE id = ${ended}::uuid`);
    expect((await propose(registryJwt, s.personId, ended, body())).statusCode).toBe(409);

    const id = await migrated(s);
    expect((await propose(registryJwt, s.personId, id, body())).statusCode).toBe(201);
    expect((await propose(proposerJwt, s.personId, id, body())).statusCode).toBe(409);

    const self = await ctx.makeJwt({ sub: 'registry-self', roles: ['registry-administrator'], srsPersonId: s.personId });
    const own = await propose(self, s.personId, await migrated(s), body());
    expect(own.statusCode).toBe(403);
    expect(own.json<{ type: string }>().type).toBe('https://srs.example.com/errors/separation-of-duties');
  });

  it('refuses unknown fields, a system-only or unknown reason, and superseded without a replacement', async () => {
    const s = await student('WP03');
    const id = await migrated(s);
    expect((await propose(registryJwt, s.personId, id, body({ notes: 'x' }))).statusCode).toBe(400);
    expect((await propose(registryJwt, s.personId, id, body({ externalReference: 'x'.repeat(101) }))).statusCode).toBe(400);
    for (const extra of [{ withdrawalReasonCode: 'enrolment-ended' }, { withdrawalReasonCode: 'made-up' }, { withdrawalReasonCode: 'superseded' }, { externalReference: '  ' }]) {
      expect((await propose(registryJwt, s.personId, id, body(extra))).statusCode, JSON.stringify(extra)).toBe(422);
    }
    expect((await current(id)).valid_to).toBeNull();
  });

  it('changes nothing until approved; cannot be decided by its proposer, the student or registry', async () => {
    const s = await student('WP04');
    const id = await migrated(s);
    const { withdrawalId } = (await propose(proposerJwt, s.personId, id, body())).json<{ withdrawalId: string }>();
    expect((await current(id)).valid_to).toBeNull();
    expect(published.filter((e) => e.type === EVENT_TYPES.ADJUSTMENT_EXPIRED)).toEqual([]);

    const proposerAlsoApprover = await ctx.makeJwt({ sub: 'disability-admin-1', roles: ['adjustment-approver'] });
    expect((await decide(proposerAlsoApprover, withdrawalId, { decisionCode: 'approved' })).json<{ type: string }>().type).toBe('https://srs.example.com/errors/separation-of-duties');
    const subject = await ctx.makeJwt({ sub: 'approver-student', roles: ['adjustment-approver'], srsPersonId: s.personId });
    expect((await decide(subject, withdrawalId, { decisionCode: 'approved' })).statusCode).toBe(403);
    expect((await decide(registryJwt, withdrawalId, { decisionCode: 'approved' })).statusCode).toBe(403);
    expect((await current(id)).valid_to).toBeNull();
  });

  it('once approved by a second person, ends the adjustment under that withdrawal, once', async () => {
    const s = await student('WP05');
    const id = await migrated(s, 'legacy-direct');
    const { withdrawalId } = (await propose(adviserJwt, s.personId, id, body({ withdrawalReasonCode: 'no-longer-needed', externalReference: 'REVIEW-77' }))).json<{ withdrawalId: string }>();
    const res = await decide(approverJwt, withdrawalId, { decisionCode: 'approved' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ withdrawalId, statusCode: 'approved', adjustmentId: id, decisionStatus: 'applied' });
    expect(res.json<{ withdrawnAt: string | null }>().withdrawnAt).not.toBeNull();

    expect(await current(id)).toMatchObject({ withdrawal_authority_code: 'approved-withdrawal', withdrawal_reason_code: 'no-longer-needed', actor_id: 'disability-head-1' });
    expect(published.filter((e) => e.type === EVENT_TYPES.ADJUSTMENT_EXPIRED)).toHaveLength(1);
    const audit = (await ctx.db.execute(sql`SELECT reason_text FROM audit_record WHERE entity_type = 'reasonable_adjustment' AND entity_id = ${id}::uuid AND action_type = 'update'`)) as unknown as Array<{ reason_text: string }>;
    expect(audit.map((a) => a.reason_text)).toEqual([`Adjustment withdrawn: no-longer-needed (withdrawal ${withdrawalId})`]);

    expect((await decide(secondApproverJwt, withdrawalId, { decisionCode: 'rejected', reason: 'Late' })).statusCode).toBe(409);
    const listed = await ctx.app.inject({ method: 'GET', url: `/api/v1/adjustment-withdrawals?personId=${s.personId}&statusCode=approved`, headers: auth(adviserJwt) });
    expect(listed.json<Array<{ withdrawalId: string }>>().map((w) => w.withdrawalId)).toEqual([withdrawalId]);
  });

  it('a rejection needs a reason and leaves the adjustment as it was', async () => {
    const s = await student('WP06');
    const id = await migrated(s);
    const { withdrawalId } = (await propose(registryJwt, s.personId, id, body())).json<{ withdrawalId: string }>();
    expect((await decide(approverJwt, withdrawalId, { decisionCode: 'rejected' })).statusCode).toBe(422);
    const res = await decide(approverJwt, withdrawalId, { decisionCode: 'rejected', reason: 'The student withdrew the request' });
    expect(res.json()).toMatchObject({ statusCode: 'rejected', withdrawnAt: null });
    expect((await current(id)).valid_to).toBeNull();
  });

  it('approving one whose adjustment has already ended approves it with nothing withdrawn', async () => {
    const s = await student('WP07');
    const id = await migrated(s);
    const { withdrawalId } = (await propose(registryJwt, s.personId, id, body())).json<{ withdrawalId: string }>();
    await ctx.db.execute(sql`UPDATE reasonable_adjustment SET valid_to = now() - interval '1 minute' WHERE id = ${id}::uuid`);
    const res = await decide(approverJwt, withdrawalId, { decisionCode: 'approved' });
    expect(res.json()).toMatchObject({ statusCode: 'approved', withdrawnAt: null });
    expect((await current(id)).withdrawal_authority_code).toBeNull();
    expect(published.filter((e) => e.type === EVENT_TYPES.ADJUSTMENT_EXPIRED)).toEqual([]);
  });
});

describe('enrolment end withdraws adjustments (ADR-034 item 7)', () => {
  async function migratedFor(s: { personId: string; enrolmentId: string }): Promise<string> {
    const id = randomUUID();
    await ctx.db.execute(sql`INSERT INTO reasonable_adjustment (version_id, id, tenant_id, enrolment_id, person_id, adjustment_type_code, scope_code, actor_id, valid_from, recorded_at, provenance_code, migration_batch_id, migration_source_reference)
      VALUES (gen_random_uuid(), ${id}::uuid, ${ctx.tenantId}::uuid, ${s.enrolmentId}::uuid, ${s.personId}::uuid, 'separate-room', 'exam', 'migration-import', '2026-09-01', now(), 'migrated', gen_random_uuid(), ${`sits:${id}`})`);
    return id;
  }
  const transition = (enrolmentId: string, status: 'withdrawn' | 'graduated' | 'suspended', at = new Date(Date.now() + 1000)) =>
    ctx.app.enrolmentService.transitionStatus(enrolmentId, ctx.tenantId, status, at, 'registry-officer-1');
  const sweep = () => ctx.app.adjustmentWithdrawalService.withdrawForEndedEnrolments(ctx.tenantId);
  const latestTransition = async (enrolmentId: string) => ((await ctx.db.execute(sql`SELECT id::text AS id FROM enrolment_status_transition
    WHERE enrolment_id = ${enrolmentId}::uuid ORDER BY created_at DESC LIMIT 1`)) as unknown as Array<{ id: string }>)[0]!.id;
  const endedRow = async (adjustmentId: string) => ((await ctx.db.execute(sql`SELECT withdrawal_authority_code, withdrawal_reason_code, withdrawal_enrolment_transition_id::text AS transition, actor_id, valid_to
    FROM reasonable_adjustment WHERE id = ${adjustmentId}::uuid AND recorded_until IS NULL`)) as unknown as Array<{ withdrawal_authority_code: string | null; withdrawal_reason_code: string | null; transition: string | null; actor_id: string; valid_to: Date | null }>)[0]!;

  it('withdrawing the student ends every current adjustment, whatever its provenance, as the system', async () => {
    const s = await student('WE01');
    const { adjustmentId: fromCase } = await caseAdjustment(s);
    const fromMigration = await migratedFor(s);
    await ctx.db.execute(sql`UPDATE enrolment SET valid_from = now() - interval '1 day' WHERE id = ${s.enrolmentId}::uuid AND recorded_until IS NULL`);
    await transition(s.enrolmentId, 'withdrawn', new Date(Date.now() - 1000));
    const transitionId = await latestTransition(s.enrolmentId);
    for (const id of [fromCase, fromMigration]) {
      expect(await endedRow(id)).toMatchObject({ withdrawal_authority_code: 'enrolment-ended', withdrawal_reason_code: 'enrolment-ended', transition: transitionId, actor_id: 'system:enrolment-ended' });
    }
    const audit = (await ctx.db.execute(sql`SELECT actor_type FROM audit_record WHERE entity_type = 'reasonable_adjustment' AND entity_id = ${fromMigration}::uuid AND action_type = 'update'`)) as unknown as Array<{ actor_type: string }>;
    expect(audit).toEqual([{ actor_type: 'system' }]);
    expect(published.filter((e) => e.type === EVENT_TYPES.ADJUSTMENT_EXPIRED)).toHaveLength(2);

    // Idempotent: nothing more to do.
    published.length = 0;
    expect(await sweep()).toMatchObject({ withdrawn: 0 });
    expect(published.filter((e) => e.type === EVENT_TYPES.ADJUSTMENT_EXPIRED)).toEqual([]);
  });

  it('a graduation effective now is applied straight away by the listener', async () => {
    const s = await student('WE02');
    const id = await migratedFor(s);
    await ctx.db.execute(sql`UPDATE enrolment SET valid_from = now() - interval '1 day' WHERE id = ${s.enrolmentId}::uuid AND recorded_until IS NULL`);
    await transition(s.enrolmentId, 'graduated', new Date(Date.now() - 1000));
    expect(await endedRow(id)).toMatchObject({ withdrawal_authority_code: 'enrolment-ended' });
  });

  it('a future-dated withdrawal waits until it takes effect', async () => {
    const s = await student('WE03');
    const id = await migratedFor(s);
    await transition(s.enrolmentId, 'withdrawn', new Date(Date.now() + 30 * 24 * 3600 * 1000));
    await sweep();
    expect((await endedRow(id)).valid_to).toBeNull();
    // The date passes.
    await ctx.db.execute(sql`UPDATE enrolment SET valid_from = now() - interval '1 minute' WHERE id = ${s.enrolmentId}::uuid AND recorded_until IS NULL`);
    await sweep();
    expect(await endedRow(id)).toMatchObject({ withdrawal_authority_code: 'enrolment-ended' });
  });

  it('a suspension does not end adjustments', async () => {
    const s = await student('WE04');
    const id = await migratedFor(s);
    await ctx.db.execute(sql`UPDATE enrolment SET valid_from = now() - interval '1 day' WHERE id = ${s.enrolmentId}::uuid AND recorded_until IS NULL`);
    await transition(s.enrolmentId, 'suspended', new Date(Date.now() - 1000));
    await sweep();
    expect((await endedRow(id)).valid_to).toBeNull();
  });
});
