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

describe('external systems learn of a merge (ADR-031 items 8 and 9, BL-357)', () => {
  /** Something already delivered about a person on a flow, as the ledger records it. */
  const delivered = (personId: string, flowCode: string, targetSystem: string) => ctx.db.execute(sql`INSERT INTO delivery_item
    (tenant_id, flow_code, target_system, subject_type, subject_id, person_id, idempotency_key, payload, summary, fulfilment_mode_code, status_code)
    VALUES (${ctx.tenantId}::uuid, ${flowCode}, ${targetSystem}, 'person', ${personId}::uuid, ${personId}::uuid, ${`seed:${flowCode}:${personId}`}, '{}', 'seed', 'manual', 'delivered')`);
  const items = (where: ReturnType<typeof sql>) => rows<{ flow_code: string; subject_type: string; person_id: string; idempotency_key: string; payload: Record<string, unknown> }>(sql`
    SELECT flow_code, subject_type, person_id::text, idempotency_key, payload FROM delivery_item WHERE tenant_id = ${ctx.tenantId}::uuid AND ${where}`);

  it('flows that delivered something about either person get a person-merged notice; others get nothing', async () => {
    const merged = await person('LedgerOld'); const survivor = await person('LedgerNew');
    await delivered(merged, 'F-SIS-LIB-01', 'lib');
    await delivered(survivor, 'F-SIS-ITSM-01', 'itsm');
    const decisionId = await mergeInto(merged, survivor);
    const [{ id: mergeId }] = await rows<{ id: string }>(sql`SELECT id::text FROM identity_merge WHERE decision_id = ${decisionId}::uuid`) as [{ id: string }];

    const notices = await items(sql`subject_type = 'person-merge' AND subject_id = ${mergeId}::uuid`);
    expect(notices.map((n) => n.flow_code).sort()).toEqual(['F-SIS-ITSM-01', 'F-SIS-LIB-01']);
    expect(notices[0]!.payload).toMatchObject({ messageType: 'person-merged', mergeId, survivorPersonId: survivor, mergedPersonId: merged });
    expect(notices.every((n) => n.person_id === survivor)).toBe(true);
    // No IAM account for either: no IAM instruction; the ITSM producer sends the survivor's fresh snapshot.
    expect(await items(sql`flow_code = 'F-SIS-IAM-01' AND idempotency_key LIKE ${`person-merged:${mergeId}%`}`)).toEqual([]);
    expect((await items(sql`flow_code = 'F-SIS-ITSM-01' AND idempotency_key = ${`person-merged:${mergeId}:snapshot:itsm`}`)).map((i) => i.person_id)).toEqual([survivor]);
  });

  it('IAM: an account only the merged person has is rebound to the survivor', async () => {
    const merged = await person('IamOld'); const survivor = await person('IamNew');
    await enrol(merged);
    await delivered(merged, 'F-SIS-IAM-01', 'iam');
    const decisionId = await mergeInto(merged, survivor);
    const [{ id: mergeId }] = await rows<{ id: string }>(sql`SELECT id::text FROM identity_merge WHERE decision_id = ${decisionId}::uuid`) as [{ id: string }];
    const [iam] = await items(sql`idempotency_key = ${`person-merged:${mergeId}:iam`}`);
    expect(iam).toMatchObject({ flow_code: 'F-SIS-IAM-01', person_id: merged });
    expect(iam!.payload).toMatchObject({ contractVersion: 2, contractMinorVersion: 1, instruction: 'rebind', personId: merged, successorPersonId: survivor });
    // The survivor's recomputed account follows the commit.
    expect((await items(sql`idempotency_key = ${`person-merged:${mergeId}:snapshot:iam`}`)).map((i) => i.person_id)).toEqual([survivor]);
  });

  it('IAM: when both have accounts the merged person\'s is ended, with reason merged', async () => {
    const merged = await person('BothOld'); const survivor = await person('BothNew');
    await delivered(merged, 'F-SIS-IAM-01', 'iam');
    await delivered(survivor, 'F-SIS-IAM-01', 'iam');
    const decisionId = await mergeInto(merged, survivor, { twoAccountsConfirmed: true });
    const [{ id: mergeId }] = await rows<{ id: string }>(sql`SELECT id::text FROM identity_merge WHERE decision_id = ${decisionId}::uuid`) as [{ id: string }];
    const [iam] = await items(sql`idempotency_key = ${`person-merged:${mergeId}:iam`}`);
    expect(iam!.payload).toMatchObject({ instruction: 'ended', accessLevel: 'ended', endReason: 'merged', personId: merged, successorPersonId: survivor });
  });
});

describe('unmerge (ADR-031 item 10, BL-359)', () => {
  let officerC: string; let officerD: string;
  beforeAll(async () => {
    officerC = await ctx.makeJwt({ sub: 'officer-c', roles: ['identity-resolution-officer'] });
    officerD = await ctx.makeJwt({ sub: 'officer-d', roles: ['identity-resolution-officer'] });
  });
  const mergeOf = async (decisionId: string) => (await rows<{ id: string }>(sql`SELECT id::text FROM identity_merge WHERE decision_id = ${decisionId}::uuid`))[0]!.id;
  const open = async (mergeId: string, token = officerC) => {
    const res = await call(token, 'POST', `/identity-merges/${mergeId}/unmerge-cases`);
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ unmergeCaseId: string }>().unmergeCaseId;
  };
  const decideUnmerge = (token: string, caseId: string, body: Record<string, unknown>) =>
    call(token, 'POST', `/identity-unmerge-cases/${caseId}/decision`, { decisionTypeCode: 'unmerge', reason: 'Two different people', ...body });

  it('reverses the merge, gives post-merge records where the proposal says, and lets the two be merged again', async () => {
    const merged = await person('UnOld'); const survivor = await person('UnNew');
    await ctx.db.execute(sql`UPDATE person SET hesa_id = '1833333333333' WHERE id = ${merged}::uuid`);
    await ctx.db.execute(sql`UPDATE person SET hesa_id = '1844444444444' WHERE id = ${survivor}::uuid`);
    const movedEnrolment = await enrol(merged);
    const mergeId = await mergeOf(await mergeInto(merged, survivor, {
      factChoices: { 'person-identity': 'merged' }, identifierResolutions: { husid: { keep: 'survivor', reason: 'HESA confirmed' } },
    }));
    const statusBefore = (await rows<{ s: string }>(sql`SELECT person_status_code AS s FROM person WHERE id = ${merged}::uuid`))[0]!.s;
    expect(statusBefore).toBe('merged');
    // Made on the survivor after the merge, then found to be the other person's.
    const laterEnrolment = await enrol(survivor);

    const caseId = await open(mergeId);
    const viewed = (await call(officerC, 'GET', `/identity-unmerge-cases/${caseId}`)).json<{ postMergeRecords: Array<{ key: string; table: string; rowKey: string }> }>();
    const later = viewed.postMergeRecords.find((r) => r.table === 'enrolment' && r.rowKey === laterEnrolment);
    expect(later, JSON.stringify(viewed.postMergeRecords)).toBeDefined();
    expect(viewed.postMergeRecords.some((r) => r.rowKey === movedEnrolment)).toBe(false);
    const proposed = await call(officerC, 'PUT', `/identity-unmerge-cases/${caseId}/proposal`, { allocations: { [later!.key]: 'restored' } });
    expect(proposed.statusCode, proposed.body).toBe(200);

    const res = await decideUnmerge(officerD, caseId, { proposalVersion: 1 });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ statusCode: 'unmerged' });

    const ownerOf = async (enrolmentId: string) => (await rows<{ p: string }>(sql`SELECT person_id::text AS p FROM enrolment WHERE id = ${enrolmentId}::uuid AND recorded_until IS NULL`))[0]!.p;
    expect(await ownerOf(movedEnrolment)).toBe(merged);
    expect(await ownerOf(laterEnrolment)).toBe(merged);
    expect((await rows<{ p: string }>(sql`SELECT DISTINCT person_id::text AS p FROM fee_liability WHERE enrolment_id = ${movedEnrolment}::uuid`)).map((r) => r.p)).toEqual([merged]);
    // Each person has their own identity again.
    const nameOf = async (p: string) => (await rows<{ n: string }>(sql`SELECT legal_first_name AS n FROM person_identity WHERE person_id = ${p}::uuid AND recorded_until IS NULL`)).map((r) => r.n);
    expect(await nameOf(merged)).toEqual(['UnOld']);
    expect(await nameOf(survivor)).toEqual(['UnNew']);
    expect((await rows<{ s: string }>(sql`SELECT person_status_code AS s FROM person WHERE id = ${merged}::uuid`))[0]!.s).not.toBe('merged');
    expect(await rows(sql`SELECT 1 FROM person_identifier_alias WHERE value = '1833333333333'`)).toEqual([]);
    expect((await call(registry, 'GET', `/students/${merged}/adjustments`)).statusCode).toBe(200);

    const [event] = await rows<{ payload: { reallocatedToRestored: Record<string, string[]>; restoredPersonId: string } }>(sql`SELECT payload FROM workflow_event_outbox WHERE event_type = 'srs.person.unmerged' AND correlation_id = ${caseId}`);
    expect(event!.payload).toMatchObject({ restoredPersonId: merged, reallocatedToRestored: { enrolment: [laterEnrolment] } });
    expect((await rows<{ u: Date | null }>(sql`SELECT unmerged_at AS u FROM identity_merge WHERE id = ${mergeId}::uuid`))[0]!.u).not.toBeNull();

    // A second unmerge is refused; the two people can be merged again.
    expect((await call(officerC, 'POST', `/identity-merges/${mergeId}/unmerge-cases`)).statusCode).toBe(409);
    await mergeInto(merged, survivor, { identifierResolutions: { husid: { keep: 'survivor', reason: 'Confirmed again' } } });
  });

  it('is decided by someone who did not open or propose it, on the version they read', async () => {
    const merged = await person('SodOld'); const survivor = await person('SodNew');
    const mergeId = await mergeOf(await mergeInto(merged, survivor));
    const caseId = await open(mergeId);
    expect((await decideUnmerge(officerD, caseId, { proposalVersion: 1 })).statusCode).toBe(409); // no proposal yet
    expect((await call(officerD, 'PUT', `/identity-unmerge-cases/${caseId}/proposal`, { allocations: {} })).statusCode).toBe(200);
    for (const token of [officerC, officerD]) {
      const res = await decideUnmerge(token, caseId, { proposalVersion: 1 });
      expect(res.statusCode).toBe(403);
      expect(res.json<{ type: string }>().type).toMatch(/separation-of-duties$/);
    }
    const officerE = await ctx.makeJwt({ sub: 'officer-e', roles: ['identity-resolution-officer'] });
    expect((await decideUnmerge(officerE, caseId, { proposalVersion: 2 })).statusCode).toBe(409);
    const own = await ctx.makeJwt({ sub: 'officer-own2', roles: ['identity-resolution-officer'], srsPersonId: merged });
    expect((await decideUnmerge(own, caseId, { proposalVersion: 1 })).statusCode).toBe(403);
    expect((await decideUnmerge(registry, caseId, { proposalVersion: 1 })).statusCode).toBe(403);
    expect((await decideUnmerge(officerE, caseId, { proposalVersion: 1 })).statusCode).toBe(200);
  });

  it('is refused when the merged person has been anonymised since', async () => {
    const merged = await person('AnonOld'); const survivor = await person('AnonNew');
    const mergeId = await mergeOf(await mergeInto(merged, survivor));
    await ctx.db.execute(sql`UPDATE person SET retention_anonymised_at = now() WHERE id = ${merged}::uuid`);
    const caseId = await open(mergeId);
    await call(officerC, 'PUT', `/identity-unmerge-cases/${caseId}/proposal`, { allocations: {} });
    const res = await decideUnmerge(officerD, caseId, { proposalVersion: 1 });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ type: string }>().type).toBe('https://srs.example.com/errors/unmerge-not-allowed');
    expect((await rows<{ u: Date | null }>(sql`SELECT unmerged_at AS u FROM identity_merge WHERE id = ${mergeId}::uuid`))[0]!.u).toBeNull();
  });

  it('tells the ledger and IAM: an account the merge ended is restored', async () => {
    const merged = await person('IamUnOld'); const survivor = await person('IamUnNew');
    for (const p of [merged, survivor]) {
      await ctx.db.execute(sql`INSERT INTO delivery_item (tenant_id, flow_code, target_system, subject_type, subject_id, person_id, idempotency_key, payload, summary, fulfilment_mode_code, status_code)
        VALUES (${ctx.tenantId}::uuid, 'F-SIS-IAM-01', 'iam', 'person', ${p}::uuid, ${p}::uuid, ${`seed-un:${p}`}, '{}', 'seed', 'manual', 'delivered')`);
    }
    await ctx.db.execute(sql`INSERT INTO delivery_item (tenant_id, flow_code, target_system, subject_type, subject_id, person_id, idempotency_key, payload, summary, fulfilment_mode_code, status_code)
      VALUES (${ctx.tenantId}::uuid, 'F-SIS-LIB-01', 'lib', 'person', ${merged}::uuid, ${merged}::uuid, ${`seed-un-lib:${merged}`}, '{}', 'seed', 'manual', 'delivered')`);
    const mergeId = await mergeOf(await mergeInto(merged, survivor, { twoAccountsConfirmed: true }));
    const caseId = await open(mergeId);
    await call(officerC, 'PUT', `/identity-unmerge-cases/${caseId}/proposal`, { allocations: {} });
    expect((await decideUnmerge(officerD, caseId, { proposalVersion: 1 })).statusCode).toBe(200);
    const [iam] = await rows<{ payload: Record<string, unknown>; person_id: string }>(sql`SELECT payload, person_id::text FROM delivery_item WHERE idempotency_key = ${`person-unmerged:${mergeId}:iam`}`);
    expect(iam?.person_id).toBe(merged);
    expect(iam?.payload).toMatchObject({ instruction: 'restore', fromPersonId: survivor });
    const notices = await rows<{ flow_code: string; payload: Record<string, unknown> }>(sql`SELECT flow_code, payload FROM delivery_item WHERE idempotency_key = ${`person-unmerged:${mergeId}`}`);
    expect(notices.map((n) => n.flow_code)).toEqual(['F-SIS-LIB-01']);
    expect(notices[0]!.payload).toMatchObject({ messageType: 'person-unmerged', restoredPersonId: merged });
  });
});
