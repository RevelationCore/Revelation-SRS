/**
 * One CAS record (BPR-D03; Phase 3 D-16): opened on the application, checked,
 * prepared, approved by someone else, exported to SMS, assigned, then carried
 * onto the enrolment at conversion.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { recordRequiredCasChecks } from './helpers/cas.js';
import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let connectorJwt: string;
let registryJwt: string;
let selectorJwt: string;
let officerJwt: string;
let secondOfficerJwt: string;
let programmeId: string;

interface CasCase {
  casCaseId: string; statusCode: string; personId: string; applicationId: string | null; enrolmentId: string | null; casReference: string | null;
  preparedPayload: Record<string, unknown> | null;
  eligibilityChecks: Array<{ checkTypeCode: string; resultCode: string }>;
  assignmentVersions: Array<{ versionNumber: number; casNumber: string | null; smsRequestSentAt: string | null; smsReceiptRef: string | null; approvedBy: string }>;
}

const call = (method: 'GET' | 'POST', url: string, as: string, payload?: Record<string, unknown>) =>
  ctx.app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${as}` }, ...(payload ? { payload } : {}) });

beforeAll(async () => {
  ctx = await startTestApp();
  connectorJwt = await ctx.makeJwt({ sub: 'cas-connector', roles: ['integration-service'] });
  registryJwt = await ctx.makeJwt({ sub: 'cas-registry', roles: ['registry-administrator'] });
  selectorJwt = await ctx.makeJwt({ sub: 'cas-selector', roles: ['programme-approver'] });
  officerJwt = await ctx.makeJwt({ sub: 'cas-officer-1', roles: ['regulatory-officer'] });
  secondOfficerJwt = await ctx.makeJwt({ sub: 'cas-officer-2', roles: ['regulatory-officer'] });
  programmeId = (await call('POST', '/programmes', registryJwt, { code: 'CAS-MSC', title: 'MSc Sponsored Studies', fheqLevel: 7, creditTotal: 180 })).json<{ programmeId: string }>().programmeId;
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

/** An application with an accepted unconditional offer. */
async function offered(ref: string, first: string): Promise<{ applicationId: string; offerId: string; personId: string }> {
  const app = (await call('POST', '/applications', connectorJwt, {
    channelCode: 'international-direct', sourceReference: ref, cycle: '2027', programmeId, intakeCode: '2027-09', modeOfStudyCode: 'full-time',
    applicant: { legalFirstName: first, legalFamilyName: `Sponsored${ref}`, dateOfBirth: '2001-04-02' }, payload: {},
  })).json<{ id: string; personId: string }>();
  await call('POST', `/applications/${app.id}/assessments`, selectorJwt, { assessmentTypeCode: 'academic', outcomeCode: 'meets' });
  await call('POST', `/applications/${app.id}/recommendation`, registryJwt, { recommendationCode: 'offer', reason: 'Meets criteria' });
  const offer = (await call('POST', `/applications/${app.id}/decision`, selectorJwt, { decisionCode: 'offer', offer: { offerTypeCode: 'unconditional' } }))
    .json<{ offers: Array<{ id: string }> }>().offers[0]!;
  await call('POST', `/admissions-offers/${offer.id}/response`, connectorJwt, { responseCode: 'accept', sourceTimestamp: '2027-05-01T12:00:00Z' });
  return { applicationId: app.id, offerId: offer.id, personId: app.personId };
}

const check = (id: string, as: string, checkTypeCode: string, resultCode = 'pass') =>
  call('POST', `/regulatory/cas-cases/${id}/eligibility-checks`, as, { guidanceVersion: 'Student sponsor guidance 10/2026', checkTypeCode, resultCode });

describe('one CAS record (D-16)', () => {
  it('runs from the application to an assigned CAS, with a different approver, and carries it onto the enrolment', async () => {
    const { applicationId, offerId, personId } = await offered('CAS-001', 'Amara');
    const opened = await call('POST', `/applications/${applicationId}/cas-cases`, officerJwt);
    expect(opened.statusCode).toBe(201);
    const id = opened.json<CasCase>().casCaseId;
    expect(opened.json<CasCase>()).toMatchObject({ statusCode: 'opened', personId, applicationId, enrolmentId: null });
    expect((await call('POST', `/applications/${applicationId}/cas-cases`, officerJwt)).statusCode).toBe(409);

    expect((await call('POST', `/regulatory/cas-cases/${id}/preparation`, officerJwt)).statusCode).toBe(409); // no checks yet
    expect((await check(id, officerJwt, 'financial-requirement', 'fail')).statusCode).toBe(201);
    expect((await call('POST', `/regulatory/cas-cases/${id}/preparation`, officerJwt)).statusCode).toBe(409); // a check failed
    // A recheck that passes: the failed check stays on record, and the latest of each type counts.
    expect((await check(id, officerJwt, 'genuine-student')).statusCode).toBe(201);
    expect((await check(id, officerJwt, 'financial-requirement')).statusCode).toBe(201);
    // BL-198: the required set, not just what was recorded.
    const short = await call('POST', `/regulatory/cas-cases/${id}/preparation`, officerJwt);
    expect(short.statusCode).toBe(409);
    expect(short.json<{ detail: string }>().detail).toMatch(/Required eligibility checks not recorded: .*english-language/);
    await recordRequiredCasChecks(ctx, id, officerJwt);

    const prepared = await call('POST', `/regulatory/cas-cases/${id}/preparation`, officerJwt);
    expect(prepared.statusCode).toBe(200);
    expect(prepared.json<CasCase>()).toMatchObject({ statusCode: 'prepared', preparedPayload: { personId, programmeCode: 'CAS-MSC', intakeCode: '2027-09', dateOfBirth: '2001-04-02' } });

    expect((await call('POST', `/regulatory/cas-cases/${id}/approval`, officerJwt)).statusCode).toBe(409); // preparer cannot approve
    expect((await call('POST', `/regulatory/cas-cases/${id}/approval`, registryJwt)).statusCode).toBe(403);
    const approved = await call('POST', `/regulatory/cas-cases/${id}/approval`, secondOfficerJwt);
    expect(approved.json<CasCase>()).toMatchObject({ statusCode: 'approved', assignmentVersions: [{ versionNumber: 1, approvedBy: 'cas-officer-2', smsRequestSentAt: null }] });

    expect((await call('POST', `/regulatory/cas-cases/${id}/cas-number`, officerJwt, { casNumber: 'E4G1H2J3K4L5M6' })).statusCode).toBe(409); // not yet sent
    const file = (await call('POST', '/regulatory/cas-cases/sms-export', officerJwt)).json<{ contract: string; processedCount: number; casRequests: Array<{ casCaseId: string }> }>();
    expect(file).toMatchObject({ contract: 'ukvi/cas-request-outbound.v2', processedCount: 1, casRequests: [{ casCaseId: id }] });
    expect((await call('POST', '/regulatory/cas-cases/sms-export', officerJwt)).json<{ processedCount: number }>().processedCount).toBe(0);
    const exchanges = (await ctx.db.execute(sql`SELECT count(*)::int AS n FROM integration_exchange WHERE exchange_type_code = 'ukvi-cas-request' AND payload_summary->>'casCaseId' = ${id}`)) as unknown as Array<{ n: number }>;
    expect(exchanges[0]!.n).toBe(1);

    expect((await call('POST', `/regulatory/cas-cases/${id}/cas-number`, officerJwt, { casNumber: 'short' })).statusCode).toBe(422);
    const assigned = await call('POST', `/regulatory/cas-cases/${id}/cas-number`, officerJwt, { casNumber: 'E4G1H2J3K4L5M6', smsReceiptRef: 'SMS-RCPT-77' });
    expect(assigned.json<CasCase>()).toMatchObject({ statusCode: 'assigned', casReference: 'E4G1H2J3K4L5M6', assignmentVersions: [{ casNumber: 'E4G1H2J3K4L5M6', smsReceiptRef: 'SMS-RCPT-77' }] });

    // A visa granted before the student arrives is held on the CAS case.
    const visa = await call('POST', '/regulatory/ukvi/visa-updates', officerJwt, { casReference: 'E4G1H2J3K4L5M6', statusCode: 'granted', effectiveDate: '2027-08-01' });
    expect(visa.statusCode).toBe(201);

    // Conversion carries the CAS onto the enrolment.
    expect((await call('POST', `/admissions-offers/${offerId}/confirmation`, selectorJwt, { decisionCode: 'confirmed' })).statusCode).toBe(200);
    const conversion = await call('POST', `/applications/${applicationId}/enrolment-conversion`, registryJwt, {});
    expect(conversion.statusCode).toBe(200);
    const enrolmentId = conversion.json<{ enrolmentId: string }>().enrolmentId;
    expect((await call('GET', `/regulatory/cas-cases/${id}`, registryJwt)).json<CasCase>()).toMatchObject({ enrolmentId, statusCode: 'assigned' });
    expect((await call('GET', `/enrolments/${enrolmentId}/regulatory/cas-cases`, registryJwt)).json<CasCase[]>().map((c) => c.casCaseId)).toEqual([id]);
  });

  it('an open CAS case blocks conversion until the CAS is assigned or withdrawn', async () => {
    const { applicationId, offerId } = await offered('CAS-002', 'Bao');
    const id = (await call('POST', `/applications/${applicationId}/cas-cases`, officerJwt)).json<CasCase>().casCaseId;
    await call('POST', `/admissions-offers/${offerId}/confirmation`, selectorJwt, { decisionCode: 'confirmed' });
    const preview = (await call('GET', `/applications/${applicationId}/enrolment-conversion`, registryJwt)).json<{ blockers: Array<{ code: string }> }>();
    expect(preview.blockers.map((b) => b.code)).toEqual(['cas-not-assigned']);
    expect((await call('POST', `/applications/${applicationId}/enrolment-conversion`, registryJwt, {})).statusCode).toBe(409);
    expect((await call('POST', `/regulatory/cas-cases/${id}/withdrawal`, officerJwt)).json<CasCase>().statusCode).toBe('withdrawn');
    expect((await call('POST', `/applications/${applicationId}/enrolment-conversion`, registryJwt, {})).statusCode).toBe(200);
  });

  it('only the compliance team reads and works CAS cases', async () => {
    const dpoJwt = await ctx.makeJwt({ sub: 'cas-dpo', roles: ['dpo'] });
    expect((await call('GET', '/regulatory/cas-cases', dpoJwt)).statusCode).toBe(403);
    expect((await call('GET', '/regulatory/cas-cases?open=true', registryJwt)).statusCode).toBe(200);
    expect((await call('POST', '/regulatory/cas-cases/sms-export', registryJwt)).statusCode).toBe(403);
    expect((await check('00000000-0000-0000-0000-000000000000', officerJwt, 'genuine-student')).statusCode).toBe(404);
  });
});

describe('CAS preparation rules (BP-01 pre-review F8, BL-198)', () => {
  it('refuses a conditional offer until it is confirmed, and a made offer that is not accepted', async () => {
    const app = (await call('POST', '/applications', connectorJwt, {
      channelCode: 'international-direct', sourceReference: 'CAS-F8', cycle: '2027', programmeId, intakeCode: '2027-09', modeOfStudyCode: 'full-time',
      applicant: { legalFirstName: 'Conditional', legalFamilyName: 'Offer', dateOfBirth: '2001-04-02' }, payload: {},
    })).json<{ id: string }>();
    await call('POST', `/applications/${app.id}/assessments`, selectorJwt, { assessmentTypeCode: 'academic', outcomeCode: 'meets' });
    await call('POST', `/applications/${app.id}/recommendation`, registryJwt, { recommendationCode: 'offer', reason: 'Meets criteria' });
    const offer = (await call('POST', `/applications/${app.id}/decision`, selectorJwt, { decisionCode: 'offer', offer: { offerTypeCode: 'conditional', conditions: [{ conditionTypeCode: 'academic', description: 'Merit in the BSc', requiredValue: 'Merit' }] } }))
      .json<{ offers: Array<{ id: string }> }>().offers[0]!;
    const id = (await call('POST', `/applications/${app.id}/cas-cases`, officerJwt)).json<CasCase>().casCaseId;
    await recordRequiredCasChecks(ctx, id, officerJwt);

    const made = await call('POST', `/regulatory/cas-cases/${id}/preparation`, officerJwt);
    expect(made.statusCode).toBe(409);
    expect(made.json<{ detail: string }>().detail).toMatch(/accepted an unconditional offer/);
    await call('POST', `/admissions-offers/${offer.id}/response`, connectorJwt, { responseCode: 'accept', sourceTimestamp: '2027-05-01T12:00:00Z' });
    const accepted = await call('POST', `/regulatory/cas-cases/${id}/preparation`, officerJwt);
    expect(accepted.statusCode).toBe(409);
    expect(accepted.json<{ detail: string }>().detail).toMatch(/conditional offer is confirmed/);
  });

  it('an exempt check needs a reason, and counts towards the required set', async () => {
    const { applicationId } = await offered('CAS-EX1', 'Exempt');
    const id = (await call('POST', `/applications/${applicationId}/cas-cases`, officerJwt)).json<CasCase>().casCaseId;
    await recordRequiredCasChecks(ctx, id, officerJwt);
    expect((await check(id, officerJwt, 'english-language', 'exempt')).statusCode).toBe(422);
    const exempt = await call('POST', `/regulatory/cas-cases/${id}/eligibility-checks`, officerJwt, {
      guidanceVersion: 'Student sponsor guidance 10/2026', checkTypeCode: 'english-language', resultCode: 'exempt', exemptionReason: 'National of a majority English-speaking country',
    });
    expect(exempt.statusCode).toBe(201);
    expect((await call('POST', `/regulatory/cas-cases/${id}/preparation`, officerJwt)).statusCode).toBe(200);
  });
});

