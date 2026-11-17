/**
 * Right to study (D-17, BP-02-002) and financial registration (D-18, BP-02-004).
 */
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let registryJwt: string;
let officerJwt: string;
let financeJwt: string;
let secondFinanceJwt: string;
let adminJwt: string;

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, jwt: string, payload?: Record<string, unknown>) =>
  ctx.app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${jwt}` }, ...(payload ? { payload } : {}) });

interface Check { checkId: string; outcomeCode: string; basisCode: string | null; shareCodeSubmitted: boolean; checkedBy: string }
interface Registration { confirmation: { confirmationId: string; statusCode: string }; blockers: Array<{ code: string }> }
interface Liability { liabilityId: string; academicYear: string; financialStatusCode: string; payerArrangementCode: string | null; holdReasonCode: string | null; financiallyRegistered: boolean; feeStatusCode: string | null }

beforeAll(async () => {
  ctx = await startTestApp();
  registryJwt = await ctx.makeJwt({ sub: 'rts-registry', roles: ['registry-administrator'] });
  officerJwt = await ctx.makeJwt({ sub: 'rts-officer', roles: ['regulatory-officer'] });
  financeJwt = await ctx.makeJwt({ sub: 'fin-1', roles: ['finance-administrator'] });
  secondFinanceJwt = await ctx.makeJwt({ sub: 'fin-2', roles: ['finance-administrator'] });
  adminJwt = await ctx.makeJwt({ sub: 'rts-admin', roles: ['tenant-administrator'] });
  await call('PATCH', '/tenant/configuration', adminJwt, { registrationTermsVersion: '2040.1' });
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

/** A pre-registration enrolment (as applicant conversion leaves one), entering in the given year. */
async function preRegistered(name: string, entryYear: string): Promise<{ personId: string; enrolmentId: string; jwt: string }> {
  const personId = (await call('POST', '/students', registryJwt, { legalFirstName: name, legalFamilyName: 'Check' })).json<{ personId: string }>().personId;
  const enrolmentId = (await call('POST', '/enrolments', registryJwt, { personId, modeOfStudyCode: 'full-time', academicYearOfEntry: entryYear, startDate: `${entryYear.slice(0, 4)}-09-20`, feeStatusCode: 'home' }))
    .json<{ enrolmentId: string }>().enrolmentId;
  await ctx.db.execute(sql`UPDATE enrolment SET status_code = 'pre-registration' WHERE id = ${enrolmentId} AND recorded_until IS NULL`);
  return { personId, enrolmentId, jwt: await ctx.makeJwt({ sub: `rts-student-${name}`, roles: ['student'], srsPersonId: personId }) };
}

const registrations = async (s: { personId: string; jwt: string }) => (await call('GET', `/students/${s.personId}/registrations`, s.jwt)).json<Registration[]>();

describe('right to study (D-17)', () => {
  it('blocks initial registration until a current eligible check; a share code is completed in place; not eligible is referred', async () => {
    const s = await preRegistered('Rita', '2040-41');
    expect((await call('POST', '/registration-periods', registryJwt, { academicYear: '2040-41', opensAt: '2026-01-01T00:00:00Z', closesAt: '2099-01-01T00:00:00Z', periodTypeCode: 'initial' })).statusCode).toBe(201);
    const [mine] = await registrations(s);
    expect(mine!.blockers.map((b) => b.code)).toEqual(['right-to-study']);
    expect((await call('POST', `/registration-confirmations/${mine!.confirmation.confirmationId}/confirmation`, s.jwt, { acceptedTermsVersion: '2040.1' })).statusCode).toBe(409);

    // The student shares a code from the portal; others cannot.
    expect((await call('POST', `/students/${s.personId}/right-to-study/share-code`, s.jwt, { shareCode: 'bad' })).statusCode).toBe(400);
    const shared = await call('POST', `/students/${s.personId}/right-to-study/share-code`, s.jwt, { shareCode: 'W2X 4YZ 7AB' });
    expect(shared.statusCode).toBe(201);
    expect(shared.json<Check>()).toMatchObject({ outcomeCode: 'pending', shareCodeSubmitted: true });
    const other = await ctx.makeJwt({ sub: 'other', roles: ['student'], srsPersonId: randomUUID() });
    expect((await call('POST', `/students/${s.personId}/right-to-study/share-code`, other, { shareCode: 'W2X4YZ7AB' })).statusCode).toBe(403);
    expect((await call('GET', '/right-to-study/worklist', registryJwt)).json<Array<{ reason: string; check: Check }>>()
      .find((w) => w.check.checkId === shared.json<Check>().checkId)?.reason).toBe('share-code-submitted');

    // Recording not eligible refers it to a regulatory officer, who is someone else.
    const referred = await call('POST', `/students/${s.personId}/right-to-study`, registryJwt, { basisCode: 'other-permission', methodCode: 'view-and-prove', outcomeCode: 'not-eligible' });
    expect(referred.json<Check>()).toMatchObject({ checkId: shared.json<Check>().checkId, outcomeCode: 'referred', shareCodeSubmitted: false });
    expect((await call('POST', `/right-to-study/${referred.json<Check>().checkId}/decision`, registryJwt, { outcomeCode: 'eligible', note: 'x' })).statusCode).toBe(403);
    const decided = await call('POST', `/right-to-study/${referred.json<Check>().checkId}/decision`, officerJwt, { outcomeCode: 'eligible', note: 'Permission allows study (graduate route)' });
    expect(decided.json<Check>()).toMatchObject({ outcomeCode: 'eligible', checkedBy: 'rts-officer' });

    expect((await registrations(s))[0]!.blockers).toEqual([]);
    expect((await call('POST', `/registration-confirmations/${mine!.confirmation.confirmationId}/confirmation`, s.jwt, { acceptedTermsVersion: '2040.1' })).statusCode).toBe(200);
  });

  it('a sponsored student also needs the UK entry date; an expired permission blocks re-registration and raises a UKVI alert', async () => {
    const s = await preRegistered('Sami', '2041-42');
    await ctx.db.execute(sql`
      INSERT INTO cas_case (version_id, id, tenant_id, person_id, enrolment_id, cas_reference, status_code, actor_id, valid_from)
      VALUES (${randomUUID()}, ${randomUUID()}, ${ctx.tenantId}, ${s.personId}, ${s.enrolmentId}, 'CASSAMI0000001', 'assigned', 'fixture', now())`);
    await call('POST', '/registration-periods', registryJwt, { academicYear: '2041-42', opensAt: '2026-01-01T00:00:00Z', closesAt: '2099-01-01T00:00:00Z', periodTypeCode: 'initial' });
    expect((await call('POST', `/students/${s.personId}/right-to-study`, registryJwt, { basisCode: 'student-route', methodCode: 'view-and-prove', outcomeCode: 'eligible' })).statusCode).toBe(422); // needs expiry
    await call('POST', `/students/${s.personId}/right-to-study`, registryJwt, { basisCode: 'student-route', methodCode: 'view-and-prove', outcomeCode: 'eligible', permissionExpiresOn: '2099-01-31' });
    expect((await registrations(s))[0]!.blockers.map((b) => b.code)).toEqual(['uk-entry-date']);
    await call('POST', `/students/${s.personId}/right-to-study`, registryJwt, { basisCode: 'student-route', methodCode: 'view-and-prove', outcomeCode: 'eligible', permissionExpiresOn: '2099-01-31', ukEntryDate: '2041-09-10' });
    expect((await registrations(s))[0]!.blockers).toEqual([]);

    // The permission lapses: a warning, a UKVI alert, and a blocked re-registration; the enrolment is untouched.
    await ctx.db.execute(sql`UPDATE right_to_study_check SET permission_expires_on = '2026-01-01' WHERE person_id = ${s.personId} AND recorded_until IS NULL`);
    await ctx.db.execute(sql`UPDATE enrolment SET status_code = 'enrolled' WHERE id = ${s.enrolmentId} AND recorded_until IS NULL`);
    const scan = await ctx.app.rightToStudyService.scanExpiry(ctx.tenantId);
    expect(scan.alerts).toBeGreaterThanOrEqual(1);
    expect((await ctx.app.rightToStudyService.scanExpiry(ctx.tenantId)).alerts).toBe(0); // idempotent
    const alerts = (await ctx.db.execute(sql`SELECT count(*)::int AS n FROM ukvi_compliance_alert WHERE enrolment_id = ${s.enrolmentId} AND alert_type_code = 'permission-expired'`)) as unknown as Array<{ n: number }>;
    expect(alerts[0]!.n).toBe(1);
    await call('POST', '/registration-periods', registryJwt, { academicYear: '2042-43', opensAt: '2026-01-01T00:00:00Z', closesAt: '2099-01-01T00:00:00Z' });
    expect((await registrations(s)).find((r) => r.blockers.length > 0)?.blockers.map((b) => b.code)).toEqual(['permission-expired']);
    expect((await call('GET', `/enrolments/${s.enrolmentId}`, registryJwt)).json<{ statusCode: string }>().statusCode).toBe('enrolled');
  });
});

describe('financial registration (D-18)', () => {
  it('is a separate state per year: set by finance or SLC, sent to Finance, and never blocks by default', async () => {
    const s = await preRegistered('Fay', '2043-44');
    await ctx.db.execute(sql`UPDATE enrolment SET status_code = 'enrolled' WHERE id = ${s.enrolmentId} AND recorded_until IS NULL`);
    const [liability] = (await call('GET', `/enrolments/${s.enrolmentId}/financial-registration`, financeJwt)).json<Liability[]>();
    expect(liability).toMatchObject({ academicYear: '2043-44', financialStatusCode: 'pending', financiallyRegistered: false, feeStatusCode: 'home' });

    expect((await call('POST', `/fee-liabilities/${liability!.liabilityId}/financial-status`, financeJwt, { financialStatusCode: 'hold' })).statusCode).toBe(422); // needs a reason
    expect((await call('POST', `/fee-liabilities/${liability!.liabilityId}/financial-status`, registryJwt, { financialStatusCode: 'arranged' })).statusCode).toBe(403);
    const hold = await call('POST', `/fee-liabilities/${liability!.liabilityId}/financial-status`, financeJwt, { financialStatusCode: 'hold', holdReasonCode: 'tuition-unpaid' });
    expect(hold.json<Liability>()).toMatchObject({ financialStatusCode: 'hold', holdReasonCode: 'tuition-unpaid' });
    const delivered = (await ctx.db.execute(sql`SELECT count(*)::int AS n FROM delivery_item WHERE flow_code = 'F-SIS-FIN-01' AND subject_id = ${liability!.liabilityId}`)) as unknown as Array<{ n: number }>;
    expect(delivered[0]!.n).toBeGreaterThanOrEqual(1);

    // Default: a hold does not block re-registration.
    await call('POST', '/registration-periods', registryJwt, { academicYear: '2044-45', opensAt: '2026-01-01T00:00:00Z', closesAt: '2099-01-01T00:00:00Z' });
    const next = (await registrations(s)).find((r) => r.confirmation.statusCode === 'pending');
    expect(next?.blockers.map((b) => b.code) ?? []).not.toContain('tuition-hold');

    // With the tuition-hold policy, only a tuition hold blocks.
    await call('PATCH', '/tenant/configuration', adminJwt, { registration: { financialHoldBlocks: 'tuition-hold' } });
    expect((await registrations(s)).find((r) => r.confirmation.statusCode === 'pending')!.blockers.map((b) => b.code)).toContain('tuition-hold');
    await call('POST', `/fee-liabilities/${liability!.liabilityId}/financial-status`, financeJwt, { financialStatusCode: 'hold', holdReasonCode: 'accommodation-debt' });
    expect((await registrations(s)).find((r) => r.confirmation.statusCode === 'pending')!.blockers.map((b) => b.code)).not.toContain('tuition-hold');
    await call('PATCH', '/tenant/configuration', adminJwt, { registration: { financialHoldBlocks: 'none' } });

    // Finance's own report (F-FIN-SIS-01) and an SLC tuition-fee-loan confirmation both arrange a year.
    const finance = await call('POST', '/financial-registration/finance-updates', financeJwt, { enrolmentId: s.enrolmentId, academicYear: '2043-44', financialStatusCode: 'arranged', payerArrangementCode: 'self-pay', financeReference: 'FIN-77' });
    expect(finance.json<Liability>()).toMatchObject({ financialStatusCode: 'arranged', financiallyRegistered: true, payerArrangementCode: 'self-pay' });
    await ctx.db.execute(sql`INSERT INTO fee_liability (tenant_id, enrolment_id, person_id, academic_year, status_code) VALUES (${ctx.tenantId}, ${s.enrolmentId}, ${s.personId}, '2045-46', 'generated')`);
    const slc = await call('POST', '/regulatory/slc/notifications', registryJwt, { enrolmentId: s.enrolmentId, notificationTypeCode: 'entitlement-confirmed', effectiveDate: '2045-10-01' });
    expect(slc.statusCode).toBe(201);
    const years = (await call('GET', `/enrolments/${s.enrolmentId}/financial-registration`, financeJwt)).json<Liability[]>();
    expect(years.find((y) => y.academicYear === '2045-46')).toMatchObject({ financialStatusCode: 'arranged', payerArrangementCode: 'slc-tuition-loan' });
  });

  it('a fee-status change after conversion is a reassessment decided by another finance administrator', async () => {
    const s = await preRegistered('Gus', '2046-47');
    expect((await call('POST', `/enrolments/${s.enrolmentId}/fee-status-reassessments`, registryJwt, { feeStatusCode: 'home', reason: 'x' })).statusCode).toBe(409); // already home
    const proposed = await call('POST', `/enrolments/${s.enrolmentId}/fee-status-reassessments`, registryJwt, { feeStatusCode: 'overseas', reason: 'Residency evidence did not meet the three-year rule' });
    expect(proposed.statusCode).toBe(201);
    const caseId = proposed.json<{ caseId: string }>().caseId;
    expect((await call('POST', `/enrolments/${s.enrolmentId}/fee-status-reassessments`, financeJwt, { feeStatusCode: 'islands', reason: 'y' })).statusCode).toBe(409); // one open at a time
    expect((await call('POST', `/fee-status-reassessments/${caseId}/decision`, registryJwt, { outcome: 'approved' })).statusCode).toBe(403);
    const decided = await call('POST', `/fee-status-reassessments/${caseId}/decision`, secondFinanceJwt, { outcome: 'approved', note: 'Evidence reviewed' });
    expect(decided.json()).toMatchObject({ statusCode: 'decided', currentFeeStatusCode: 'overseas', decision: { outcome: 'approved', decidedBy: 'fin-2' } });
    expect((await call('GET', `/enrolments/${s.enrolmentId}`, registryJwt)).json<{ feeStatusCode: string }>().feeStatusCode).toBe('overseas');
    const own = await call('POST', `/enrolments/${s.enrolmentId}/fee-status-reassessments`, financeJwt, { feeStatusCode: 'home', reason: 'Appeal upheld' });
    expect((await call('POST', `/fee-status-reassessments/${own.json<{ caseId: string }>().caseId}/decision`, financeJwt, { outcome: 'approved' })).statusCode).toBe(409);
  });
});
