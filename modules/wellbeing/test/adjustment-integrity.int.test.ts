/**
 * Reasonable-adjustment case integrity, from the D-44 AI pre-review:
 * - BL-235: approval is decided by the most recently recorded determination,
 *   so a panel that rejects a case after a recommending assessment stops it;
 * - BL-236: the assessor and the panel chair are the signed-in user, and a
 *   request naming its own is refused.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SrsAdjustmentStubClient } from '../src/srs/srs-adjustment-client.js';

import { startTestApp, type TestWellbeingApp } from './helpers/test-db.js';

const PERSON_ID    = '10000000-0000-0000-0000-000000000081';
const ENROLMENT_ID = '22000000-0000-0000-0000-000000000081';
const ADVISOR      = 'adj-advisor-081';
const CHAIR        = 'adj-chair-081';

let ctx: TestWellbeingApp;
let stub: SrsAdjustmentStubClient;
let advisor: string;
let chair: string;
let wellbeingCaseId: string;
let disabilityCaseId: string;

async function call(app: FastifyInstance, token: string, method: 'GET' | 'POST', url: string, payload?: object) {
  return app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
}

async function caseUnderAssessment(): Promise<string> {
  const created = await call(ctx.app, advisor, 'POST', '/api/v1/adjustment-cases', {
    wellbeingCaseId, disabilitySupportCaseId: disabilityCaseId, personId: PERSON_ID,
    adjustmentTypeCode: 'exam-time', rationale: 'Referral',
  });
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json<{ id: string }>().id;
  expect((await call(ctx.app, advisor, 'POST', `/api/v1/adjustment-cases/${id}/start-assessment`)).statusCode).toBe(204);
  return id;
}

// forceApprove: the module-registration projection check is not what these tests are about.
const approve = (id: string) => call(ctx.app, chair, 'POST', `/api/v1/adjustment-cases/${id}/approve`, {
  forceApprove: true,
  enrolmentId: ENROLMENT_ID, adjustmentTypeCode: 'extra-time', scopeCode: 'all',
  recommendedAdjustment: '25% extra time', validFrom: '2026-09-01T00:00:00Z',
  amount: { value: 25, unitCode: 'percent-of-duration' },
});

beforeAll(async () => {
  stub = new SrsAdjustmentStubClient();
  ctx = await startTestApp({ srsAdjustmentClient: stub });
  advisor = ctx.makeJwt({ sub: ADVISOR });
  chair = ctx.makeJwt({ sub: CHAIR, roles: ['wellbeing-panel-chair'] });
  const dc = await call(ctx.app, advisor, 'POST', '/api/v1/disability-cases', { personId: PERSON_ID, supportTypeCode: 'dsa', dsaAwardRef: 'DSA-INTEGRITY' });
  expect(dc.statusCode, dc.body).toBe(201);
  ({ id: disabilityCaseId, wellbeingCaseId } = dc.json<{ id: string; wellbeingCaseId: string }>());
}, 120_000);

afterAll(() => ctx.teardown());

describe('approval follows the latest determination (BL-235)', () => {
  it('refuses approval when a panel rejects the case after a recommending assessment', async () => {
    const id = await caseUnderAssessment();
    expect((await call(ctx.app, advisor, 'POST', `/api/v1/adjustment-cases/${id}/assessments`, {
      assessedAt: '2026-06-15T10:00:00Z', outcomeCode: 'recommended',
    })).statusCode).toBe(201);
    expect((await call(ctx.app, chair, 'POST', `/api/v1/adjustment-cases/${id}/panel-decisions`, {
      panelDate: '2026-06-01T10:00:00Z', decisionCode: 'rejected', decisionRationale: 'Not supported by the evidence',
    })).statusCode).toBe(201);

    // The panel date is earlier than the assessment date, but the panel
    // decision was recorded later, and recording order governs.
    const res = await approve(id);
    expect(res.statusCode).toBe(409);
    expect(stub.submissions).toHaveLength(0);
  });

  it('still approves on a recommending assessment, or on an upheld panel decision', async () => {
    const recommended = await caseUnderAssessment();
    expect((await call(ctx.app, advisor, 'POST', `/api/v1/adjustment-cases/${recommended}/assessments`, {
      assessedAt: '2026-06-15T10:00:00Z', outcomeCode: 'recommended',
    })).statusCode).toBe(201);
    const okRecommended = await approve(recommended);
    expect(okRecommended.statusCode, okRecommended.body).toBe(202);

    const upheld = await caseUnderAssessment();
    expect((await call(ctx.app, advisor, 'POST', `/api/v1/adjustment-cases/${upheld}/assessments`, {
      assessedAt: '2026-06-15T10:00:00Z', outcomeCode: 'not-recommended',
    })).statusCode).toBe(201);
    expect((await call(ctx.app, chair, 'POST', `/api/v1/adjustment-cases/${upheld}/panel-decisions`, {
      panelDate: '2026-06-20T10:00:00Z', decisionCode: 'upheld',
    })).statusCode).toBe(201);
    const okUpheld = await approve(upheld);
    expect(okUpheld.statusCode, okUpheld.body).toBe(202);
  });
});

describe('the assessor and panel chair come from the token (BL-236)', () => {
  it('records the signed-in assessor and chair, and refuses named ones', async () => {
    const id = await caseUnderAssessment();
    const namedAssessor = await call(ctx.app, advisor, 'POST', `/api/v1/adjustment-cases/${id}/assessments`, {
      assessorId: 'someone-else', assessedAt: '2026-06-15T10:00:00Z', outcomeCode: 'not-recommended',
    });
    expect(namedAssessor.statusCode).toBe(400);
    expect(namedAssessor.json<{ detail: string }>().detail).toMatch(/assessorId is not accepted/);
    const namedChair = await call(ctx.app, chair, 'POST', `/api/v1/adjustment-cases/${id}/panel-decisions`, {
      panelChairId: 'someone-else', panelDate: '2026-06-20T10:00:00Z', decisionCode: 'upheld',
    });
    expect(namedChair.statusCode).toBe(400);

    expect((await call(ctx.app, advisor, 'POST', `/api/v1/adjustment-cases/${id}/assessments`, {
      assessedAt: '2026-06-15T10:00:00Z', outcomeCode: 'not-recommended',
    })).statusCode).toBe(201);
    expect((await call(ctx.app, chair, 'POST', `/api/v1/adjustment-cases/${id}/panel-decisions`, {
      panelDate: '2026-06-20T10:00:00Z', decisionCode: 'upheld',
    })).statusCode).toBe(201);

    const detail = (await call(ctx.app, advisor, 'GET', `/api/v1/adjustment-cases/${id}`)).json<{
      assessments: Array<{ assessorId: string }>; panelDecision: { panelChairId: string } | null;
    }>();
    expect(detail.assessments.map((a) => a.assessorId)).toEqual([ADVISOR]);
    expect(detail.panelDecision?.panelChairId).toBe(CHAIR);
  });
});
