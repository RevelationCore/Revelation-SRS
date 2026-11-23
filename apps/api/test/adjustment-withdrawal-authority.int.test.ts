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
