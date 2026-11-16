/**
 * The UCAS adapter feeds the channel-neutral application (BPR-D01; BP-01-001).
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let adapterJwt: string;
let officerJwt: string;
let selectorJwt: string;
let connectorJwt: string;
let programmeId: string;

interface Application {
  id: string; channelCode: string; sourceReference: string; statusCode: string; routingReasonCode: string | null;
  programmeId: string | null; intakeCode: string | null; modeOfStudyCode: string | null; ucasApplicationId: string | null;
  latestPayloadId: string; personId: string | null; offers: Array<{ id: string }>;
}

beforeAll(async () => {
  ctx = await startTestApp();
  adapterJwt = await ctx.makeJwt({ sub: 'ucas-adapter' });
  officerJwt = await ctx.makeJwt({ sub: 'feed-officer', roles: ['registry-administrator'] });
  selectorJwt = await ctx.makeJwt({ sub: 'feed-selector', roles: ['programme-approver'] });
  connectorJwt = await ctx.makeJwt({ sub: 'feed-connector', roles: ['integration-service'] });
  const programme = await call('POST', '/programmes', officerJwt, { code: 'UCAS-FEED', title: 'BSc Feed Studies', fheqLevel: 6, creditTotal: 360 });
  programmeId = programme.json<{ programmeId: string }>().programmeId;
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

const call = (method: 'GET' | 'POST', url: string, as: string, payload?: Record<string, unknown>) =>
  ctx.app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${as}` }, ...(payload ? { payload } : {}) });

async function ingest(payload: Record<string, unknown>) {
  const res = await call('POST', '/regulatory/ucas/applications', adapterJwt, { cycle: '2027', statusCode: 'received', ...payload });
  expect(res.statusCode).toBe(201);
  return res.json<{ applicationId: string; studentApplicationId: string | null }>();
}

const application = async (id: string) => (await call('GET', `/applications/${id}`, officerJwt)).json<Application>();

describe('UCAS adapter feed', () => {
  it('receives a UCAS record as a channel-neutral application, and a resend as the same application', async () => {
    const first = await ingest({
      ucasPersonalId: '7100000001', programmeId, modeOfStudyCode: 'FT', startDate: '2027-09-20',
      applicant: { givenNames: 'Feed', familyName: 'Complete', dateOfBirth: '2008-01-02' },
    });
    expect(first.studentApplicationId).not.toBeNull();
    const app = await application(first.studentApplicationId!);
    expect(app).toMatchObject({
      channelCode: 'ucas', sourceReference: '2027:7100000001', statusCode: 'received', routingReasonCode: null,
      programmeId, intakeCode: '2027-09', modeOfStudyCode: 'full-time', ucasApplicationId: first.applicationId,
    });
    expect(app.personId).not.toBeNull();

    const resend = await ingest({
      ucasPersonalId: '7100000001', statusCode: 'offer-made', programmeId, modeOfStudyCode: 'FT', startDate: '2027-09-20',
      applicant: { givenNames: 'Feed', familyName: 'Complete', dateOfBirth: '2008-01-02' },
    });
    expect(resend).toMatchObject({ applicationId: first.applicationId, studentApplicationId: first.studentApplicationId });
    expect((await application(first.studentApplicationId!)).latestPayloadId).not.toBe(app.latestPayloadId);
  });

  it('keeps a record without a recognised programme, intake or mode as incomplete until UCAS sends them', async () => {
    const applicant = { givenNames: 'Feed', familyName: 'Incomplete' };
    const first = await ingest({ ucasPersonalId: '7100000002', applicant, choices: [{ choiceNumber: 1, programmeCode: 'NO-SUCH-PROG' }] });
    const id = first.studentApplicationId!;
    expect(await application(id)).toMatchObject({ statusCode: 'incomplete', routingReasonCode: 'incomplete', programmeId: null, intakeCode: null });
    expect((await call('POST', `/applications/${id}/assessments`, selectorJwt, { assessmentTypeCode: 'academic', outcomeCode: 'meets' })).statusCode).toBe(409);
    expect((await call('POST', `/applications/${id}/routing`, officerJwt, { reasonCode: null })).statusCode).toBe(409);

    // The programme by its code on the confirmed choice, the mode and the start date arrive later.
    await ingest({
      ucasPersonalId: '7100000002', applicant, enrolment: { modeOfStudyCode: 'PT', startDate: '2028-01-15' },
      choices: [{ choiceNumber: 1, programmeCode: 'NO-SUCH-PROG' }, { choiceNumber: 2, programmeCode: 'UCAS-FEED', decisionCode: 'confirmed' }],
    });
    expect(await application(id)).toMatchObject({
      statusCode: 'received', routingReasonCode: null, programmeId, intakeCode: '2028-01', modeOfStudyCode: 'part-time',
    });
  });

  it('does not feed a record without the applicant names', async () => {
    const result = await ingest({ ucasPersonalId: '7100000003', programmeId });
    expect(result.studentApplicationId).toBeNull();
  });

  it('a provider confirmation and a later UCAS "confirmed" status start only one hand-off', async () => {
    const applicant = { givenNames: 'Feed', familyName: 'Confirmed' };
    const base = { ucasPersonalId: '7100000004', applicant, programmeId, modeOfStudyCode: 'full-time', startDate: '2027-09-20' };
    const { applicationId, studentApplicationId } = await ingest(base);
    const id = studentApplicationId!;

    await call('POST', `/applications/${id}/assessments`, selectorJwt, { assessmentTypeCode: 'academic', outcomeCode: 'meets' });
    await call('POST', `/applications/${id}/recommendation`, officerJwt, { recommendationCode: 'offer', reason: 'Meets criteria' });
    const offerId = (await call('POST', `/applications/${id}/decision`, selectorJwt, { decisionCode: 'offer', offer: { offerTypeCode: 'unconditional' } }))
      .json<Application>().offers[0]!.id;
    await call('POST', `/admissions-offers/${offerId}/response`, connectorJwt, { responseCode: 'accept', sourceTimestamp: '2027-05-01T12:00:00Z' });
    const confirmed = await call('POST', `/admissions-offers/${offerId}/confirmation`, selectorJwt, { decisionCode: 'confirmed' });
    expect(confirmed.statusCode).toBe(200);
    const handoffId = confirmed.json<{ handoffWorkflowInstanceId: string }>().handoffWorkflowInstanceId;

    await ingest({ ...base, statusCode: 'confirmed' });
    const handoffs = (await ctx.db.execute(sql`
      SELECT id FROM workflow_instance
      WHERE tenant_id = ${ctx.tenantId} AND workflow_code = 'admissions-ucas-domestic' AND subject_entity_id = ${applicationId}
    `)) as unknown as Array<{ id: string }>;
    expect(handoffs.map((h) => h.id)).toEqual([handoffId]);
  });
});
