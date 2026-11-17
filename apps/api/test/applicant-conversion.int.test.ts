/**
 * Applicant conversion and initial registration (BP-01-007, BP-02-001; D-10).
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let connectorJwt: string;
let registryJwt: string;
let selectorJwt: string;
let adminJwt: string;
let programmeId: string;

interface Conversion {
  enrolmentId: string | null; enrolmentExists: boolean; personId: string | null; programmeId: string | null; programmeSource: string | null;
  modeOfStudyCode: string | null; academicYearOfEntry: string | null; startDate: string | null; handoffTaskId: string | null; handoffTaskStatus: string | null;
  blockers: Array<{ code: string }>;
}

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, as: string, payload?: Record<string, unknown>) =>
  ctx.app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${as}` }, ...(payload ? { payload } : {}) });

beforeAll(async () => {
  ctx = await startTestApp();
  connectorJwt = await ctx.makeJwt({ sub: 'ucas-connector', roles: ['integration-service'] });
  registryJwt = await ctx.makeJwt({ sub: 'conv-registry', roles: ['registry-administrator'] });
  selectorJwt = await ctx.makeJwt({ sub: 'conv-selector', roles: ['programme-approver'] });
  adminJwt = await ctx.makeJwt({ sub: 'conv-admin', roles: ['tenant-administrator'] });
  programmeId = (await call('POST', '/programmes', registryJwt, { code: 'CONV-BSC', title: 'BSc Conversion', fheqLevel: 6, creditTotal: 360 })).json<{ programmeId: string }>().programmeId;
  await call('PATCH', '/tenant/configuration', adminJwt, { registrationTermsVersion: '2027.1' });
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

/** An application with an accepted, confirmed unconditional offer. */
async function confirmedApplicant(ref: string, first: string): Promise<{ applicationId: string; personId: string }> {
  const app = (await call('POST', '/applications', connectorJwt, {
    channelCode: 'ucas', sourceReference: ref, cycle: '2027', programmeId, intakeCode: '2027-09', modeOfStudyCode: 'full-time',
    applicant: { legalFirstName: first, legalFamilyName: `Convert${ref}` }, payload: {},
  })).json<{ id: string; personId: string }>();
  await call('POST', `/applications/${app.id}/assessments`, selectorJwt, { assessmentTypeCode: 'academic', outcomeCode: 'meets', evidenceRef: 'ucas:quals', evidenceVersion: '1' });
  await call('POST', `/applications/${app.id}/recommendation`, registryJwt, { recommendationCode: 'offer', reason: 'Meets criteria' });
  const offer = (await call('POST', `/applications/${app.id}/decision`, selectorJwt, { decisionCode: 'offer', offer: { offerTypeCode: 'unconditional' } }))
    .json<{ offers: Array<{ id: string }> }>().offers[0]!;
  await call('POST', `/admissions-offers/${offer.id}/response`, connectorJwt, { responseCode: 'accept', sourceTimestamp: '2027-05-01T12:00:00Z' });
  expect((await call('POST', `/admissions-offers/${offer.id}/confirmation`, selectorJwt, { decisionCode: 'confirmed' })).statusCode).toBe(200);
  return { applicationId: app.id, personId: app.personId };
}

const count = async (q: ReturnType<typeof sql>) => ((await ctx.db.execute(q)) as unknown as Array<{ n: number }>)[0]!.n;

describe('applicant conversion', () => {
  it('completing the hand-off creates one pre-registration enrolment from the offer; initial registration enrols the student', async () => {
    const { applicationId, personId } = await confirmedApplicant('CONV-001', 'Ivy');
    const preview = (await call('GET', `/applications/${applicationId}/enrolment-conversion`, registryJwt)).json<Conversion>();
    expect(preview).toMatchObject({
      personId, programmeId, programmeSource: 'offer', modeOfStudyCode: 'full-time', academicYearOfEntry: '2027-28', startDate: '2027-09-01',
      enrolmentExists: false, handoffTaskStatus: 'assigned', blockers: [],
    });

    const converted = await call('POST', `/applications/${applicationId}/enrolment-conversion`, registryJwt, {});
    expect(converted.statusCode).toBe(200);
    const result = converted.json<Conversion>();
    expect(result).toMatchObject({ enrolmentId: preview.enrolmentId, enrolmentExists: true, handoffTaskStatus: 'completed' });
    const enrolmentId = result.enrolmentId!;

    // Converting again returns the same enrolment.
    const again = (await call('POST', `/applications/${applicationId}/enrolment-conversion`, registryJwt, {})).json<Conversion>();
    expect(again.enrolmentId).toBe(enrolmentId);
    expect(await count(sql`SELECT count(*)::int AS n FROM enrolment WHERE person_id = ${personId} AND recorded_until IS NULL`)).toBe(1);

    const enrolment = (await call('GET', `/enrolments/${enrolmentId}`, registryJwt)).json<{ statusCode: string; programmeId: string; startDate: string }>();
    expect(enrolment).toMatchObject({ statusCode: 'pre-registration', programmeId, startDate: '2027-09-01' });
    expect(await count(sql`SELECT count(*)::int AS n FROM fee_liability WHERE enrolment_id = ${enrolmentId}`)).toBe(0);
    expect(await count(sql`SELECT count(*)::int AS n FROM enrolment_downstream_trigger WHERE enrolment_id = ${enrolmentId}`)).toBe(0);
    expect((await ctx.db.execute(sql`SELECT person_status_code AS s FROM person WHERE id = ${personId}`) as unknown as Array<{ s: string }>)[0]!.s).toBe('prospective');

    // The student registers in an initial registration period.
    const period = await call('POST', '/registration-periods', registryJwt, {
      academicYear: '2027-28', opensAt: '2026-01-01T00:00:00Z', closesAt: '2030-01-01T00:00:00Z', periodTypeCode: 'initial',
    });
    expect(period.statusCode).toBe(201);
    const studentJwt = await ctx.makeJwt({ sub: 'conv-student', roles: ['student'], srsPersonId: personId });
    const [mine] = (await call('GET', `/students/${personId}/registrations`, studentJwt)).json<Array<{ confirmation: { confirmationId: string; statusCode: string } }>>();
    expect(mine!.confirmation.statusCode).toBe('pending');
    const confirmed = await call('POST', `/registration-confirmations/${mine!.confirmation.confirmationId}/confirmation`, studentJwt, { acceptedTermsVersion: '2027.1' });
    expect(confirmed.statusCode).toBe(200);

    expect((await call('GET', `/enrolments/${enrolmentId}`, registryJwt)).json<{ statusCode: string }>().statusCode).toBe('enrolled');
    expect(await count(sql`SELECT count(*)::int AS n FROM fee_liability WHERE enrolment_id = ${enrolmentId} AND academic_year = '2027-28'`)).toBe(1);
    expect((await ctx.db.execute(sql`SELECT person_status_code AS s FROM person WHERE id = ${personId}`) as unknown as Array<{ s: string }>)[0]!.s).toBe('student');
  });

  it('refuses without a confirmed offer, and a pre-registration student who never arrives can be withdrawn', async () => {
    const unconfirmed = (await call('POST', '/applications', connectorJwt, {
      channelCode: 'ucas', sourceReference: 'CONV-002', cycle: '2027', programmeId, intakeCode: '2027-09', modeOfStudyCode: 'full-time',
      applicant: { legalFirstName: 'Una', legalFamilyName: 'Confirmed' }, payload: {},
    })).json<{ id: string }>();
    expect((await call('GET', `/applications/${unconfirmed.id}/enrolment-conversion`, registryJwt)).json<Conversion>().blockers.map((b) => b.code)).toEqual(['no-confirmed-offer']);
    expect((await call('POST', `/applications/${unconfirmed.id}/enrolment-conversion`, registryJwt, {})).statusCode).toBe(409);
    expect((await call('GET', `/applications/${unconfirmed.id}/enrolment-conversion`, selectorJwt)).statusCode).toBe(403);

    const { applicationId } = await confirmedApplicant('CONV-003', 'Noel');
    const { enrolmentId } = (await call('POST', `/applications/${applicationId}/enrolment-conversion`, registryJwt, { startDate: '2027-09-20' })).json<Conversion>();
    await ctx.db.execute(sql`UPDATE enrolment SET valid_from = '2027-01-01' WHERE id = ${enrolmentId} AND recorded_until IS NULL`);
    const withdrawal = await call('POST', `/enrolments/${enrolmentId}/status-cases`, registryJwt, {
      caseTypeCode: 'withdrawal', initiatedByCode: 'institution', requestedEffectiveDate: '2027-10-10', institutionalOutcomeRef: 'no-show:2027-10',
    });
    expect(withdrawal.statusCode).toBe(201);
  });
});
