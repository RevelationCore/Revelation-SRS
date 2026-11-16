/**
 * Applications and offers (BPR-D01, BPR-D02; BP-01-001 to BP-01-004).
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let connectorJwt: string;
let officerJwt: string;
let selectorJwt: string;
let programmeId: string;

interface Condition { id: string; statusCode: string; description: string }
interface Offer { id: string; version: number; statusCode: string; conditions: Condition[]; confirmation: { decisionCode: string; handoffWorkflowInstanceId: string | null; conditionSnapshot: unknown[] } | null }
interface Application { id: string; statusCode: string; identityMatchCode: string; personId: string | null; routingReasonCode: string | null; latestPayloadId: string; offers: Offer[] }

beforeAll(async () => {
  ctx = await startTestApp();
  connectorJwt = await ctx.makeJwt({ sub: 'ucas-connector', roles: ['integration-service'] });
  officerJwt = await ctx.makeJwt({ sub: 'admissions-officer-1', roles: ['registry-administrator'] });
  selectorJwt = await ctx.makeJwt({ sub: 'academic-selector-1', roles: ['programme-approver'] });
  const programme = await call('POST', '/programmes', officerJwt, { code: 'ADM-BSC', title: 'BSc Admissions Studies', fheqLevel: 6, creditTotal: 360 });
  programmeId = programme.json<{ programmeId: string }>().programmeId;
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

const call = (method: 'GET' | 'POST', url: string, as: string, payload?: Record<string, unknown>) =>
  ctx.app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${as}` }, ...(payload ? { payload } : {}) });

async function receive(ref: string, applicant: Record<string, unknown>, payload: Record<string, unknown> = { qualifications: ['A-level'] }) {
  return call('POST', '/applications', connectorJwt, {
    channelCode: 'ucas', sourceReference: ref, cycle: '2027', programmeId, intakeCode: '2027-09', modeOfStudyCode: 'full-time', applicant, payload,
  });
}

/** An application taken through assessment to an offer recommendation. */
async function recommended(ref: string, first: string): Promise<Application> {
  const app = (await receive(ref, { legalFirstName: first, legalFamilyName: `Applicant${ref}` })).json<Application>();
  await call('POST', `/applications/${app.id}/assessments`, selectorJwt, { assessmentTypeCode: 'academic', outcomeCode: 'meets', evidenceRef: 'ucas:quals', evidenceVersion: '1' });
  return (await call('POST', `/applications/${app.id}/recommendation`, officerJwt, { recommendationCode: 'offer', reason: 'Meets published criteria' })).json<Application>();
}

describe('receiving an application', () => {
  it('stores the payload as received, creates the applicant, and treats a resend as the same application', async () => {
    const first = await receive('UCAS-001', { legalFirstName: 'Ada', legalFamilyName: 'Newapplicant' });
    expect(first.statusCode).toBe(201);
    const app = first.json<Application>();
    expect(app).toMatchObject({ statusCode: 'received', identityMatchCode: 'created' });
    expect(app.personId).not.toBeNull();

    const resend = await receive('UCAS-001', { legalFirstName: 'Ada', legalFamilyName: 'Newapplicant' });
    expect(resend.statusCode).toBe(200);
    expect(resend.json<Application>()).toMatchObject({ id: app.id, latestPayloadId: app.latestPayloadId });

    const updated = (await receive('UCAS-001', { legalFirstName: 'Ada', legalFamilyName: 'Newapplicant' }, { qualifications: ['A-level', 'EPQ'] })).json<Application>();
    expect(updated.latestPayloadId).not.toBe(app.latestPayloadId);
    const payloads = (await ctx.db.execute(sql`SELECT count(*)::int AS n FROM application_received_payload WHERE source_reference = 'UCAS-001'`)) as unknown as Array<{ n: number }>;
    expect(payloads[0]!.n).toBe(2);
    await expect(ctx.db.execute(sql`UPDATE application_received_payload SET payload = '{}' WHERE source_reference = 'UCAS-001'`))
      .rejects.toMatchObject({ cause: { message: expect.stringMatching(/append-only/) as unknown } });
  });

  it('routes an uncertain identity match for review instead of merging it', async () => {
    const existing = await call('POST', '/students', officerJwt, { legalFirstName: 'Sam', legalFamilyName: 'Sameperson' });
    const personId = existing.json<{ personId: string }>().personId;
    const app = (await receive('UCAS-002', { legalFirstName: 'Sam', legalFamilyName: 'Sameperson' })).json<Application>();
    expect(app).toMatchObject({ identityMatchCode: 'needs-review', personId: null, routingReasonCode: 'identity' });
    expect((await call('POST', `/applications/${app.id}/assessments`, selectorJwt, { assessmentTypeCode: 'academic', outcomeCode: 'meets' })).statusCode).toBe(409);

    const resolved = (await call('POST', `/applications/${app.id}/identity`, officerJwt, { personId })).json<Application>();
    expect(resolved).toMatchObject({ identityMatchCode: 'matched', personId, routingReasonCode: null });
  });
});

describe('assessment, recommendation and decision', () => {
  it('a safeguarding concern blocks an offer recommendation', async () => {
    const app = (await receive('UCAS-003', { legalFirstName: 'Saf', legalFamilyName: 'Guarding' })).json<Application>();
    await call('POST', `/applications/${app.id}/assessments`, selectorJwt, { assessmentTypeCode: 'academic', outcomeCode: 'meets' });
    await call('POST', `/applications/${app.id}/assessments`, officerJwt, { assessmentTypeCode: 'safeguarding', outcomeCode: 'concern', evidenceRef: 'case:SG-1' });
    expect((await call('POST', `/applications/${app.id}/recommendation`, officerJwt, { recommendationCode: 'offer', reason: 'x' })).statusCode).toBe(409);
  });

  it('the recommender cannot decide; offer terms are validated', async () => {
    const app = await recommended('UCAS-004', 'Rec');
    expect((await call('POST', `/applications/${app.id}/decision`, officerJwt, { decisionCode: 'reject' })).statusCode).toBe(409);
    expect((await call('POST', `/applications/${app.id}/decision`, selectorJwt, {
      decisionCode: 'offer', offer: { offerTypeCode: 'unconditional', conditions: [{ conditionTypeCode: 'academic', description: 'AAB' }] },
    })).statusCode).toBe(422);
    expect((await call('POST', `/applications/${app.id}/decision`, selectorJwt, { decisionCode: 'offer', offer: { offerTypeCode: 'conditional' } })).statusCode).toBe(422);
  });
});

describe('offers, conditions and confirmation', () => {
  it('confirms only when every condition is met on verified evidence or waived, then hands the applicant to enrolment', async () => {
    const app = await recommended('UCAS-010', 'Con');
    const decided = (await call('POST', `/applications/${app.id}/decision`, selectorJwt, {
      decisionCode: 'offer',
      offer: { offerTypeCode: 'conditional', expiresOn: '2027-08-31', feeStatusBasisCode: 'home', conditions: [
        { conditionTypeCode: 'academic', description: 'AAB at A-level', requiredValue: 'AAB' },
        { conditionTypeCode: 'language', description: 'IELTS 6.5 overall', requiredValue: '6.5' },
      ] },
    })).json<Application>();
    expect(decided.statusCode).toBe('offered');
    const offer = decided.offers[0]!;
    expect(offer).toMatchObject({ version: 1, statusCode: 'made' });

    expect((await call('POST', `/admissions-offers/${offer.id}/response`, connectorJwt, { responseCode: 'accept', sourceTimestamp: '2027-05-01T12:00:00Z' })).statusCode).toBe(200);
    expect((await call('POST', `/admissions-offers/${offer.id}/confirmation`, selectorJwt, { decisionCode: 'confirmed' })).statusCode).toBe(409);

    const [academic, language] = offer.conditions.sort((a, b) => a.description.localeCompare(b.description));
    // Met needs verified evidence.
    expect((await call('POST', `/offer-conditions/${academic!.id}/decision`, selectorJwt, { statusCode: 'met' })).statusCode).toBe(409);
    await call('POST', `/offer-conditions/${academic!.id}/evidence`, connectorJwt, { provenanceCode: 'ucas-results', evidenceRef: 'ucas:results:2027', reportedValue: 'AAA', verified: true });
    expect((await call('POST', `/offer-conditions/${academic!.id}/decision`, selectorJwt, { statusCode: 'met' })).json<Condition>().statusCode).toBe('met');
    // A waiver needs its authority and reason.
    expect((await call('POST', `/offer-conditions/${language!.id}/decision`, selectorJwt, { statusCode: 'waived' })).statusCode).toBe(422);
    await call('POST', `/offer-conditions/${language!.id}/decision`, selectorJwt, { statusCode: 'waived', note: 'Prior UK degree; English requirement waived per policy 4.2' });

    const confirmed = await call('POST', `/admissions-offers/${offer.id}/confirmation`, selectorJwt, { decisionCode: 'confirmed' });
    expect(confirmed.statusCode).toBe(200);
    const decision = confirmed.json<{ decisionCode: string; handoffWorkflowInstanceId: string; conditionSnapshot: Array<{ statusCode: string }> }>();
    expect(decision.decisionCode).toBe('confirmed');
    expect(decision.handoffWorkflowInstanceId).toBeTruthy();
    expect(decision.conditionSnapshot.map((c) => c.statusCode).sort()).toEqual(['met', 'waived']);

    // Conditions are frozen after confirmation, and the decision is append-only.
    expect((await call('POST', `/offer-conditions/${academic!.id}/decision`, selectorJwt, { statusCode: 'unmet' })).statusCode).toBe(409);
    await expect(ctx.db.execute(sql`DELETE FROM offer_confirmation_decision WHERE offer_id = ${offer.id}`))
      .rejects.toMatchObject({ cause: { message: expect.stringMatching(/append-only/) as unknown } });
  });

  it('an authorised change creates a new offer version and keeps the acceptance', async () => {
    const app = await recommended('UCAS-011', 'Cha');
    const offer = (await call('POST', `/applications/${app.id}/decision`, selectorJwt, {
      decisionCode: 'offer', offer: { offerTypeCode: 'conditional', conditions: [{ conditionTypeCode: 'academic', description: 'ABB', requiredValue: 'ABB' }] },
    })).json<Application>().offers[0]!;
    await call('POST', `/admissions-offers/${offer.id}/response`, connectorJwt, { responseCode: 'accept', sourceTimestamp: '2027-05-01T12:00:00Z' });
    const changed = await call('POST', `/admissions-offers/${offer.id}/change`, selectorJwt, { reason: 'Moved to part-time on request', modeOfStudyCode: 'part-time' });
    expect(changed.json<{ version: number; statusCode: string; modeOfStudyCode: string }>()).toMatchObject({ version: 2, statusCode: 'accepted', modeOfStudyCode: 'part-time' });
    const all = (await call('GET', `/applications/${app.id}`, officerJwt)).json<Application>().offers;
    expect(all.map((o) => [o.version, o.statusCode, o.conditions.length])).toEqual([[1, 'superseded', 1], [2, 'accepted', 1]]);
  });

  it('a response after the offer expired is refused', async () => {
    const app = await recommended('UCAS-012', 'Exp');
    const offer = (await call('POST', `/applications/${app.id}/decision`, selectorJwt, {
      decisionCode: 'offer', offer: { offerTypeCode: 'unconditional', expiresOn: '2027-06-30' },
    })).json<Application>().offers[0]!;
    const late = await call('POST', `/admissions-offers/${offer.id}/response`, connectorJwt, { responseCode: 'accept', sourceTimestamp: '2027-07-02T09:00:00Z' });
    expect(late.statusCode).toBe(409);
    expect((await call('GET', `/applications/${app.id}`, officerJwt)).json<Application>().offers[0]!.statusCode).toBe('expired');
  });
});
