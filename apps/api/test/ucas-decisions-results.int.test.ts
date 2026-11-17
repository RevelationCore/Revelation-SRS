/**
 * UCAS outbound decisions and results mapped to conditions (Phase 3 D-14, D-15).
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let adapterJwt: string;
let registryJwt: string;
let selectorJwt: string;
let connectorJwt: string;
let adminJwt: string;
let programmeId: string;

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, as: string, payload?: Record<string, unknown>) =>
  ctx.app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${as}` }, ...(payload ? { payload } : {}) });

interface Item { exchangeId: string; applicationId: string; outcome: string; ucasCode: string | null; statusCode: string; attention: string | null }
interface Offer { id: string; conditions: Array<{ id: string; description: string; statusCode: string; evidence: Array<{ matchOutcomeCode: string | null; verified: boolean }> }> }

beforeAll(async () => {
  ctx = await startTestApp();
  adapterJwt = await ctx.makeJwt({ sub: 'ucas-adapter' });
  registryJwt = await ctx.makeJwt({ sub: 'ud-registry', roles: ['registry-administrator'] });
  selectorJwt = await ctx.makeJwt({ sub: 'ud-selector', roles: ['programme-approver'] });
  connectorJwt = await ctx.makeJwt({ sub: 'ud-connector', roles: ['integration-service'] });
  adminJwt = await ctx.makeJwt({ sub: 'ud-admin', roles: ['tenant-administrator'] });
  programmeId = (await call('POST', '/programmes', registryJwt, { code: 'UD-BSC', title: 'BSc Decisions', fheqLevel: 6, creditTotal: 360 })).json<{ programmeId: string }>().programmeId;
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

const ingest = (personalId: string, statusCode: string, first = 'Uma') => call('POST', '/regulatory/ucas/applications', adapterJwt, {
  cycle: '2027', statusCode, ucasPersonalId: personalId, programmeId, modeOfStudyCode: 'FT', startDate: '2027-09-20',
  applicant: { givenNames: first, familyName: `Ucas${personalId}`, dateOfBirth: '2008-01-02' },
});

/** A UCAS-channel application taken to a decision. */
async function recommended(personalId: string): Promise<string> {
  const appId = (await ingest(personalId, 'received')).json<{ studentApplicationId: string }>().studentApplicationId;
  await call('POST', `/applications/${appId}/assessments`, selectorJwt, { assessmentTypeCode: 'academic', outcomeCode: 'meets' });
  await call('POST', `/applications/${appId}/recommendation`, registryJwt, { recommendationCode: 'offer', reason: 'Meets criteria' });
  return appId;
}

const items = async () => (await call('GET', '/regulatory/ucas/decisions', registryJwt)).json<Item[]>();

describe('UCAS outbound decisions (D-15)', () => {
  it('queues decisions with the decision, supersedes an unsent one, sends by file, and reconciles on the next UCAS status', async () => {
    const appId = await recommended('7200000001');
    const decided = await call('POST', `/applications/${appId}/decision`, selectorJwt, {
      decisionCode: 'offer', offer: { offerTypeCode: 'conditional', conditions: [{ conditionTypeCode: 'academic', description: 'B in A level Mathematics', matchCriteria: { qualificationTypeCode: 'a-level', subject: 'Mathematics', minimumGrade: 'B', gradeScale: 'grade-scale-a-level' } }] },
    });
    expect(decided.statusCode, decided.body).toBe(200);
    const offerId = decided.json<{ offers: Offer[] }>().offers[0]!.id;
    expect((await items()).filter((i) => i.applicationId === appId)).toMatchObject([{ outcome: 'offer-conditional', ucasCode: 'C', statusCode: 'queued' }]);

    // A change before sending supersedes the queued decision.
    await call('POST', `/admissions-offers/${offerId}/change`, selectorJwt, { reason: 'Grade lowered', conditions: [{ conditionTypeCode: 'academic', description: 'C in A level Mathematics' }] });
    const mine = (await ctx.db.execute(sql`SELECT status_code FROM integration_exchange WHERE exchange_type_code = 'ucas-decision' AND payload_summary->>'applicationId' = ${appId} ORDER BY created_at`)) as unknown as Array<{ status_code: string }>;
    expect(mine.map((m) => m.status_code)).toEqual(['superseded', 'queued']);

    const file = (await call('POST', '/regulatory/ucas/decisions/dispatch', registryJwt)).json<{ transport: string; decisions: Array<{ outcome: string; ucasCode: string }> }>();
    expect(file.transport).toBe('manual-file');
    expect(file.decisions.find((d) => d.outcome === 'offer-conditional')).toMatchObject({ ucasCode: 'C' });
    expect((await items()).find((i) => i.applicationId === appId && i.statusCode !== 'superseded')).toMatchObject({ statusCode: 'sent', attention: null });

    // UCAS reports the offer: reconciled. A contradicting status would be a mismatch.
    expect((await ingest('7200000001', 'offer-made')).statusCode).toBe(201);
    expect((await items()).find((i) => i.applicationId === appId)).toMatchObject({ statusCode: 'reconciled' });
  });

  it('a non-UCAS application sends nothing; the simulator transport reconciles at once; a contradiction needs attention', async () => {
    const direct = (await call('POST', '/applications', connectorJwt, {
      channelCode: 'direct', sourceReference: 'UD-DIRECT-1', cycle: '2027', programmeId, intakeCode: '2027-09', modeOfStudyCode: 'full-time',
      applicant: { legalFirstName: 'Dee', legalFamilyName: 'Direct' }, payload: {},
    })).json<{ id: string }>();
    await call('POST', `/applications/${direct.id}/assessments`, selectorJwt, { assessmentTypeCode: 'academic', outcomeCode: 'meets' });
    await call('POST', `/applications/${direct.id}/recommendation`, registryJwt, { recommendationCode: 'reject', reason: 'x' });
    await call('POST', `/applications/${direct.id}/decision`, selectorJwt, { decisionCode: 'reject' });
    expect((await items()).some((i) => i.applicationId === direct.id)).toBe(false);

    await call('PATCH', '/tenant/configuration', adminJwt, { ucas: { outbound: { transport: 'simulator' } } });
    const simulated = await recommended('7200000002');
    await call('POST', `/applications/${simulated}/decision`, selectorJwt, { decisionCode: 'offer', offer: { offerTypeCode: 'unconditional' } });
    expect((await call('POST', '/regulatory/ucas/decisions/dispatch', registryJwt)).json<{ transport: string }>().transport).toBe('simulator');
    expect((await items()).find((i) => i.applicationId === simulated)).toMatchObject({ outcome: 'offer-unconditional', statusCode: 'reconciled' });
    await call('PATCH', '/tenant/configuration', adminJwt, { ucas: { outbound: { transport: 'manual-file' } } });

    const contradicted = await recommended('7200000003');
    await call('POST', `/applications/${contradicted}/decision`, selectorJwt, { decisionCode: 'offer', offer: { offerTypeCode: 'unconditional' } });
    await call('POST', '/regulatory/ucas/decisions/dispatch', registryJwt);
    await ingest('7200000003', 'withdrawn');
    const attention = (await call('GET', '/regulatory/ucas/decisions?attention=true', registryJwt)).json<Item[]>();
    expect(attention.find((i) => i.applicationId === contradicted)).toMatchObject({ statusCode: 'mismatch', attention: 'mismatch' });
  });
});

describe('UCAS results mapped to conditions (D-15)', () => {
  it('suggests meets or below on structured conditions, review on free text, and never decides; bulk confirms only all-meets', async () => {
    const appId = await recommended('7300000001');
    const offer = (await call('POST', `/applications/${appId}/decision`, selectorJwt, {
      decisionCode: 'offer', offer: { offerTypeCode: 'conditional', conditions: [
        { conditionTypeCode: 'academic', description: 'B in A level Chemistry', matchCriteria: { qualificationTypeCode: 'a-level', subject: 'Chemistry', minimumGrade: 'B', gradeScale: 'grade-scale-a-level' } },
        { conditionTypeCode: 'academic', description: 'A in A level Biology', matchCriteria: { qualificationTypeCode: 'a-level', subject: 'Biology', minimumGrade: 'A', gradeScale: 'grade-scale-a-level' } },
        { conditionTypeCode: 'academic', description: 'A strong overall profile' },
      ] },
    })).json<{ offers: Offer[] }>().offers[0]!;
    expect((await call('POST', `/applications/${appId}/decision`, selectorJwt, { decisionCode: 'offer', offer: { offerTypeCode: 'conditional', conditions: [{ conditionTypeCode: 'academic', description: 'x', matchCriteria: { qualificationTypeCode: 'a-level', minimumGrade: 'Z', gradeScale: 'grade-scale-a-level' } }] } })).statusCode).not.toBe(200);
    await call('POST', `/admissions-offers/${offer.id}/response`, connectorJwt, { responseCode: 'accept', sourceTimestamp: '2027-05-01T12:00:00Z' });

    const result = (r: Record<string, unknown>) => call('POST', '/regulatory/ucas/results', connectorJwt, { ucasPersonalId: '7300000001', cycle: '2027', awardingBody: 'AQA', qualificationTypeCode: 'a-level', series: '2027-06', ...r });
    const chem = (await result({ subject: 'Chemistry', grade: 'A' })).json<{ outcome: string; evidence: Array<{ description: string; matchOutcomeCode: string }> }>();
    expect(chem.outcome).toBe('matched');
    expect(Object.fromEntries(chem.evidence.map((e) => [e.description, e.matchOutcomeCode]))).toEqual({ 'B in A level Chemistry': 'meets', 'A strong overall profile': 'needs-review' });
    const bio = (await result({ subject: 'Biology', grade: 'B' })).json<{ evidence: Array<{ description: string; matchOutcomeCode: string }> }>();
    expect(bio.evidence.find((e) => e.description === 'A in A level Biology')?.matchOutcomeCode).toBe('below');
    expect((await result({ ucasPersonalId: '7399999999', subject: 'Chemistry', grade: 'A' })).json<{ outcome: string }>().outcome).toBe('no-application');

    // Nothing is decided by the matcher.
    const conditions = (await call('GET', `/applications/${appId}`, registryJwt)).json<{ offers: Offer[] }>().offers.find((o) => o.id === offer.id)!.conditions;
    expect(conditions.every((c) => c.statusCode === 'pending')).toBe(true);

    expect((await call('POST', `/admissions-offers/${offer.id}/conditions/suggested-met-confirmation`, connectorJwt)).statusCode).toBe(403);
    const bulk = (await call('POST', `/admissions-offers/${offer.id}/conditions/suggested-met-confirmation`, selectorJwt)).json<{ confirmed: string[] }>();
    const after = (await call('GET', `/applications/${appId}`, registryJwt)).json<{ offers: Offer[] }>().offers.find((o) => o.id === offer.id)!.conditions;
    expect(bulk.confirmed).toHaveLength(1);
    expect(Object.fromEntries(after.map((c) => [c.description, c.statusCode]))).toEqual({ 'B in A level Chemistry': 'met', 'A in A level Biology': 'pending', 'A strong overall profile': 'pending' });
  });

  it('an Awarding Body Linkage result before results day is embargoed and not bulk-confirmed', async () => {
    const appId = await recommended('7300000002');
    const offer = (await call('POST', `/applications/${appId}/decision`, selectorJwt, {
      decisionCode: 'offer', offer: { offerTypeCode: 'conditional', conditions: [{ conditionTypeCode: 'academic', description: 'C in A level Physics', matchCriteria: { qualificationTypeCode: 'a-level', subject: 'Physics', minimumGrade: 'C', gradeScale: 'grade-scale-a-level' } }] },
    })).json<{ offers: Offer[] }>().offers[0]!;
    const r = (await call('POST', '/regulatory/ucas/results', connectorJwt, { ucasPersonalId: '7300000002', cycle: '2027', awardingBody: 'OCR', qualificationTypeCode: 'a-level', subject: 'Physics', series: '2099-06', grade: 'A', publishedOn: '2099-08-14' })).json<{ embargoedUntil: string }>();
    expect(r.embargoedUntil).toBe('2099-08-14');
    expect((await call('POST', `/admissions-offers/${offer.id}/conditions/suggested-met-confirmation`, selectorJwt)).json<{ confirmed: string[] }>().confirmed).toEqual([]);
  });
});
