import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

/**
 * ADR-031 (BL-353, part of BL-289; BP-08 pre-review R08-9): a merge is the
 * execution of a recorded decision, taken by someone who did not prepare it,
 * on the current version of a proposal, and refused when it would merge the
 * wrong people, chain merges, touch anonymised or restricted records, or
 * leave conflicting statutory identifiers unresolved.
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

async function call(token: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: Record<string, unknown>) {
  return ctx.app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
}

async function person(name: string, extra: { hesaId?: string } = {}): Promise<string> {
  const res = await call(registry, 'POST', '/students', { legalFirstName: name, legalFamilyName: 'Merge' });
  expect(res.statusCode, res.body).toBe(201);
  const id = res.json<{ personId: string }>().personId;
  if (extra.hesaId) await ctx.db.execute(sql`UPDATE person SET hesa_id = ${extra.hesaId} WHERE id = ${id}::uuid`);
  return id;
}

/** A case on `subject` with `candidate`, prepared by officer-a, and a proposal to merge subject into candidate. */
async function prepared(subject: string, candidate: string, proposal: Record<string, unknown> = {}): Promise<string> {
  const open = await call(preparer, 'POST', '/identity-resolution/cases', { subjectPersonId: subject, ownerId: 'officer-a' });
  expect(open.statusCode, open.body).toBe(201);
  const caseId = open.json<{ identityResolutionCaseId: string }>().identityResolutionCaseId;
  expect((await call(preparer, 'POST', `/identity-resolution/cases/${caseId}/candidates`, { candidatePersonId: candidate, matchScore: 0.9, matchReasonCode: 'name-dob' })).statusCode).toBe(201);
  const p = await call(preparer, 'PUT', `/identity-resolution/cases/${caseId}/proposal`, { survivorPersonId: candidate, mergedPersonId: subject, ...proposal });
  expect(p.statusCode, p.body).toBe(200);
  return caseId;
}

const decide = (token: string, caseId: string, body: Record<string, unknown> = {}) =>
  call(token, 'POST', `/identity-resolution/cases/${caseId}/decision`, { decisionTypeCode: 'merge', proposalVersion: 1, reason: 'Same person', ...body });
const reasonOf = (res: { json: <T>() => T }) => res.json<{ errors?: { reasonCode?: string } }>().errors?.reasonCode;
const redirectsFrom = async (personId: string) =>
  (await ctx.db.execute(sql`SELECT new_person_id::text FROM identity_redirect WHERE old_person_id = ${personId}::uuid`) as unknown as Array<{ new_person_id: string }>).map((r) => r.new_person_id);

describe('who may decide (ADR-031 item 2)', () => {
  it('refuses the person who prepared the case, and anyone without identity-resolution:decide', async () => {
    const a = await person('Prep'); const b = await person('Prep2');
    const caseId = await prepared(a, b);
    const self = await decide(preparer, caseId);
    expect(self.statusCode).toBe(403);
    expect(self.json<{ type: string }>().type).toMatch(/separation-of-duties$/);
    expect((await decide(registry, caseId)).statusCode).toBe(403);
    expect(await redirectsFrom(a)).toEqual([]);
  });

  it('refuses whoever wrote the proposal or added a candidate, even if someone else opened the case', async () => {
    const a = await person('Prop'); const b = await person('Prop2');
    const caseId = await prepared(a, b);
    // officer-b revises the proposal: now officer-b has prepared too, and neither officer may decide.
    expect((await call(decider, 'PUT', `/identity-resolution/cases/${caseId}/proposal`, { survivorPersonId: b, mergedPersonId: a })).statusCode).toBe(200);
    expect((await decide(decider, caseId, { proposalVersion: 2 })).statusCode).toBe(403);
    const third = await ctx.makeJwt({ sub: 'officer-c', roles: ['identity-resolution-officer'] });
    expect((await decide(third, caseId, { proposalVersion: 2 })).statusCode).toBe(201);
  });

  it('refuses a decision about the decider\'s own record', async () => {
    const a = await person('Own'); const b = await person('Own2');
    const caseId = await prepared(a, b);
    const ownRecord = await ctx.makeJwt({ sub: 'officer-own', roles: ['identity-resolution-officer'], srsPersonId: b });
    expect((await decide(ownRecord, caseId)).statusCode).toBe(403);
  });
});

describe('the decision matches the proposal (ADR-031 item 3)', () => {
  it('refuses a stale proposal version, and a survivor named in the body', async () => {
    const a = await person('Stale'); const b = await person('Stale2');
    const caseId = await prepared(a, b);
    expect((await call(preparer, 'PUT', `/identity-resolution/cases/${caseId}/proposal`, { survivorPersonId: b, mergedPersonId: a, factChoices: { 'person-identity': 'merged' } })).statusCode).toBe(200);
    const stale = await decide(decider, caseId, { proposalVersion: 1 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ type: string }>().type).toMatch(/proposal-changed$/);
    expect((await decide(decider, caseId, { proposalVersion: 2, survivorPersonId: a })).statusCode).toBe(400);
    const ok = await decide(decider, caseId, { proposalVersion: 2 });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(await redirectsFrom(a)).toEqual([b]);
  });

  it('refuses a proposal that does not pair the subject with one of its candidates', async () => {
    const a = await person('Pair'); const b = await person('Pair2'); const stranger = await person('Stranger');
    const caseId = await prepared(a, b);
    expect((await call(preparer, 'PUT', `/identity-resolution/cases/${caseId}/proposal`, { survivorPersonId: stranger, mergedPersonId: a })).statusCode).toBe(200);
    const res = await decide(decider, caseId, { proposalVersion: 2 });
    expect(res.statusCode).toBe(422);
    expect(reasonOf(res)).toBe('not-a-candidate');
  });

  it('never chains merges, and refuses anonymised or restricted people', async () => {
    const a = await person('Chain'); const b = await person('Chain2'); const c = await person('Chain3');
    expect((await decide(decider, await prepared(a, b))).statusCode).toBe(201);
    const chained = await decide(decider, await prepared(a, c));
    expect(reasonOf(chained)).toBe('already-merged');

    const anon = await person('Anon'); const keep = await person('Keep');
    await ctx.db.execute(sql`UPDATE person SET retention_anonymised_at = now() WHERE id = ${anon}::uuid`);
    expect(reasonOf(await decide(decider, await prepared(anon, keep)))).toBe('anonymised');

    const restricted = await person('Restricted'); const other = await person('Other');
    await ctx.db.execute(sql`INSERT INTO processing_restriction (tenant_id, person_id, restriction_type_code, applied_by) VALUES (${ctx.tenantId}::uuid, ${restricted}::uuid, 'processing-paused', 'dpo')`);
    expect(reasonOf(await decide(decider, await prepared(restricted, other)))).toBe('restricted');
  });

  it('records a reject without a proposal check, and makes no redirect', async () => {
    const a = await person('Reject'); const b = await person('Reject2');
    const caseId = await prepared(a, b);
    expect((await call(decider, 'POST', `/identity-resolution/cases/${caseId}/decision`, { decisionTypeCode: 'reject', reason: 'Different people' })).statusCode).toBe(201);
    expect(await redirectsFrom(a)).toEqual([]);
  });
});

describe('statutory identifiers (ADR-031 item 4)', () => {
  it('blocks a merge until a HUSID conflict is resolved, then keeps the other value as an alias', async () => {
    const a = await person('Husid', { hesaId: '1811234567890' });
    const b = await person('Husid2', { hesaId: '1819876543210' });
    const caseId = await prepared(a, b);
    const proposal = (await call(decider, 'GET', `/identity-resolution/cases/${caseId}/proposal`)).json<{ identifierConflicts: Array<{ identifierClass: string; resolved: boolean }> }>();
    expect(proposal.identifierConflicts).toEqual([expect.objectContaining({ identifierClass: 'husid', resolved: false })]);

    expect(reasonOf(await decide(decider, caseId))).toBe('identifier-conflict');

    expect((await call(preparer, 'PUT', `/identity-resolution/cases/${caseId}/proposal`, {
      survivorPersonId: b, mergedPersonId: a, identifierResolutions: { husid: { keep: 'survivor', reason: 'HESA confirmed the survivor\'s HUSID' } },
    })).statusCode).toBe(200);
    expect((await decide(decider, caseId, { proposalVersion: 2 })).statusCode).toBe(201);
    const aliases = await ctx.db.execute(sql`SELECT person_id::text, identifier_class, value FROM person_identifier_alias WHERE source_person_id = ${a}::uuid`) as unknown as Array<{ person_id: string; identifier_class: string; value: string }>;
    expect(aliases).toEqual([{ person_id: b, identifier_class: 'husid', value: '1811234567890' }]);
  });
});

describe('two accounts (ADR-031 item 3)', () => {
  it('needs confirmation when both people have an institutional account', async () => {
    const a = await person('Account'); const b = await person('Account2');
    for (const p of [a, b]) {
      await ctx.db.execute(sql`
        INSERT INTO delivery_item (tenant_id, flow_code, target_system, subject_type, subject_id, person_id, idempotency_key, summary, fulfilment_mode_code, status_code)
        VALUES (${ctx.tenantId}::uuid, 'F-SIS-IAM-01', 'iam', 'person', ${p}::uuid, ${p}::uuid, ${`acct-${p}`}, 'account', 'manual', 'delivered')`);
    }
    const caseId = await prepared(a, b);
    expect(reasonOf(await decide(decider, caseId))).toBe('two-accounts-unconfirmed');
    expect((await call(preparer, 'PUT', `/identity-resolution/cases/${caseId}/proposal`, { survivorPersonId: b, mergedPersonId: a, twoAccountsConfirmed: true })).statusCode).toBe(200);
    expect((await decide(decider, caseId, { proposalVersion: 2 })).statusCode).toBe(201);
  });
});

describe('links (ADR-031 item 1)', () => {
  it('records related-record links only', async () => {
    const a = await person('Link'); const b = await person('Link2');
    expect((await call(preparer, 'POST', '/identity-resolution/links', { sourcePersonId: a, targetPersonId: b, linkTypeCode: 'related-record' })).statusCode).toBe(201);
    for (const linkTypeCode of ['merged-into', 'duplicate-of']) {
      expect((await call(preparer, 'POST', '/identity-resolution/links', { sourcePersonId: a, targetPersonId: b, linkTypeCode })).statusCode).toBe(400);
    }
    expect(await redirectsFrom(a)).toEqual([]);
  });
});
