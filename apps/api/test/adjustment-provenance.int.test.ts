import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { recordApprovedAdjustment, withdrawApprovedAdjustment } from './helpers/adjustments.js';
import { startTestApp, type TestApp } from './helpers/test-app.js';

/**
 * ADR-033 (BL-377): every core adjustment says what authority recorded it,
 * and the database refuses a row whose provenance lacks its reference.
 */
let ctx: TestApp;
let jwt: string;
let person: { personId: string; enrolmentId: string };

beforeAll(async () => {
  ctx = await startTestApp();
  jwt = await ctx.makeJwt({ roles: ['registry-administrator'] });
  const s = await ctx.app.inject({ method: 'POST', url: '/api/v1/students', headers: { authorization: `Bearer ${jwt}` }, payload: { legalFirstName: 'Prov', legalFamilyName: 'Enance' } });
  const personId = s.json<{ personId: string }>().personId;
  const e = await ctx.app.inject({ method: 'POST', url: '/api/v1/enrolments', headers: { authorization: `Bearer ${jwt}` }, payload: { personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2027-28', startDate: '2027-09-20' } });
  person = { personId, enrolmentId: e.json<{ enrolmentId: string }>().enrolmentId };
}, 120_000);
afterAll(async () => { await ctx?.teardown(); });

const insert = (provenance: string, cols: { sourceCaseId?: string; manualProposalId?: string; batch?: string; ref?: string }) => ctx.db.execute(sql`
  INSERT INTO reasonable_adjustment (version_id, id, tenant_id, enrolment_id, person_id, adjustment_type_code, scope_code, actor_id, valid_from, recorded_at,
    provenance_code, source_case_id, manual_proposal_id, migration_batch_id, migration_source_reference)
  VALUES (gen_random_uuid(), gen_random_uuid(), ${ctx.tenantId}::uuid, ${person.enrolmentId}::uuid, ${person.personId}::uuid, 'separate-room', 'exam', 'test', now(), now(),
    ${provenance}, ${cols.sourceCaseId ?? null}::uuid, ${cols.manualProposalId ?? null}::uuid, ${cols.batch ?? null}::uuid, ${cols.ref ?? null})`);

describe('adjustment provenance (ADR-033)', () => {
  it('records wellbeing-case through the hand-off', async () => {
    const caseId = randomUUID();
    const { adjustmentId } = await recordApprovedAdjustment(ctx, person.personId, { enrolmentId: person.enrolmentId, adjustmentTypeCode: 'separate-room', scopeCode: 'exam', validFrom: '2027-09-01T00:00:00.000Z' }, { sourceCaseId: caseId });
    const [row] = await ctx.db.execute(sql`SELECT provenance_code, source_case_id::text FROM reasonable_adjustment WHERE id = ${adjustmentId}::uuid`) as unknown as Array<{ provenance_code: string; source_case_id: string }>;
    expect(row).toEqual({ provenance_code: 'wellbeing-case', source_case_id: caseId });
  });

  it('refuses a provenance without its reference, and an unknown one', async () => {
    await expect(insert('wellbeing-case', {})).rejects.toThrow();
    await expect(insert('manual-approved', {})).rejects.toThrow();
    // 0009: the proposal must exist (foreign key to adjustment_proposal).
    await expect(insert('manual-approved', { manualProposalId: randomUUID() })).rejects.toMatchObject({ cause: { constraint_name: 'reasonable_adjustment_manual_proposal_fk' } });
    await expect(insert('migrated', { batch: randomUUID() })).rejects.toThrow();
    await expect(insert('made-up', { sourceCaseId: randomUUID() })).rejects.toThrow();
    await expect(insert('migrated', { batch: randomUUID(), ref: 'sits:ADJ-1' })).resolves.toBeDefined();
  });

  it('keeps the provenance on the new version a withdrawal writes', async () => {
    const { adjustmentId } = await recordApprovedAdjustment(ctx, person.personId, { enrolmentId: person.enrolmentId, adjustmentTypeCode: 'separate-room', scopeCode: 'exam', validFrom: '2027-09-01T00:00:00.000Z' });
    expect((await withdrawApprovedAdjustment(ctx, adjustmentId)).statusCode).toBe(200);
    const rows = await ctx.db.execute(sql`SELECT provenance_code FROM reasonable_adjustment WHERE id = ${adjustmentId}::uuid`) as unknown as Array<{ provenance_code: string }>;
    expect(rows.length).toBeGreaterThan(1);
    expect(new Set(rows.map((r) => r.provenance_code))).toEqual(new Set(['wellbeing-case']));
  });

  it('ADR-034: refuses a withdrawal without its authority, reason or reference, or on the wrong provenance', async () => {
    const w = (cols: string) => ctx.db.execute(sql.raw(`
      INSERT INTO reasonable_adjustment (version_id, id, tenant_id, enrolment_id, person_id, adjustment_type_code, scope_code, actor_id, valid_from, recorded_at,
        provenance_code, source_case_id, ${cols.split('|')[0]})
      VALUES (gen_random_uuid(), gen_random_uuid(), '${ctx.tenantId}', '${person.enrolmentId}', '${person.personId}', 'separate-room', 'exam', 'test', now() - interval '1 day', now(),
        'wellbeing-case', gen_random_uuid(), ${cols.split('|')[1]})`));
    const bad = [
      "withdrawal_authority_code|'wellbeing-case'",
      "withdrawal_authority_code, withdrawal_reason_code|'wellbeing-case', 'no-longer-needed'",
      "valid_to, withdrawal_authority_code, withdrawal_reason_code, withdrawal_id|now(), 'approved-withdrawal', 'no-longer-needed', gen_random_uuid()",
      "valid_to, withdrawal_authority_code, withdrawal_reason_code|now(), 'wellbeing-case', 'enrolment-ended'",
      "valid_to, withdrawal_authority_code, withdrawal_reason_code|now(), 'wellbeing-case', 'superseded'",
      "valid_to, withdrawal_authority_code, withdrawal_reason_code|now(), 'enrolment-ended', 'enrolment-ended'",
      "valid_to, withdrawal_authority_code, withdrawal_reason_code|now(), 'made-up', 'no-longer-needed'",
    ];
    for (const cols of bad) await expect(w(cols), cols).rejects.toMatchObject({ cause: { constraint_name: 'reasonable_adjustment_withdrawal_ck' } });
    await expect(w("valid_to, withdrawal_authority_code, withdrawal_reason_code|now(), 'wellbeing-case', 'no-longer-needed'")).resolves.toBeDefined();
  });
});

