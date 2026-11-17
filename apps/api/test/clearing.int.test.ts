/**
 * Clearing (BP-01-006; D-13).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let connectorJwt: string;
let registryJwt: string;
let approverJwt: string;
let secondApproverJwt: string;
let adminJwt: string;
let openProgrammeId: string;
let closedProgrammeId: string;

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, as: string, payload?: Record<string, unknown>) =>
  ctx.app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${as}` }, ...(payload ? { payload } : {}) });

const NO_CONCERNS = { safeguardingConcern: false, convictionDeclared: false, fitnessToPractiseRequired: false, studentVisaRequired: false };

beforeAll(async () => {
  ctx = await startTestApp();
  connectorJwt = await ctx.makeJwt({ sub: 'ucas-connector', roles: ['integration-service'] });
  registryJwt = await ctx.makeJwt({ sub: 'clr-registry', roles: ['registry-administrator'] });
  approverJwt = await ctx.makeJwt({ sub: 'clr-approver', roles: ['programme-approver'] });
  secondApproverJwt = await ctx.makeJwt({ sub: 'clr-approver-2', roles: ['programme-approver'] });
  adminJwt = await ctx.makeJwt({ sub: 'clr-admin', roles: ['tenant-administrator'] });
  openProgrammeId = (await call('POST', '/programmes', registryJwt, { code: 'CLR-OPEN', title: 'BSc Open in Clearing', fheqLevel: 6, creditTotal: 360 })).json<{ programmeId: string }>().programmeId;
  closedProgrammeId = (await call('POST', '/programmes', registryJwt, { code: 'CLR-FULL', title: 'BSc Full', fheqLevel: 6, creditTotal: 360 })).json<{ programmeId: string }>().programmeId;
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

const callBody = (over: Record<string, unknown> = {}) => ({
  callReference: 'CALL-0001', reason: 'Meets published Clearing criteria (BBC)', cycle: '2027', ucasPersonalId: '1234567890',
  applicant: { legalFirstName: 'Cleo', legalFamilyName: 'Clearing' },
  programmeId: openProgrammeId, intakeCode: '2027-09', modeOfStudyCode: 'full-time',
  declarations: NO_CONCERNS, offer: { offerTypeCode: 'clearing-verbal' }, ...over,
});

describe('Clearing', () => {
  it('decides in one step only inside the window, for an open programme, with no concerns', async () => {
    expect((await call('POST', '/clearing/calls', registryJwt, callBody())).statusCode).toBe(409); // window not configured
    const now = Date.now();
    await call('PATCH', '/tenant/configuration', adminJwt, {
      clearing: { opensAt: new Date(now - 3_600_000).toISOString(), closesAt: new Date(now + 30 * 86_400_000).toISOString(), programmeIds: [openProgrammeId] },
    });
    expect((await call('GET', '/clearing/status', registryJwt)).json()).toMatchObject({ open: true, verbalOfferHours: 48, programmeIds: [openProgrammeId] });
    expect((await call('POST', '/clearing/calls', registryJwt, callBody({ programmeId: closedProgrammeId }))).statusCode).toBe(409);
    const visa = await call('POST', '/clearing/calls', registryJwt, callBody({ declarations: { ...NO_CONCERNS, studentVisaRequired: true } }));
    expect(visa.statusCode).toBe(409);
    expect(visa.json<{ detail: string }>().detail).toMatch(/Student visa/);
    expect((await call('POST', '/clearing/calls', await ctx.makeJwt({ sub: 'clr-tutor', roles: ['personal-tutor'] }), callBody())).statusCode).toBe(403);
  });

  it('records a verbal offer that expires after the hold period, reconciles the UCAS Clearing choice, and is reviewed next day by someone else', async () => {
    const taken = await call('POST', '/clearing/calls', registryJwt, callBody());
    expect(taken.statusCode).toBe(201);
    const { application, reviewCaseId } = taken.json<{ application: { id: string; channelCode: string; statusCode: string; offers: Array<{ offerTypeCode: string; expiresOn: string; decidedBy: string }> }; reviewCaseId: string }>();
    expect(application).toMatchObject({ channelCode: 'clearing', statusCode: 'offered' });
    expect(application.offers[0]).toMatchObject({ offerTypeCode: 'clearing-verbal', decidedBy: 'clr-registry', expiresOn: new Date(Date.now() + 48 * 3_600_000).toISOString().slice(0, 10) });

    // The UCAS feed sends the same applicant's Clearing choice: it updates the same application.
    const ucas = await call('POST', '/applications', connectorJwt, {
      channelCode: 'ucas', sourceReference: '2027:1234567890', cycle: '2027', programmeId: openProgrammeId, intakeCode: '2027-09', modeOfStudyCode: 'full-time',
      applicant: { legalFirstName: 'Cleo', legalFamilyName: 'Clearing' }, payload: { clearing: true },
    });
    expect(ucas.statusCode).toBe(200);
    expect(ucas.json<{ id: string }>().id).toBe(application.id);

    const [pending] = (await call('GET', '/clearing/reviews?pending=true', approverJwt)).json<Array<{ caseId: string; applicationId: string; reviewDueBy: string }>>();
    expect(pending).toMatchObject({ caseId: reviewCaseId, applicationId: application.id });
    expect(new Date(pending!.reviewDueBy).getTime()).toBeGreaterThan(Date.now());

    expect((await call('POST', `/clearing/reviews/${reviewCaseId}`, registryJwt, { outcomeCode: 'upheld' })).statusCode).toBe(403);
    expect((await call('POST', `/clearing/reviews/${reviewCaseId}`, approverJwt, { outcomeCode: 'correction-needed' })).statusCode).toBe(422);
    const reviewed = await call('POST', `/clearing/reviews/${reviewCaseId}`, approverJwt, { outcomeCode: 'upheld', note: 'Criteria met' });
    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json()).toMatchObject({ statusCode: 'decided', review: { outcomeCode: 'upheld', reviewedBy: 'clr-approver' } });
    expect((await call('POST', `/clearing/reviews/${reviewCaseId}`, secondApproverJwt, { outcomeCode: 'upheld' })).statusCode).toBe(409);
    expect((await call('GET', '/clearing/reviews?pending=true', approverJwt)).json<unknown[]>()).toEqual([]);
  });

  it('the decider cannot review their own Clearing decision', async () => {
    const taken = (await call('POST', '/clearing/calls', approverJwt, callBody({ callReference: 'CALL-0002', ucasPersonalId: '2234567890', applicant: { legalFirstName: 'Dee', legalFamilyName: 'Decider' } })))
      .json<{ reviewCaseId: string }>();
    expect((await call('POST', `/clearing/reviews/${taken.reviewCaseId}`, approverJwt, { outcomeCode: 'upheld' })).statusCode).toBe(409);
    expect((await call('POST', `/clearing/reviews/${taken.reviewCaseId}`, secondApproverJwt, { outcomeCode: 'upheld' })).statusCode).toBe(200);
  });
});
