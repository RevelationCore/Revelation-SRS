/**
 * Access and entitlements follow status, then leaver closure (Phase 3 D-19, BP-02-005).
 */
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let registryJwt: string;
let secondRegistryJwt: string;
let adminJwt: string;

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, jwt: string, payload?: Record<string, unknown>) =>
  ctx.app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${jwt}` }, ...(payload ? { payload } : {}) });

interface Item { flowCode: string; subjectId: string; payload: Record<string, unknown>; summary: string }

beforeAll(async () => {
  ctx = await startTestApp();
  registryJwt = await ctx.makeJwt({ sub: 'acc-registry', roles: ['registry-administrator'] });
  secondRegistryJwt = await ctx.makeJwt({ sub: 'acc-registry-2', roles: ['registry-administrator'] });
  adminJwt = await ctx.makeJwt({ sub: 'acc-admin', roles: ['tenant-administrator'] });
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

const iamItems = async (personId: string) => ((await ctx.db.execute(sql`
  SELECT payload, summary FROM delivery_item WHERE flow_code = 'F-SIS-IAM-01' AND person_id = ${personId} ORDER BY created_at`)) as unknown as Array<{ payload: Record<string, unknown>; summary: string }>);

describe('access and entitlements (D-19)', () => {
  it('the account is full while enrolled, kept after withdrawal, and ends at leaver closure plus the grace period', async () => {
    const personId = (await call('POST', '/students', registryJwt, { legalFirstName: 'Ada', legalFamilyName: 'Access' })).json<{ personId: string }>().personId;
    const enrolmentId = (await call('POST', '/enrolments', registryJwt, { personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2026-27', startDate: '2026-09-21' }))
      .json<{ enrolmentId: string }>().enrolmentId;
    await ctx.db.execute(sql`UPDATE enrolment SET valid_from = '2026-01-01' WHERE id = ${enrolmentId} AND recorded_until IS NULL`);
    expect((await iamItems(personId)).at(-1)?.payload).toMatchObject({
      accessLevel: 'full', contractVersion: 2, accountKind: 'student', roles: ['student'], stateHash: expect.stringMatching(/^sha256:/) as string,
    });

    // Withdrawal: study access is revoked (library), the account stays limited for results and appeals.
    const withdrawal = (await call('POST', `/enrolments/${enrolmentId}/status-cases`, registryJwt, { caseTypeCode: 'withdrawal', initiatedByCode: 'institution', requestedEffectiveDate: '2027-01-10', institutionalOutcomeRef: 'board:1' })).json<{ statusCaseId: string }>();
    expect((await call('POST', `/status-cases/${withdrawal.statusCaseId}/decision`, secondRegistryJwt, { decisionCode: 'approved', reason: 'Withdrawn' })).statusCode).toBe(200);
    expect((await iamItems(personId)).at(-1)?.payload).toMatchObject({ accessLevel: 'limited', enrolmentStatuses: ['withdrawn'] });

    // Leaver closure ends the account 45 days on (the tenant's grace for a withdrawal).
    await call('PATCH', '/tenant/configuration', adminJwt, { access: { graceDays: { withdrawn: 45, graduated: 90 } } });
    const closure = (await call('POST', `/enrolments/${enrolmentId}/status-cases`, registryJwt, { caseTypeCode: 'leaver-closure', requestedEffectiveDate: '2027-02-01' })).json<{ statusCaseId: string }>();
    expect((await call('POST', `/status-cases/${closure.statusCaseId}/decision`, secondRegistryJwt, { decisionCode: 'approved', reason: 'Closed' })).statusCode).toBe(200);
    const ended = (await iamItems(personId)).at(-1)!;
    const expected = new Date(Date.now() + 45 * 86_400_000).toISOString().slice(0, 10);
    expect(ended.payload).toMatchObject({ accessLevel: 'ended', effectiveFrom: `${expected}T00:00:00.000Z` });
    expect(ended.summary).toContain('leaver closure plus 45 days');

    // The student record's entitlements view: the latest item per flow.
    const entitlements = (await call('GET', `/students/${personId}/entitlements`, registryJwt)).json<Item[]>();
    const iam = entitlements.filter((e) => e.flowCode === 'F-SIS-IAM-01');
    expect(iam).toHaveLength(1);
    expect(iam[0]!.payload['accessLevel']).toBe('ended');
    expect(entitlements.map((e) => e.flowCode)).toContain('F-SIS-LIB-01');
  });

  it('another enrolment in progress keeps the account open after a leaver closure', async () => {
    const personId = (await call('POST', '/students', registryJwt, { legalFirstName: 'Bo', legalFamilyName: 'Twice' })).json<{ personId: string }>().personId;
    const first = (await call('POST', '/enrolments', registryJwt, { personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2026-27', startDate: '2026-09-21' })).json<{ enrolmentId: string }>().enrolmentId;
    await call('POST', '/enrolments', registryJwt, { personId, modeOfStudyCode: 'part-time', academicYearOfEntry: '2026-27', startDate: '2026-09-21' });
    await ctx.db.execute(sql`UPDATE enrolment SET status_code = 'withdrawn' WHERE id = ${first} AND recorded_until IS NULL`);
    const closure = (await call('POST', `/enrolments/${first}/status-cases`, registryJwt, { caseTypeCode: 'leaver-closure', requestedEffectiveDate: '2027-02-01' })).json<{ statusCaseId: string }>();
    expect((await call('POST', `/status-cases/${closure.statusCaseId}/decision`, secondRegistryJwt, { decisionCode: 'approved', reason: 'Closed' })).statusCode).toBe(200);
    expect((await iamItems(personId)).every((i) => i.payload['accessLevel'] !== 'ended')).toBe(true);
  });

  it('a converted applicant has a limited account and no study access', async () => {
    const personId = (await call('POST', '/students', registryJwt, { legalFirstName: 'Pre', legalFamilyName: 'Reg' })).json<{ personId: string }>().personId;
    const enrolmentId = randomUUID();
    await ctx.app.enrolmentService.createEnrolment(ctx.tenantId, { personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2027-28', startDate: '2027-09-20' }, 'acc-registry',
      { enrolmentId, initialStatus: 'pre-registration' });
    expect((await iamItems(personId)).map((i) => i.payload['accessLevel'])).toEqual(['limited']);
    const library = (await ctx.db.execute(sql`SELECT count(*)::int AS n FROM delivery_item WHERE flow_code = 'F-SIS-LIB-01' AND person_id = ${personId}`)) as unknown as Array<{ n: number }>;
    expect(library[0]!.n).toBe(0);
  });
});
