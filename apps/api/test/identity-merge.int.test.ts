import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

/**
 * ADR-031 item 5 (BL-355): a merge moves current ownership to the survivor,
 * keeps history in place, records every move for unmerge, and queues
 * srs.person.merged, all in the decision's transaction.
 */
let ctx: TestApp;
let registry: string;
let preparer: string;
let decider: string;

beforeAll(async () => {
  ctx = await startTestApp();
  registry = await ctx.makeJwt({ roles: ['registry-administrator'] });
  preparer = await ctx.makeJwt({ sub: 'officer-a', roles: ['identity-resolution-officer'] });
  decider = await ctx.makeJwt({ sub: 'officer-b', roles: ['identity-resolution-officer'] });
}, 120_000);
afterAll(async () => { await ctx?.teardown(); });

const call = (token: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: Record<string, unknown>) =>
  ctx.app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
const rows = async <T>(q: ReturnType<typeof sql>) => (await ctx.db.execute(q)) as unknown as T[];

async function person(first: string): Promise<string> {
  const res = await call(registry, 'POST', '/students', { legalFirstName: first, legalFamilyName: 'Merge' });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ personId: string }>().personId;
}
async function enrol(personId: string): Promise<string> {
  const e = await call(registry, 'POST', '/enrolments', { personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2027-28', startDate: '2027-09-20' });
  expect(e.statusCode, e.body).toBe(201);
  return e.json<{ enrolmentId: string }>().enrolmentId;
}
async function mergeInto(merged: string, survivor: string, proposal: Record<string, unknown> = {}, decision = 'merge') {
  const open = await call(preparer, 'POST', '/identity-resolution/cases', { subjectPersonId: merged, ownerId: 'officer-a' });
  const caseId = open.json<{ identityResolutionCaseId: string }>().identityResolutionCaseId;
  expect((await call(preparer, 'POST', `/identity-resolution/cases/${caseId}/candidates`, { candidatePersonId: survivor, matchScore: 0.9, matchReasonCode: 'name-dob' })).statusCode).toBe(201);
  expect((await call(preparer, 'PUT', `/identity-resolution/cases/${caseId}/proposal`, { survivorPersonId: survivor, mergedPersonId: merged, ...proposal })).statusCode).toBe(200);
  const res = await call(decider, 'POST', `/identity-resolution/cases/${caseId}/decision`, { decisionTypeCode: decision, proposalVersion: 1, reason: 'Same person' });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ decisionId: string }>().decisionId;
}

describe('merge execution (ADR-031 item 5)', () => {
  it('moves current ownership to the survivor and keeps the as-recorded history', async () => {
    const merged = await person('Dupe'); const survivor = await person('Keep');
    const enrolmentId = await enrol(merged);
    const decisionId = await mergeInto(merged, survivor);

    // Versioned move: the current enrolment version is the survivor's, the closed one still the merged person's.
    const versions = await rows<{ person_id: string; recorded_until: Date | null }>(sql`SELECT person_id::text, recorded_until FROM enrolment WHERE id = ${enrolmentId}::uuid ORDER BY recorded_at`);
    expect(versions.filter((v) => v.recorded_until === null).map((v) => v.person_id)).toEqual([survivor]);
    expect(versions.some((v) => v.person_id === merged && v.recorded_until !== null)).toBe(true);
    const byApi = await call(registry, 'GET', `/enrolments/${enrolmentId}`);
    expect(byApi.json<{ personId: string }>().personId).toBe(survivor);

    // Ledgered move: the fee liability created with the enrolment follows it.
    const fees = await rows<{ person_id: string }>(sql`SELECT person_id::text FROM fee_liability WHERE enrolment_id = ${enrolmentId}::uuid`);
    expect(fees.length).toBeGreaterThan(0);
    expect(fees.map((f) => f.person_id)).toEqual(fees.map(() => survivor));

    // Every move is recorded against the merge.
    const [merge] = await rows<{ id: string; survivor_person_id: string; merged_person_id: string }>(sql`SELECT id::text, survivor_person_id::text, merged_person_id::text FROM identity_merge WHERE decision_id = ${decisionId}::uuid`);
    expect(merge).toMatchObject({ survivor_person_id: survivor, merged_person_id: merged });
    const moves = await rows<{ table_name: string; mode: string; row_key: string }>(sql`SELECT table_name, mode, row_key FROM identity_merge_move WHERE merge_id = ${merge!.id}::uuid`);
    expect(moves).toEqual(expect.arrayContaining([
      { table_name: 'enrolment', mode: 'versioned-move', row_key: enrolmentId },
      expect.objectContaining({ table_name: 'person_identity', mode: 'survivor-chooses' }),
    ]));
    expect(moves.some((m) => m.table_name === 'fee_liability' && m.mode === 'ledgered-move')).toBe(true);

    // The merged person stays, marked merged; the redirect names the merge, propagated in this transaction.
    expect((await rows<{ s: string }>(sql`SELECT person_status_code AS s FROM person WHERE id = ${merged}::uuid`))[0]!.s).toBe('merged');
    const [redirect] = await rows<{ merge_id: string; propagated_at: Date | null }>(sql`SELECT merge_id::text, propagated_at FROM identity_redirect WHERE old_person_id = ${merged}::uuid`);
    expect(redirect).toMatchObject({ merge_id: merge!.id });
    expect(redirect!.propagated_at).not.toBeNull();

    // srs.person.merged queued in the outbox, ids only.
    const events = await rows<{ payload: Record<string, unknown>; data_classification: string }>(sql`SELECT payload, data_classification FROM workflow_event_outbox WHERE event_type = 'srs.person.merged' AND correlation_id = ${decisionId}`);
    expect(events).toHaveLength(1);
    expect(events[0]!.data_classification).toBe('personal');
    expect(Object.keys(events[0]!.payload).sort()).toEqual(['effectiveAt', 'mergeId', 'mergedPersonId', 'survivorPersonId']);

    // Audit: the merge, and a summary per table.
    const audit = await rows<{ action_type: string; field_name: string | null }>(sql`SELECT action_type, field_name FROM audit_record WHERE entity_type = 'identity-merge' AND entity_id = ${merge!.id}::uuid`);
    expect(audit.filter((a) => a.action_type === 'create')).toHaveLength(1);
    expect(audit.map((a) => a.field_name)).toContain('enrolment.person_id');
  });

  it('keeps the survivor\'s identity by default, and the merged person\'s when the proposal chooses it', async () => {
    const current = (p: string) => rows<{ legal_first_name: string }>(sql`SELECT legal_first_name FROM person_identity WHERE person_id = ${p}::uuid AND recorded_until IS NULL`);

    const m1 = await person('Older'); const s1 = await person('Newer');
    await mergeInto(m1, s1);
    expect((await current(s1)).map((r) => r.legal_first_name)).toEqual(['Newer']);
    expect(await current(m1)).toEqual([]);

    const m2 = await person('Right'); const s2 = await person('Wrong');
    await mergeInto(m2, s2, { factChoices: { 'person-identity': 'merged' } });
    expect((await current(s2)).map((r) => r.legal_first_name)).toEqual(['Right']);
    expect(await current(m2)).toEqual([]);
  });

  it('a link or a rejection moves nothing', async () => {
    const a = await person('LinkA'); const b = await person('LinkB');
    const enrolmentId = await enrol(a);
    await mergeInto(a, b, {}, 'link');
    expect((await rows<{ person_id: string }>(sql`SELECT person_id::text FROM enrolment WHERE id = ${enrolmentId}::uuid AND recorded_until IS NULL`))[0]!.person_id).toBe(a);
    expect(await rows(sql`SELECT 1 FROM identity_merge WHERE merged_person_id = ${a}::uuid`)).toEqual([]);
  });
});

describe('old ids are resolved at the edge (ADR-031 items 6 and 9, BL-356)', () => {
  it('a GET on a merged-away id is redirected to the survivor; a write is refused, never redirected', async () => {
    const merged = await person('EdgeOld'); const survivor = await person('EdgeNew');
    await mergeInto(merged, survivor);
    const get = await call(registry, 'GET', `/students/${merged}/adjustments`);
    expect(get.statusCode).toBe(307);
    expect(get.headers.location).toBe(`/api/v1/students/${survivor}/adjustments`);
    expect(get.json()).toMatchObject({ type: 'https://srs.example.com/errors/person-merged', survivorPersonId: survivor });

    const write = await ctx.app.inject({ method: 'PATCH', url: `/api/v1/students/${merged}/status`, headers: { authorization: `Bearer ${registry}` }, payload: { statusCode: 'student' } });
    expect(write.statusCode).toBe(409);
    expect(write.json()).toMatchObject({ type: 'https://srs.example.com/errors/person-merged', survivorPersonId: survivor });

    // The survivor itself, and people never merged, are untouched.
    expect((await call(registry, 'GET', `/students/${survivor}/adjustments`)).statusCode).toBe(200);
  });

  it('a student token issued for the merged person reads the survivor', async () => {
    const merged = await person('TokOld'); const survivor = await person('TokNew');
    const token = await ctx.makeJwt({ sub: 'student-kc-1', roles: ['student'], srsPersonId: merged });
    expect((await call(token, 'GET', `/students/${survivor}/adjustments`)).statusCode).toBe(403);
    await mergeInto(merged, survivor);
    expect((await call(token, 'GET', `/students/${survivor}/adjustments`)).statusCode).toBe(200);
  });

  it('search by the merged person\'s student number or a dropped HUSID finds the survivor, with mergedFrom', async () => {
    const merged = await person('SearchOld'); const survivor = await person('SearchNew');
    await ctx.db.execute(sql`UPDATE person SET hesa_id = '1811111111111' WHERE id = ${merged}::uuid`);
    await ctx.db.execute(sql`UPDATE person SET hesa_id = '1822222222222' WHERE id = ${survivor}::uuid`);
    const [{ student_number: oldNumber }] = await rows<{ student_number: string }>(sql`SELECT student_number FROM person WHERE id = ${merged}::uuid`) as [{ student_number: string }];
    await mergeInto(merged, survivor, { identifierResolutions: { husid: { keep: 'survivor', reason: 'HESA confirmed' } } });

    for (const term of [oldNumber, '1811111111111']) {
      const res = await call(registry, 'GET', `/students?search=${encodeURIComponent(term)}`);
      expect(res.statusCode).toBe(200);
      expect(res.json(), term).toEqual([expect.objectContaining({ personId: survivor, legalFirstName: 'SearchNew', mergedFrom: [merged] })]);
    }
  });
});
