import { sql } from 'drizzle-orm';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { SrsAdjustmentStubClient } from '../src/srs/srs-adjustment-client.js';
import { withWellbeingTenantContext } from '../src/db/client.js';
import { upsertProjection } from '../src/repositories/projection-repository.js';
import { startTestApp, type TestWellbeingApp } from './helpers/test-db.js';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const PERSON_ID   = '22222222-0000-0000-0000-000000000001';
const ENROLMENT_ID = '22222222-0000-0000-0000-000000000010';

let ctx:      TestWellbeingApp;
let srsStub:  SrsAdjustmentStubClient;
let panelJwt: string; // wellbeing-panel-chair — required for panel-decisions, approve, reject

// IDs threaded through suites
let wellbeingCaseId:         string;
let disabilityCaseId:        string;
let adjustmentCaseId:        string;
let secondAdjustmentCaseId:  string;

beforeAll(async () => {
  srsStub  = new SrsAdjustmentStubClient();
  ctx      = await startTestApp({ srsAdjustmentClient: srsStub });
  panelJwt = ctx.makeJwt({ roles: ['wellbeing-panel-chair'] });

  // Seed the SRS context projection so module-registration validation passes
  await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) => {
    await upsertProjection(tx, ctx.tenantId, PERSON_ID, {
      activeEnrolmentIds: [ENROLMENT_ID],
      activeModuleCodes:  ['CS101', 'MA201'],
      enrolmentStatus:    'active',
    });
  });

  // Create a disability case to parent the adjustment case
  const dcRes = await ctx.app.inject({
    method:  'POST',
    url:     '/api/v1/disability-cases',
    headers: { authorization: `Bearer ${ctx.makeJwt()}` },
    payload: { personId: PERSON_ID, supportTypeCode: 'dsa', dsaAwardRef: 'DSA-2026-ADJ' },
  });
  expect(dcRes.statusCode).toBe(201);
  const dc = dcRes.json<{ id: string; wellbeingCaseId: string }>();
  wellbeingCaseId  = dc.wellbeingCaseId;
  disabilityCaseId = dc.id;
}, 120_000);

afterAll(async () => {
  await ctx.teardown();
});

// ── Case creation ─────────────────────────────────────────────────────────────

describe('Stage 4 — POST /api/v1/adjustment-cases', () => {
  it('creates an adjustment case with status referral_received', async () => {
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/adjustment-cases',
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
      payload: {
        wellbeingCaseId,
        disabilitySupportCaseId: disabilityCaseId,
        personId:                PERSON_ID,
        adjustmentTypeCode:      'exam-time',
        rationale:               'Initial referral from disability advisor',
      },
    });

    expect(res.statusCode).toBe(201);
    adjustmentCaseId = res.json<{ id: string }>().id;
    expect(adjustmentCaseId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns 401 without a JWT', async () => {
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/adjustment-cases',
      payload: { wellbeingCaseId, disabilitySupportCaseId: disabilityCaseId, personId: PERSON_ID, adjustmentTypeCode: 'venue' },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ── Case list ─────────────────────────────────────────────────────────────────

describe('Stage 4 — GET /api/v1/adjustment-cases?personId=', () => {
  it('returns adjustment cases for the person', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/adjustment-cases?personId=${PERSON_ID}`,
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: Array<{ id: string; statusCode: string }> }>();
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    const c = body.items.find((i) => i.id === adjustmentCaseId);
    expect(c?.statusCode).toBe('referral_received');
  });

  it('returns 400 when personId is missing', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/adjustment-cases',
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── Case detail ───────────────────────────────────────────────────────────────

describe('Stage 4 — GET /api/v1/adjustment-cases/:caseId', () => {
  it('returns case detail with assessments, panelDecision, and srsHandoffStatus', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/adjustment-cases/${adjustmentCaseId}`,
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      id: string;
      statusCode: string;
      adjustmentTypeCode: string;
      assessments: unknown[];
      panelDecision: unknown;
      srsHandoffStatus: unknown;
    }>();
    expect(body.id).toBe(adjustmentCaseId);
    expect(body.statusCode).toBe('referral_received');
    expect(body.adjustmentTypeCode).toBe('exam-time');
    expect(Array.isArray(body.assessments)).toBe(true);
    expect(body.srsHandoffStatus).toBeNull();
  });

  it('returns 404 for unknown case', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/adjustment-cases/00000000-dead-dead-dead-000000000000',
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ── Status transitions ────────────────────────────────────────────────────────

describe('Stage 4 — PATCH /api/v1/adjustment-cases/:caseId/status (state machine)', () => {
  it('transitions to under_assessment', async () => {
    const res = await ctx.app.inject({
      method:  'PATCH',
      url:     `/api/v1/adjustment-cases/${adjustmentCaseId}/status`,
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
      payload: { statusCode: 'under_assessment' },
    });
    expect(res.statusCode).toBe(204);
  });

  it('new status is visible via GET', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/adjustment-cases/${adjustmentCaseId}`,
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
    });
    expect(res.json<{ statusCode: string }>().statusCode).toBe('under_assessment');
  });

  it('bitemporal: all versions are preserved in the database', async () => {
    const rows = await ctx.db.execute(sql`
      SELECT count(*) AS cnt
      FROM   wellbeing.adjustment_case
      WHERE  id = ${adjustmentCaseId}::uuid
    `);
    expect(Number(rows[0]?.['cnt'])).toBe(2); // referral_received + under_assessment
  });

  it('transitions to determination_made with recommended adjustment', async () => {
    const res = await ctx.app.inject({
      method:  'PATCH',
      url:     `/api/v1/adjustment-cases/${adjustmentCaseId}/status`,
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
      payload: {
        statusCode:            'determination_made',
        recommendedAdjustment: '25% extra time in all examinations',
      },
    });
    expect(res.statusCode).toBe(204);
  });

  it('recommended adjustment is carried into the new version', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/adjustment-cases/${adjustmentCaseId}`,
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
    });
    expect(res.json<{ recommendedAdjustment: string }>().recommendedAdjustment)
      .toBe('25% extra time in all examinations');
  });
});

// ── Assessment recording ──────────────────────────────────────────────────────

describe('Stage 4 — POST /api/v1/adjustment-cases/:caseId/assessments', () => {
  let assessmentId: string;

  it('records an assessment and returns 201', async () => {
    const res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/adjustment-cases/${adjustmentCaseId}/assessments`,
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
      payload: {
        assessorId:        'disability-advisor-001',
        assessedAt:        '2026-06-15T10:00:00Z',
        outcomeCode:       'recommended',
        findings:          'Student meets DSA criteria for additional time.',
        recommendedAction: 'Approve 25% extra time',
      },
    });

    expect(res.statusCode).toBe(201);
    assessmentId = res.json<{ id: string }>().id;
    expect(assessmentId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('assessment appears in case detail', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/adjustment-cases/${adjustmentCaseId}`,
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
    });
    const assessments = res.json<{ assessments: Array<{ id: string; outcomeCode: string }> }>().assessments;
    const a = assessments.find((x) => x.id === assessmentId);
    expect(a?.outcomeCode).toBe('recommended');
  });

  it('returns 404 for unknown case', async () => {
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/adjustment-cases/00000000-dead-dead-dead-000000000000/assessments',
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
      payload: { assessorId: 'x', assessedAt: '2026-06-15T10:00:00Z', outcomeCode: 'recommended' },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ── Panel decisions ───────────────────────────────────────────────────────────

describe('Stage 4 — POST /api/v1/adjustment-cases/:caseId/panel-decisions', () => {
  let panelDecisionId: string;

  beforeAll(async () => {
    // Create a fresh adjustment case for panel testing
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/adjustment-cases',
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
      payload: {
        wellbeingCaseId,
        disabilitySupportCaseId: disabilityCaseId,
        personId:                PERSON_ID,
        adjustmentTypeCode:      'venue',
      },
    });
    secondAdjustmentCaseId = res.json<{ id: string }>().id;
  });

  it('records a panel decision and returns 201', async () => {
    const res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/adjustment-cases/${secondAdjustmentCaseId}/panel-decisions`,
      headers: { authorization: `Bearer ${panelJwt}` },
      payload: {
        panelChairId:      'panel-chair-001',
        panelDate:         '2026-06-20T14:00:00Z',
        decisionCode:      'upheld',
        decisionRationale: 'Panel agrees DSA entitlement supports this adjustment.',
      },
    });

    expect(res.statusCode).toBe(201);
    panelDecisionId = res.json<{ id: string }>().id;
    expect(panelDecisionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('case is transitioned to under_review after panel decision', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/adjustment-cases/${secondAdjustmentCaseId}`,
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
    });
    expect(res.json<{ statusCode: string }>().statusCode).toBe('under_review');
  });

  it('panel decision appears in case detail', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/adjustment-cases/${secondAdjustmentCaseId}`,
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
    });
    const pd = res.json<{ panelDecision: { id: string; decisionCode: string } | null }>().panelDecision;
    expect(pd?.decisionCode).toBe('upheld');
  });
});

// ── Approve + SRS handoff ─────────────────────────────────────────────────────

describe('Stage 4 — POST /api/v1/adjustment-cases/:caseId/approve (SRS handoff)', () => {
  let stubSubmissionsBefore: number;

  beforeAll(() => {
    stubSubmissionsBefore = srsStub.submissions.length;
  });

  it('approves the case and submits to SRS, returning 202 with adjustmentId', async () => {
    const res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/adjustment-cases/${adjustmentCaseId}/approve`,
      headers: { authorization: `Bearer ${panelJwt}` },
      payload: {
        enrolmentId:           ENROLMENT_ID,
        scopeCode:             'all-modules',
        recommendedAdjustment: '25% extra time in all examinations',
        validFrom:             '2026-09-01T00:00:00Z',
      },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json<{ status: string; adjustmentId: string }>();
    expect(body.status).toBe('submitted');
    expect(body.adjustmentId).toBeTruthy();
  });

  it('SRS stub received exactly one submission', () => {
    expect(srsStub.submissions.length).toBe(stubSubmissionsBefore + 1);
    const sub = srsStub.submissions.at(-1)!;
    expect(sub.adjustmentTypeCode).toBe('exam-time');
    expect(sub.scopeCode).toBe('all-modules');
    expect(sub.enrolmentId).toBe(ENROLMENT_ID);
    expect(sub.idempotencyKey).toBe(`adj-handoff-${adjustmentCaseId}`);
  });

  it('outbox record is marked sent', async () => {
    const rows = await ctx.db.execute(sql`
      SELECT status_code, srs_response
      FROM   wellbeing.srs_handoff_outbox
      WHERE  adjustment_case_id = ${adjustmentCaseId}::uuid
    `);
    expect(rows.length).toBe(1);
    expect(rows[0]?.['status_code']).toBe('sent');
    expect(rows[0]?.['srs_response']).toBeTruthy();
  });

  it('case statusCode is approved and srsApplicationRef is set', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/adjustment-cases/${adjustmentCaseId}`,
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
    });
    const body = res.json<{ statusCode: string; srsApplicationRef: string | null }>();
    expect(body.statusCode).toBe('approved');
    expect(body.srsApplicationRef).toBeTruthy();
  });
});

// ── Exactly-once idempotency ──────────────────────────────────────────────────

describe('Stage 4 — approve idempotency: calling approve twice does not double-send', () => {
  let submissionsAfterFirst: number;

  beforeAll(() => {
    submissionsAfterFirst = srsStub.submissions.length;
  });

  it('calling approve again returns 200 already_sent', async () => {
    const res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/adjustment-cases/${adjustmentCaseId}/approve`,
      headers: { authorization: `Bearer ${panelJwt}` },
      payload: {
        enrolmentId:           ENROLMENT_ID,
        scopeCode:             'all-modules',
        recommendedAdjustment: '25% extra time in all examinations',
        validFrom:             '2026-09-01T00:00:00Z',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe('already_sent');
  });

  it('SRS stub received no additional submissions', () => {
    expect(srsStub.submissions.length).toBe(submissionsAfterFirst);
  });

  it('outbox still contains exactly one record for the case', async () => {
    const rows = await ctx.db.execute(sql`
      SELECT count(*) AS cnt
      FROM   wellbeing.srs_handoff_outbox
      WHERE  adjustment_case_id = ${adjustmentCaseId}::uuid
    `);
    expect(Number(rows[0]?.['cnt'])).toBe(1);
  });
});

// ── Module registration validation ───────────────────────────────────────────

describe('Stage 4 — approve validates active module registrations', () => {
  let emptyProjCaseId: string;

  beforeAll(async () => {
    // Create an adjustment case for a person with NO projection
    const personWithNoModules = '22222222-0000-0000-0000-999999999999';

    const dcRes = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/disability-cases',
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
      payload: { personId: personWithNoModules, supportTypeCode: 'dsa' },
    });
    const { id: dsc, wellbeingCaseId: wc } = dcRes.json<{ id: string; wellbeingCaseId: string }>();

    const acRes = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/adjustment-cases',
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
      payload: {
        wellbeingCaseId:         wc,
        disabilitySupportCaseId: dsc,
        personId:                personWithNoModules,
        adjustmentTypeCode:      'exam-time',
      },
    });
    emptyProjCaseId = acRes.json<{ id: string }>().id;
  });

  it('returns 422 when person has no active module registrations', async () => {
    const res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/adjustment-cases/${emptyProjCaseId}/approve`,
      headers: { authorization: `Bearer ${panelJwt}` },
      payload: {
        enrolmentId:           ENROLMENT_ID,
        scopeCode:             'all-modules',
        recommendedAdjustment: '25% extra time',
        validFrom:             '2026-09-01T00:00:00Z',
      },
    });
    expect(res.statusCode).toBe(422);
  });

  it('forceApprove:true bypasses the module validation', async () => {
    const res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/adjustment-cases/${emptyProjCaseId}/approve`,
      headers: { authorization: `Bearer ${panelJwt}` },
      payload: {
        enrolmentId:           ENROLMENT_ID,
        scopeCode:             'all-modules',
        recommendedAdjustment: '25% extra time',
        validFrom:             '2026-09-01T00:00:00Z',
        forceApprove:          true,
      },
    });
    expect(res.statusCode).toBe(202);
  });
});

// ── Reject ────────────────────────────────────────────────────────────────────

describe('Stage 4 — POST /api/v1/adjustment-cases/:caseId/reject', () => {
  let rejectedCaseId: string;

  beforeAll(async () => {
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/adjustment-cases',
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
      payload: {
        wellbeingCaseId,
        disabilitySupportCaseId: disabilityCaseId,
        personId:                PERSON_ID,
        adjustmentTypeCode:      'coursework',
      },
    });
    rejectedCaseId = res.json<{ id: string }>().id;
  });

  it('rejects the case and returns 204', async () => {
    const res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/adjustment-cases/${rejectedCaseId}/reject`,
      headers: { authorization: `Bearer ${panelJwt}` },
      payload: { rationale: 'Evidence insufficient to support this adjustment type.' },
    });
    expect(res.statusCode).toBe(204);
  });

  it('status is rejected after rejection', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/adjustment-cases/${rejectedCaseId}`,
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
    });
    expect(res.json<{ statusCode: string }>().statusCode).toBe('rejected');
  });

  it('rejected case has no SRS handoff record', async () => {
    const rows = await ctx.db.execute(sql`
      SELECT count(*) AS cnt
      FROM   wellbeing.srs_handoff_outbox
      WHERE  adjustment_case_id = ${rejectedCaseId}::uuid
    `);
    expect(Number(rows[0]?.['cnt'])).toBe(0);
  });
});

// ── Tenant isolation ──────────────────────────────────────────────────────────

describe('Stage 4 — tenant isolation', () => {
  it('tenant 2 cannot see tenant 1 adjustment case', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/adjustment-cases/${adjustmentCaseId}`,
      headers: { authorization: `Bearer ${ctx.makeJwt({ tenantId: ctx.secondTenantId })}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('tenant 2 list for same personId returns empty', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/adjustment-cases?personId=${PERSON_ID}`,
      headers: { authorization: `Bearer ${ctx.makeJwt({ tenantId: ctx.secondTenantId })}` },
    });
    expect(res.json<{ items: unknown[] }>().items).toHaveLength(0);
  });
});
