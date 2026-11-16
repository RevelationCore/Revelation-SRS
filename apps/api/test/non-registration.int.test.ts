/**
 * Failure to register (BP-02-011; D-9).
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

interface Case {
  caseId: string; statusCode: string; enrolmentId: string; confirmationId: string; flags: string[];
  contactAttempts: Array<{ channelCode: string; reference: string }>; ukviReportDueBy: string | null;
  outcome: { outcomeCode: string; statusCaseId: string | null; effectiveAt: string } | null;
}

beforeAll(async () => {
  ctx = await startTestApp();
  registryJwt = await ctx.makeJwt({ sub: 'nr-registry', roles: ['registry-administrator'] });
  secondRegistryJwt = await ctx.makeJwt({ sub: 'nr-registry-2', roles: ['registry-administrator'] });
  adminJwt = await ctx.makeJwt({ sub: 'nr-admin', roles: ['tenant-administrator'] });
  await call('PATCH', '/tenant/configuration', adminJwt, { registrationTermsVersion: '2030.1' });
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

async function student(name: string): Promise<{ personId: string; enrolmentId: string }> {
  const personId = (await call('POST', '/students', registryJwt, { legalFirstName: name, legalFamilyName: 'Lapse' })).json<{ personId: string }>().personId;
  const enrolmentId = (await call('POST', '/enrolments', registryJwt, { personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2025-26', startDate: '2025-09-21' }))
    .json<{ enrolmentId: string }>().enrolmentId;
  // A continuing student's record has existed since entry, so backdated withdrawals are valid.
  await ctx.db.execute(sql`UPDATE enrolment SET valid_from = '2025-09-01' WHERE id = ${enrolmentId} AND recorded_until IS NULL`);
  return { personId, enrolmentId };
}

/** Opens and closes an already-ended period, so everyone still pending lapses. */
async function lapse(academicYear: string): Promise<void> {
  const period = (await call('POST', '/registration-periods', registryJwt, { academicYear, opensAt: '2026-01-01T00:00:00Z', closesAt: '2026-06-01T00:00:00Z' })).json<{ periodId: string }>();
  expect((await call('POST', `/registration-periods/${period.periodId}/closure`, registryJwt)).statusCode).toBe(200);
}

const caseFor = async (enrolmentId: string): Promise<Case> =>
  (await call('GET', `/non-registration-cases?enrolmentId=${enrolmentId}`, registryJwt)).json<Case[]>()[0]!;

describe('failure to register', () => {
  it('a lapse opens a case; non-registration needs contact attempts and notice, then opens a withdrawal someone else decides', async () => {
    const s = await student('Nora');
    await lapse('2030-31');
    const opened = await caseFor(s.enrolmentId);
    expect(opened).toMatchObject({ statusCode: 'open', flags: [], contactAttempts: [], outcome: null, ukviReportDueBy: null });
    const id = opened.caseId;
    const decide = (body: Record<string, unknown>) => call('POST', `/non-registration-cases/${id}/decision`, registryJwt, { reason: 'Did not register or respond', policyVersion: 'GR-2030', ...body });

    expect((await decide({})).statusCode).toBe(409); // no contact attempts yet
    expect((await call('POST', `/non-registration-cases/${id}/contact-attempts`, registryJwt, { channelCode: 'phone' })).statusCode).toBe(422); // needs a reference
    expect((await call('POST', `/non-registration-cases/${id}/contact-attempts`, registryJwt, { channelCode: 'pigeon', reference: 'x' })).statusCode).toBe(422);
    expect((await call('POST', `/non-registration-cases/${id}/contact-attempts`, registryJwt, { channelCode: 'phone', reference: 'Call log 2030-07-01' })).statusCode).toBe(201);
    const portal = await call('POST', `/non-registration-cases/${id}/contact-attempts`, registryJwt, { channelCode: 'portal' });
    expect(portal.statusCode).toBe(201);
    expect(portal.json<Case>().contactAttempts.map((a) => a.channelCode)).toEqual(['phone', 'portal']);
    const notes = (await ctx.db.execute(sql`SELECT count(*)::int AS n FROM notification WHERE person_id = ${s.personId} AND category = 'registration'`)) as unknown as Array<{ n: number }>;
    expect(notes[0]!.n).toBe(1);

    // Two contacts but the 14-day notice has not run.
    expect((await decide({})).statusCode).toBe(409);
    // The student says in writing they are not continuing: the minimums no longer apply.
    expect((await call('POST', `/non-registration-cases/${id}/written-statement`, registryJwt, { reference: 'Email 2030-07-03' })).statusCode).toBe(201);
    expect((await decide({ effectiveDate: '2026-05-01', lastEngagementDate: '2026-05-20' })).statusCode).toBe(422);
    const decided = await decide({ lastEngagementDate: '2026-05-20' });
    expect(decided.statusCode).toBe(200);
    const outcome = decided.json<Case>();
    expect(outcome).toMatchObject({ statusCode: 'decided', outcome: { outcomeCode: 'non-registration', effectiveAt: '2026-06-01T00:00:00.000Z' } });
    expect((await decide({})).statusCode).toBe(409); // already resolved

    // The withdrawal is institution-initiated and the decider of non-registration cannot approve it.
    const statusCaseId = outcome.outcome!.statusCaseId!;
    const withdrawal = (await call('GET', `/status-cases/${statusCaseId}`, registryJwt)).json<{ caseTypeCode: string; initiatedByCode: string; reasonCategoryCode: string; requestedEffectiveDate: string }>();
    expect(withdrawal).toMatchObject({ caseTypeCode: 'withdrawal', initiatedByCode: 'institution', reasonCategoryCode: 'non-registration', requestedEffectiveDate: '2026-06-01' });
    expect((await call('POST', `/status-cases/${statusCaseId}/decision`, registryJwt, { decisionCode: 'approved', reason: 'Non-registration' })).statusCode).toBe(409);
    const approved = await call('POST', `/status-cases/${statusCaseId}/decision`, secondRegistryJwt, { decisionCode: 'approved', reason: 'Non-registration' });
    expect(approved.statusCode, approved.body).toBe(200);
    const enrolment = (await call('GET', `/enrolments/${s.enrolmentId}`, registryJwt)).json<{ statusCode: string }>();
    expect(enrolment.statusCode).toBe('withdrawn');
  });

  it('a late registration closes the case; a sponsored student\'s lapse is flagged and raises a UKVI alert with the 10-working-day deadline', async () => {
    const late = await student('Lena');
    const sponsored = await student('Sami');
    await ctx.db.execute(sql`
      INSERT INTO ukvi_visa_status (id, tenant_id, enrolment_id, cas_reference, status_code, effective_date, valid_from)
      VALUES (${randomUUID()}, ${ctx.tenantId}, ${sponsored.enrolmentId}, 'CAS-NR-1', 'active', '2025-09-01', now())`);
    await lapse('2031-32');

    const lateCase = await caseFor(late.enrolmentId);
    const registrations = (await call('GET', `/students/${late.personId}/registrations`, registryJwt)).json<Array<{ confirmation: { confirmationId: string } ; period: { academicYear: string } }>>();
    const confirmationId = registrations.find((r) => r.period.academicYear === '2031-32')!.confirmation.confirmationId;
    expect(lateCase.confirmationId).toBe(confirmationId);
    expect((await call('POST', `/registration-confirmations/${confirmationId}/confirmation`, registryJwt, { acceptedTermsVersion: '2030.1', assistedReasonCode: 'late' })).statusCode).toBe(200);
    expect(await caseFor(late.enrolmentId)).toMatchObject({ statusCode: 'closed', outcome: { outcomeCode: 'registered-late' } });

    const sponsoredCase = await caseFor(sponsored.enrolmentId);
    // 2026-06-01 is a Monday; ten working days later is Monday 15 June.
    expect(sponsoredCase).toMatchObject({ statusCode: 'under-review', flags: ['sponsored'], ukviReportDueBy: '2026-06-15T00:00:00.000Z' });
    const alerts = (await ctx.db.execute(sql`SELECT count(*)::int AS n FROM ukvi_compliance_alert WHERE enrolment_id = ${sponsored.enrolmentId} AND alert_type_code = 'non-enrolment' AND resolved_at IS NULL`)) as unknown as Array<{ n: number }>;
    expect(alerts[0]!.n).toBe(1);

    // Open cases list only unresolved ones.
    const open = (await call('GET', '/non-registration-cases?open=true', registryJwt)).json<Case[]>();
    expect(open.map((c) => c.enrolmentId)).toContain(sponsored.enrolmentId);
    expect(open.map((c) => c.enrolmentId)).not.toContain(late.enrolmentId);
  });

  it('the notice period is configurable, and only the registry may act on cases', async () => {
    const s = await student('Omar');
    await lapse('2032-33');
    const { caseId } = await caseFor(s.enrolmentId);
    const tutorJwt = await ctx.makeJwt({ sub: 'nr-tutor', roles: ['personal-tutor'] });
    expect((await call('GET', `/non-registration-cases/${caseId}`, tutorJwt)).statusCode).toBe(200);
    expect((await call('POST', `/non-registration-cases/${caseId}/contact-attempts`, tutorJwt, { channelCode: 'phone', reference: 'x' })).statusCode).toBe(403);

    await call('PATCH', '/tenant/configuration', adminJwt, { nonRegistrationNoticeDays: 0, nonRegistrationMinContactAttempts: 1 });
    await call('POST', `/non-registration-cases/${caseId}/contact-attempts`, registryJwt, { channelCode: 'email', reference: 'msg-123' });
    const decided = await call('POST', `/non-registration-cases/${caseId}/decision`, registryJwt, { reason: 'No response', policyVersion: 'GR-2032' });
    expect(decided.statusCode).toBe(200);
    await call('PATCH', '/tenant/configuration', adminJwt, { nonRegistrationNoticeDays: 14, nonRegistrationMinContactAttempts: 2 });
  });
});
