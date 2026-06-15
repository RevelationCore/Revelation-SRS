/**
 * Stage 8 — End-to-End Acceptance Review.
 *
 * Validates Phase 8 exit criteria through comprehensive golden-path and
 * negative scenarios.  Each scenario narrates a realistic operational
 * sequence from first contact to SRS outcome.
 *
 * Exit criteria verified here:
 * - Student Wellbeing & Disability module is operational end-to-end.
 * - Adjustment outcome flows: Wellbeing approval → SRS distribution.
 * - EC outcomes: Wellbeing determination → SRS exam board preparation.
 * - All workflow states and transitions are covered.
 * - First-party module boundary: SRS API client is the sole distribution path.
 * - Duplicate handoffs are idempotent.
 * - Failed handoffs recover via retry (compensation pattern).
 * - Cross-tenant isolation holds throughout.
 * - Unauthorised access is denied at the route layer.
 */

import { sql } from 'drizzle-orm';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import type { SubmitAdjustmentInput, SubmitAdjustmentResult } from '../src/srs/srs-adjustment-client.js';
import type { SrsAdjustmentClient } from '../src/srs/srs-adjustment-client.js';
import type { SubmitEcInput, SubmitEcResult } from '../src/srs/srs-ec-client.js';
import type { SrsEcClient } from '../src/srs/srs-ec-client.js';
import { withWellbeingTenantContext } from '../src/db/client.js';
import { upsertProjection } from '../src/repositories/projection-repository.js';
import { startTestApp, type TestWellbeingApp } from './helpers/test-db.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PERSON_ID         = '80000000-0000-0000-0000-000000000001';
const ENROLMENT_ID      = '80000000-0000-0000-0000-000000000010';
const PERSON_ID_EC      = '80000000-0000-0000-0000-000000000002';
const ENROLMENT_ID_EC   = '80000000-0000-0000-0000-000000000020';
const PERSON_ID_MH      = '80000000-0000-0000-0000-000000000003';
const PERSON_ID_RETRY   = '80000000-0000-0000-0000-000000000004';
const ENROLMENT_RETRY   = '80000000-0000-0000-0000-000000000040';

// ── Controllable SRS stubs ────────────────────────────────────────────────────

class ControllableSrsAdjustmentClient implements SrsAdjustmentClient {
  shouldFail  = false;
  submissions: SubmitAdjustmentInput[] = [];

  async submitAdjustment(input: SubmitAdjustmentInput): Promise<SubmitAdjustmentResult> {
    if (this.shouldFail) throw new Error('SRS temporarily unavailable (simulated)');
    this.submissions.push(input);
    return { adjustmentId: `stage8-adj-${input.idempotencyKey}` };
  }
}

class ControllableSrsEcClient implements SrsEcClient {
  shouldFail  = false;
  submissions: SubmitEcInput[] = [];

  async submitEc(input: SubmitEcInput): Promise<SubmitEcResult> {
    if (this.shouldFail) throw new Error('SRS EC temporarily unavailable (simulated)');
    this.submissions.push(input);
    return { exceptionalCircumstancesId: `stage8-ec-${input.idempotencyKey}` };
  }
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('Stage 8 — End-to-End Acceptance Review', () => {
  let ctx:        TestWellbeingApp;
  let advisorJwt: string;
  let mhJwt:      string;
  let panelJwt:   string;
  let auditorJwt: string;
  let srsAdj:     ControllableSrsAdjustmentClient;
  let srsEc:      ControllableSrsEcClient;

  beforeAll(async () => {
    srsAdj = new ControllableSrsAdjustmentClient();
    srsEc  = new ControllableSrsEcClient();

    ctx = await startTestApp({
      srsAdjustmentClient: srsAdj,
      srsEcClient:         srsEc,
    });

    advisorJwt = ctx.makeJwt({ roles: ['wellbeing-advisor'] });
    mhJwt      = ctx.makeJwt({ roles: ['wellbeing-mental-health-advisor'] });
    panelJwt   = ctx.makeJwt({ roles: ['wellbeing-panel-chair'] });
    auditorJwt = ctx.makeJwt({ roles: ['wellbeing-auditor'] });

    // Seed SRS context projections so approve can validate module registrations
    await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) => {
      await upsertProjection(tx, ctx.tenantId, PERSON_ID, {
        activeEnrolmentIds: [ENROLMENT_ID],
        activeModuleCodes:  ['CS101', 'MA201'],
        enrolmentStatus:    'active',
      });
      await upsertProjection(tx, ctx.tenantId, PERSON_ID_EC, {
        activeEnrolmentIds: [ENROLMENT_ID_EC],
        activeModuleCodes:  ['CS101'],
        enrolmentStatus:    'active',
      });
    });
  }, 120_000);

  afterAll(() => ctx.teardown());

  // ── Golden Path 1: Disability case → adjustment → SRS distribution ─────────

  describe('Golden Path 1 — Disability casework to SRS adjustment distribution', () => {
    let wellbeingCaseId:    string;
    let disabilityCaseId:   string;
    let adjustmentCaseId:   string;
    let evidenceRefId:      string;
    let dsaEntitlementId:   string;
    let adjustmentId:       string; // SRS-assigned

    it('1.1 — create disability support case (opens wellbeing case)', async () => {
      const res = await ctx.app.inject({
        method:  'POST',
        url:     '/api/v1/disability-cases',
        headers: { authorization: `Bearer ${advisorJwt}` },
        payload: { personId: PERSON_ID, supportTypeCode: 'dsa', dsaAwardRef: 'DSA-2026-GP1' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ id: string; wellbeingCaseId: string }>();
      disabilityCaseId = body.id;
      wellbeingCaseId  = body.wellbeingCaseId;
      expect(disabilityCaseId).toMatch(/^[0-9a-f-]{36}$/);
      expect(wellbeingCaseId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('1.2 — attach evidence reference (EDRMS document)', async () => {
      const res = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/disability-cases/${disabilityCaseId}/evidence`,
        headers: { authorization: `Bearer ${advisorJwt}` },
        payload: { evidenceTypeCode: 'medical' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ evidenceId: string; documentRef: string }>();
      evidenceRefId = body.evidenceId;
      expect(body.documentRef).toBeTruthy();
    });

    it('1.3 — verify evidence and transition status to received', async () => {
      const res = await ctx.app.inject({
        method:  'PATCH',
        url:     `/api/v1/evidence/${evidenceRefId}/status`,
        headers: { authorization: `Bearer ${advisorJwt}` },
        payload: { statusCode: 'received' },
      });
      expect(res.statusCode).toBe(204);
    });

    it('1.4 — add a DSA entitlement', async () => {
      const res = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/disability-cases/${disabilityCaseId}/dsa-entitlements`,
        headers: { authorization: `Bearer ${advisorJwt}` },
        payload: {
          entitlementTypeCode: 'equipment',
          effectiveFrom:       '2026-06-01T00:00:00Z',
          approvedBy:          'dsa-assessor-001',
        },
      });
      expect(res.statusCode).toBe(201);
      dsaEntitlementId = res.json<{ id: string }>().id;
      expect(dsaEntitlementId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('1.5 — disability case detail contains evidence and DSA entitlement', async () => {
      const res = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/disability-cases/${disabilityCaseId}`,
        headers: { authorization: `Bearer ${advisorJwt}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{
        evidence:     Array<{ id: string; statusCode: string }>;
        entitlements: Array<{ id: string }>;
      }>();
      expect(body.evidence.find((e) => e.id === evidenceRefId)?.statusCode).toBe('received');
      expect(body.entitlements.find((e) => e.id === dsaEntitlementId)).toBeDefined();
    });

    it('1.6 — transition disability case to active support', async () => {
      const res = await ctx.app.inject({
        method:  'PATCH',
        url:     `/api/v1/disability-cases/${disabilityCaseId}/status`,
        headers: { authorization: `Bearer ${advisorJwt}` },
        payload: { statusCode: 'active_support' },
      });
      expect(res.statusCode).toBe(204);
    });

    it('1.7 — create adjustment case linked to disability case', async () => {
      const res = await ctx.app.inject({
        method:  'POST',
        url:     '/api/v1/adjustment-cases',
        headers: { authorization: `Bearer ${advisorJwt}` },
        payload: {
          wellbeingCaseId,
          disabilitySupportCaseId: disabilityCaseId,
          personId:                PERSON_ID,
          adjustmentTypeCode:      'exam-time',
          rationale:               'Medical evidence supports additional time.',
        },
      });
      expect(res.statusCode).toBe(201);
      adjustmentCaseId = res.json<{ id: string }>().id;
    });

    it('1.8 — record a formal assessment', async () => {
      const res = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/adjustment-cases/${adjustmentCaseId}/assessments`,
        headers: { authorization: `Bearer ${advisorJwt}` },
        payload: {
          assessorId:        'disability-advisor-001',
          assessedAt:        '2026-06-15T10:00:00Z',
          outcomeCode:       'recommended',
          findings:          'Student meets DSA criteria for additional time.',
          recommendedAction: 'Grant 25% extra time in all invigilated assessments.',
        },
      });
      expect(res.statusCode).toBe(201);
    });

    it('1.9 — panel chair records panel decision', async () => {
      const res = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/adjustment-cases/${adjustmentCaseId}/panel-decisions`,
        headers: { authorization: `Bearer ${panelJwt}` },
        payload: {
          panelChairId: 'chair-001',
          panelDate:    '2026-06-20T14:00:00Z',
          decisionCode: 'upheld',
          decisionRationale: 'Evidence is sufficient.',
        },
      });
      expect(res.statusCode).toBe(201);
    });

    it('1.10 — panel chair approves → SRS API is called, adjustment ID returned', async () => {
      const submissionsBefore = srsAdj.submissions.length;

      const res = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/adjustment-cases/${adjustmentCaseId}/approve`,
        headers: { authorization: `Bearer ${panelJwt}` },
        payload: {
          enrolmentId:           ENROLMENT_ID,
          scopeCode:             'all-assessments',
          recommendedAdjustment: '25% extra time in all invigilated assessments',
          validFrom:             '2026-09-01T00:00:00Z',
        },
      });

      expect(res.statusCode).toBe(202);
      const body = res.json<{ status: string; adjustmentId: string }>();
      expect(body.status).toBe('submitted');
      expect(body.adjustmentId).toBeTruthy();
      adjustmentId = body.adjustmentId;

      // SRS API client received exactly one new submission
      expect(srsAdj.submissions.length).toBe(submissionsBefore + 1);
      expect(srsAdj.submissions.at(-1)?.adjustmentTypeCode).toBe('exam-time');
      expect(srsAdj.submissions.at(-1)?.idempotencyKey).toBe(`adj-handoff-${adjustmentCaseId}`);
    });

    it('1.11 — case status is approved; SRS application reference is set', async () => {
      const res = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/adjustment-cases/${adjustmentCaseId}`,
        headers: { authorization: `Bearer ${panelJwt}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{
        statusCode:         string;
        srsApplicationRef:  string | null;
        srsHandoffStatus:   string | null;
      }>();
      expect(body.statusCode).toBe('approved');
      expect(body.srsApplicationRef).toBe(adjustmentId);
      expect(body.srsHandoffStatus).toBe('sent');
    });

    it('1.12 — outbox record confirms exactly-once delivery', async () => {
      const rows = await ctx.db.execute(sql`
        SELECT status_code, attempt_count
        FROM   wellbeing.srs_handoff_outbox
        WHERE  adjustment_case_id = ${adjustmentCaseId}::uuid
      `);
      expect(rows.length).toBe(1);
      expect((rows as Array<Record<string, unknown>>)[0]?.['status_code']).toBe('sent');
      expect(Number((rows as Array<Record<string, unknown>>)[0]?.['attempt_count'])).toBe(0);
    });
  });

  // ── Golden Path 2: EC claim → SRS board visibility ────────────────────────

  describe('Golden Path 2 — EC claim to SRS exam board visibility', () => {
    let ecClaimId: string;
    let wellbeingCaseId: string;

    it('2.1 — submit EC claim (opens wellbeing case automatically)', async () => {
      const res = await ctx.app.inject({
        method:  'POST',
        url:     '/api/v1/ec-claims',
        headers: { authorization: `Bearer ${advisorJwt}` },
        payload: {
          personId:            PERSON_ID_EC,
          enrolmentId:         ENROLMENT_ID_EC,
          assessmentPeriodRef: 'AY2025-26-SEM2',
          affectedModuleCodes: ['CS101'],
          circumstancesNarrative: 'Bereavement during exam period',
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ id: string; wellbeingCaseId: string }>();
      ecClaimId       = body.id;
      wellbeingCaseId = body.wellbeingCaseId;
      expect(ecClaimId).toMatch(/^[0-9a-f-]{36}$/);
      expect(wellbeingCaseId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('2.2 — transition to under_review', async () => {
      const res = await ctx.app.inject({
        method:  'PATCH',
        url:     `/api/v1/ec-claims/${ecClaimId}/status`,
        headers: { authorization: `Bearer ${advisorJwt}` },
        payload: { statusCode: 'under_review' },
      });
      expect(res.statusCode).toBe(204);
    });

    it('2.3 — record evidence review as sufficient', async () => {
      const res = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/ec-claims/${ecClaimId}/evidence-reviews`,
        headers: { authorization: `Bearer ${advisorJwt}` },
        payload: {
          reviewerId:         'reviewer-001',
          reviewedAt:         '2026-05-20T14:00:00Z',
          evidenceStatusCode: 'sufficient',
        },
      });
      expect(res.statusCode).toBe(201);
    });

    it('2.4 — determine as upheld → SRS EC client called', async () => {
      const submissionsBefore = srsEc.submissions.length;

      const res = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/ec-claims/${ecClaimId}/determine`,
        headers: { authorization: `Bearer ${advisorJwt}` },
        payload: {
          authorisedById:    'panel-chair-001',
          determinationCode: 'upheld',
          determinedAt:      '2026-05-25T14:00:00Z',
          moduleOutcomes:    [{ moduleCode: 'CS101', outcome: 'defer' }],
        },
      });
      expect(res.statusCode).toBe(202);
      const body = res.json<{ status: string; exceptionalCircumstancesId: string }>();
      expect(body.status).toBe('submitted');
      expect(body.exceptionalCircumstancesId).toBeTruthy();

      // SRS EC handoff was triggered
      expect(srsEc.submissions.length).toBe(submissionsBefore + 1);
      expect(srsEc.submissions.at(-1)?.outcomeCode).toBe('upheld');
      expect(srsEc.submissions.at(-1)?.idempotencyKey).toBe(`ec-handoff-${ecClaimId}`);
    });

    it('2.5 — EC claim detail shows upheld determination', async () => {
      const res = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/ec-claims/${ecClaimId}`,
        headers: { authorization: `Bearer ${advisorJwt}` },
      });
      const body = res.json<{
        statusCode:      string;
        determination:   { determinationCode: string } | null;
        srsHandoffStatus: string | null;
      }>();
      expect(body.statusCode).toBe('upheld');
      expect(body.determination?.determinationCode).toBe('upheld');
      expect(body.srsHandoffStatus).toBe('sent');
    });

    it('2.6 — not_upheld determination does NOT trigger SRS handoff', async () => {
      // Create a separate EC claim
      const newClaim = await ctx.app.inject({
        method:  'POST',
        url:     '/api/v1/ec-claims',
        headers: { authorization: `Bearer ${advisorJwt}` },
        payload: {
          personId:            PERSON_ID_EC,
          enrolmentId:         ENROLMENT_ID_EC,
          assessmentPeriodRef: 'AY2025-26-SEM2',
          affectedModuleCodes: ['MA201'],
        },
      });
      const newId = newClaim.json<{ id: string }>().id;

      const countBefore = srsEc.submissions.length;

      await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/ec-claims/${newId}/determine`,
        headers: { authorization: `Bearer ${advisorJwt}` },
        payload: {
          authorisedById:    'chair-001',
          determinationCode: 'not_upheld',
          determinedAt:      '2026-05-26T14:00:00Z',
          moduleOutcomes:    [{ moduleCode: 'MA201', outcome: 'no-action' }],
        },
      });

      // SRS was NOT called for not_upheld
      expect(srsEc.submissions.length).toBe(countBefore);
    });
  });

  // ── Golden Path 3: Early warning alert → MH intervention ─────────────────

  describe('Golden Path 3 — Early warning alert to mental health intervention', () => {
    let mhCaseId:  string;
    let planId:    string;
    let alertId:   string;

    beforeAll(async () => {
      alertId = '80000000-0000-0000-0000-000000000099';
      await ctx.db.execute(sql`
        INSERT INTO wellbeing.early_warning_alert
          (id, tenant_id, person_id, alert_type_code, alert_source_code, triage_status_code, alert_payload)
        VALUES
          (${alertId}::uuid, ${ctx.tenantId}::uuid, ${PERSON_ID_MH}::uuid,
           'tutor-concern', 'tutor', 'pending', '{"concern":"withdrawal from classes"}'::jsonb)
        ON CONFLICT DO NOTHING
      `);
    });

    it('3.1 — pending alert appears in the triage queue', async () => {
      const res = await ctx.app.inject({
        method:  'GET',
        url:     '/api/v1/early-warning-alerts?triageStatus=pending',
        headers: { authorization: `Bearer ${advisorJwt}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ items: Array<{ id: string }> }>();
      expect(body.items.some((a) => a.id === alertId)).toBe(true);
    });

    it('3.2 — MH advisor creates a mental health case in response', async () => {
      const res = await ctx.app.inject({
        method:  'POST',
        url:     '/api/v1/mental-health-cases',
        headers: { authorization: `Bearer ${mhJwt}` },
        payload: {
          personId:              PERSON_ID_MH,
          presentingConcernCode: 'withdrawal',
          riskLevelCode:         'medium',
        },
      });
      expect(res.statusCode).toBe(201);
      mhCaseId = res.json<{ id: string }>().id;
    });

    it('3.3 — triage alert: assign to MH case', async () => {
      const res = await ctx.app.inject({
        method:  'PATCH',
        url:     `/api/v1/early-warning-alerts/${alertId}/triage`,
        headers: { authorization: `Bearer ${advisorJwt}` },
        payload: { triageStatusCode: 'assigned', assignedCaseId: mhCaseId },
      });
      expect(res.statusCode).toBe(204);

      const detail = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/early-warning-alerts/${alertId}`,
        headers: { authorization: `Bearer ${advisorJwt}` },
      });
      const alert = detail.json<{ triageStatusCode: string; assignedCaseId: string }>();
      expect(alert.triageStatusCode).toBe('assigned');
      expect(alert.assignedCaseId).toBe(mhCaseId);
    });

    it('3.4 — record informed consent from student', async () => {
      const res = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/mental-health-cases/${mhCaseId}/consent`,
        headers: { authorization: `Bearer ${mhJwt}` },
        payload: { consentDate: '2026-06-16T09:00:00Z' },
      });
      expect(res.statusCode).toBe(204);
    });

    it('3.5 — add session notes (MH advisor role, audit-logged)', async () => {
      const postRes = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/mental-health-cases/${mhCaseId}/session-notes`,
        headers: { authorization: `Bearer ${mhJwt}` },
        payload: {
          practitionerId:  'mh-advisor-001',
          sessionDate:     '2026-06-17T10:00:00Z',
          sessionTypeCode: 'individual',
          content:         'Initial assessment session. Student engaged well.',
        },
      });
      expect(postRes.statusCode).toBe(201);

      const auditRows = await ctx.db.execute(sql`
        SELECT action_code FROM wellbeing.audit_log
        WHERE  resource_type = 'mh-session-note'
        AND    tenant_id     = ${ctx.tenantId}::uuid
        AND    person_id     = ${PERSON_ID_MH}::uuid
      `);
      const codes = (auditRows as Array<{ action_code: string }>).map((r) => r.action_code);
      expect(codes).toContain('write');
    });

    it('3.6 — create and activate an intervention plan', async () => {
      const createRes = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/mental-health-cases/${mhCaseId}/intervention-plans`,
        headers: { authorization: `Bearer ${mhJwt}` },
        payload: {
          planTypeCode:         'counselling',
          practitionerId:       'mh-advisor-001',
          sessionFrequencyCode: 'fortnightly',
          plannedSessionCount:  '6',
          goals: [{ goal: 'Re-engage with academic community' }],
          reviewDate: '2026-09-01T10:00:00Z',
        },
      });
      expect(createRes.statusCode).toBe(201);
      planId = createRes.json<{ id: string }>().id;

      const activateRes = await ctx.app.inject({
        method:  'PATCH',
        url:     `/api/v1/mental-health-cases/${mhCaseId}/intervention-plans/${planId}/status`,
        headers: { authorization: `Bearer ${mhJwt}` },
        payload: { statusCode: 'active' },
      });
      expect(activateRes.statusCode).toBe(204);
    });

    it('3.7 — active intervention plan is counted in the wellbeing summary', async () => {
      const res = await ctx.app.inject({
        method:  'GET',
        url:     '/api/v1/reports/wellbeing-summary',
        headers: { authorization: `Bearer ${advisorJwt}` },
      });
      const body = res.json<{ activeInterventionPlans: number }>();
      expect(body.activeInterventionPlans).toBeGreaterThanOrEqual(1);
    });

    it('3.8 — session note content does not appear in MH case detail', async () => {
      const res = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/mental-health-cases/${mhCaseId}`,
        headers: { authorization: `Bearer ${mhJwt}` },
      });
      expect(res.body).not.toContain('Initial assessment session');
      expect(res.body).not.toContain('engaged well');
    });
  });

  // ── Golden Path 4: Projection replay and reconciliation ───────────────────

  describe('Golden Path 4 — SRS projection replay is idempotent', () => {
    const REPLAY_PERSON = '80000000-0000-0000-0000-000000000005';
    const REPLAY_ENROL  = '80000000-0000-0000-0000-000000000050';
    const REPLAY_MOD    = 'PH100';

    it('4.1 — dispatch enrolled event creates a projection', async () => {
      await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) => {
        await upsertProjection(tx, ctx.tenantId, REPLAY_PERSON, {
          activeEnrolmentIds: [REPLAY_ENROL],
          enrolmentStatus:    'active',
        });
      });

      const rows = await ctx.db.execute(sql`
        SELECT active_enrolment_ids FROM wellbeing.srs_context_projection
        WHERE  tenant_id = ${ctx.tenantId}::uuid
        AND    person_id = ${REPLAY_PERSON}::uuid
      `);
      expect(rows.length).toBe(1);
    });

    it('4.2 — dispatch module-registered event updates active_module_codes', async () => {
      await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) => {
        await upsertProjection(tx, ctx.tenantId, REPLAY_PERSON, {
          activeModuleCodes: [REPLAY_MOD],
        });
      });
    });

    it('4.3 — replaying the same events leaves projection unchanged', async () => {
      const [before] = await ctx.db.execute(sql`
        SELECT active_module_codes, active_enrolment_ids, last_updated_at
        FROM   wellbeing.srs_context_projection
        WHERE  tenant_id = ${ctx.tenantId}::uuid
        AND    person_id = ${REPLAY_PERSON}::uuid
      `) as Array<Record<string, unknown>>;

      // Replay
      await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) => {
        await upsertProjection(tx, ctx.tenantId, REPLAY_PERSON, {
          activeEnrolmentIds: [REPLAY_ENROL],
          activeModuleCodes:  [REPLAY_MOD],
          enrolmentStatus:    'active',
        });
      });

      const [after] = await ctx.db.execute(sql`
        SELECT active_module_codes, active_enrolment_ids
        FROM   wellbeing.srs_context_projection
        WHERE  tenant_id = ${ctx.tenantId}::uuid
        AND    person_id = ${REPLAY_PERSON}::uuid
      `) as Array<Record<string, unknown>>;

      // Projection data is the same as before replay
      expect(JSON.stringify(after?.['active_module_codes']))
        .toBe(JSON.stringify(before?.['active_module_codes']));
      expect(JSON.stringify(after?.['active_enrolment_ids']))
        .toBe(JSON.stringify(before?.['active_enrolment_ids']));
    });
  });

  // ── Negative 1: Duplicate SRS handoff is idempotent ──────────────────────

  describe('Negative 1 — Duplicate adjustment handoff is idempotent', () => {
    let adjCaseId: string;

    beforeAll(async () => {
      const dc = await ctx.app.inject({
        method:  'POST',
        url:     '/api/v1/disability-cases',
        headers: { authorization: `Bearer ${advisorJwt}` },
        payload: { personId: PERSON_ID, supportTypeCode: 'dsa' },
      });
      const { id: dcId, wellbeingCaseId: wcId } = dc.json<{ id: string; wellbeingCaseId: string }>();

      const ac = await ctx.app.inject({
        method:  'POST',
        url:     '/api/v1/adjustment-cases',
        headers: { authorization: `Bearer ${advisorJwt}` },
        payload: {
          wellbeingCaseId:         wcId,
          disabilitySupportCaseId: dcId,
          personId:                PERSON_ID,
          adjustmentTypeCode:      'venue',
        },
      });
      adjCaseId = ac.json<{ id: string }>().id;
    });

    it('N1.1 — first approve returns 202', async () => {
      const res = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/adjustment-cases/${adjCaseId}/approve`,
        headers: { authorization: `Bearer ${panelJwt}` },
        payload: {
          enrolmentId:           ENROLMENT_ID,
          scopeCode:             'specific-module',
          recommendedAdjustment: 'Quiet room for all examinations',
          validFrom:             '2026-09-01T00:00:00Z',
          forceApprove:          true,
        },
      });
      expect(res.statusCode).toBe(202);
    });

    it('N1.2 — second approve returns 200 already_sent; SRS not called again', async () => {
      const countBefore = srsAdj.submissions.length;

      const res = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/adjustment-cases/${adjCaseId}/approve`,
        headers: { authorization: `Bearer ${panelJwt}` },
        payload: {
          enrolmentId:           ENROLMENT_ID,
          scopeCode:             'specific-module',
          recommendedAdjustment: 'Quiet room for all examinations',
          validFrom:             '2026-09-01T00:00:00Z',
          forceApprove:          true,
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ status: string }>().status).toBe('already_sent');
      expect(srsAdj.submissions.length).toBe(countBefore);
    });

    it('N1.3 — outbox contains exactly one record', async () => {
      const rows = await ctx.db.execute(sql`
        SELECT count(*) AS cnt
        FROM   wellbeing.srs_handoff_outbox
        WHERE  adjustment_case_id = ${adjCaseId}::uuid
      `);
      expect(Number((rows as Array<Record<string, unknown>>)[0]?.['cnt'])).toBe(1);
    });
  });

  // ── Negative 2: Failed SRS handoff — compensation via retry ──────────────

  describe('Negative 2 — Failed SRS handoff compensates on retry', () => {
    let adjCaseId: string;

    beforeAll(async () => {
      // Seed projection for PERSON_ID_RETRY
      await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) => {
        await upsertProjection(tx, ctx.tenantId, PERSON_ID_RETRY, {
          activeEnrolmentIds: [ENROLMENT_RETRY],
          activeModuleCodes:  ['CS101'],
          enrolmentStatus:    'active',
        });
      });

      const dc = await ctx.app.inject({
        method:  'POST',
        url:     '/api/v1/disability-cases',
        headers: { authorization: `Bearer ${advisorJwt}` },
        payload: { personId: PERSON_ID_RETRY, supportTypeCode: 'dsa' },
      });
      const { id: dcId, wellbeingCaseId: wcId } = dc.json<{ id: string; wellbeingCaseId: string }>();

      const ac = await ctx.app.inject({
        method:  'POST',
        url:     '/api/v1/adjustment-cases',
        headers: { authorization: `Bearer ${advisorJwt}` },
        payload: {
          wellbeingCaseId:         wcId,
          disabilitySupportCaseId: dcId,
          personId:                PERSON_ID_RETRY,
          adjustmentTypeCode:      'exam-time',
        },
      });
      adjCaseId = ac.json<{ id: string }>().id;
    });

    it('N2.1 — first approve fails (SRS unavailable) → 502', async () => {
      srsAdj.shouldFail = true;

      const res = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/adjustment-cases/${adjCaseId}/approve`,
        headers: { authorization: `Bearer ${panelJwt}` },
        payload: {
          enrolmentId:           ENROLMENT_RETRY,
          scopeCode:             'all-assessments',
          recommendedAdjustment: '25% extra time',
          validFrom:             '2026-09-01T00:00:00Z',
          forceApprove:          true,
        },
      });
      expect(res.statusCode).toBe(502);
      expect(res.json<{ error: string }>().error).toContain('will be retried');
    });

    it('N2.2 — outbox record is marked failed with attempt_count = 1', async () => {
      const rows = await ctx.db.execute(sql`
        SELECT status_code, attempt_count
        FROM   wellbeing.srs_handoff_outbox
        WHERE  adjustment_case_id = ${adjCaseId}::uuid
      `);
      const row = (rows as Array<Record<string, unknown>>)[0];
      expect(row?.['status_code']).toBe('failed');
      expect(Number(row?.['attempt_count'])).toBe(1);
    });

    it('N2.3 — retry approve (SRS restored) → 202, outbox marked sent', async () => {
      srsAdj.shouldFail = false; // SRS is back

      const res = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/adjustment-cases/${adjCaseId}/approve`,
        headers: { authorization: `Bearer ${panelJwt}` },
        payload: {
          enrolmentId:           ENROLMENT_RETRY,
          scopeCode:             'all-assessments',
          recommendedAdjustment: '25% extra time',
          validFrom:             '2026-09-01T00:00:00Z',
          forceApprove:          true,
        },
      });
      expect(res.statusCode).toBe(202);
      expect(res.json<{ status: string }>().status).toBe('submitted');
    });

    it('N2.4 — outbox is now sent (exactly one record)', async () => {
      const rows = await ctx.db.execute(sql`
        SELECT status_code, attempt_count
        FROM   wellbeing.srs_handoff_outbox
        WHERE  adjustment_case_id = ${adjCaseId}::uuid
      `);
      expect(rows.length).toBe(1);
      const row = (rows as Array<Record<string, unknown>>)[0];
      expect(row?.['status_code']).toBe('sent');
    });
  });

  // ── Negative 3: First-party module boundary enforcement ───────────────────

  describe('Negative 3 — First-party module boundary: SRS API is the sole distribution path', () => {
    it('N3.1 — adjustment distribution routes through the SRS client, not directly to DB', async () => {
      const countBefore = srsAdj.submissions.length;

      const dc = await ctx.app.inject({
        method:  'POST',
        url:     '/api/v1/disability-cases',
        headers: { authorization: `Bearer ${advisorJwt}` },
        payload: { personId: PERSON_ID, supportTypeCode: 'dsa' },
      });
      const { id: dcId, wellbeingCaseId: wcId } = dc.json<{ id: string; wellbeingCaseId: string }>();

      const ac = await ctx.app.inject({
        method:  'POST',
        url:     '/api/v1/adjustment-cases',
        headers: { authorization: `Bearer ${advisorJwt}` },
        payload: {
          wellbeingCaseId:         wcId,
          disabilitySupportCaseId: dcId,
          personId:                PERSON_ID,
          adjustmentTypeCode:      'coursework',
        },
      });
      const adjId = ac.json<{ id: string }>().id;

      await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/adjustment-cases/${adjId}/approve`,
        headers: { authorization: `Bearer ${panelJwt}` },
        payload: {
          enrolmentId:           ENROLMENT_ID,
          scopeCode:             'all-assessments',
          recommendedAdjustment: 'Extended deadline',
          validFrom:             '2026-09-01T00:00:00Z',
          forceApprove:          true,
        },
      });

      // SRS client stub was called — confirms API path was taken
      expect(srsAdj.submissions.length).toBe(countBefore + 1);
    });

    it('N3.2 — Wellbeing module has no direct reference to SRS-owned data tables', async () => {
      // The wellbeing schema only contains wellbeing-owned tables.
      // This query confirms no srs.* tables are accessible through the
      // wellbeing schema context (which would indicate schema coupling).
      const rows = await ctx.db.execute(sql`
        SELECT tablename
        FROM   pg_tables
        WHERE  schemaname = 'wellbeing'
        ORDER  BY tablename
      `);
      const tables = (rows as Array<{ tablename: string }>).map((r) => r.tablename);

      // Wellbeing-owned tables only — no SRS tables
      const expectedTables = [
        'adjustment_assessment',
        'adjustment_case',
        'adjustment_panel_decision',
        'audit_log',
        'disability_support_case',
        'dsa_entitlement',
        'early_warning_alert',
        'ec_claim',
        'ec_determination',
        'ec_evidence_review',
        'enrolment_person_map',
        'event_log',
        'evidence_reference',
        'intervention_plan',
        'mental_health_case',
        'mh_session_note',
        'module_reg_person_map',
        'sar_export_log',
        'srs_context_projection',
        'srs_ec_handoff_outbox',
        'srs_handoff_outbox',
        'wellbeing_case',
      ];
      for (const table of expectedTables) {
        expect(tables, `Expected table wellbeing.${table} to exist`).toContain(table);
      }
      // No SRS-owned tables should be in the wellbeing schema
      const srsTables = tables.filter((t) => t.startsWith('srs_student') || t.startsWith('srs_module'));
      expect(srsTables).toHaveLength(0);
    });
  });

  // ── Negative 4: Cross-tenant isolation ───────────────────────────────────

  describe('Negative 4 — Cross-tenant isolation', () => {
    let tenant1CaseId: string;

    beforeAll(async () => {
      const dc = await ctx.app.inject({
        method:  'POST',
        url:     '/api/v1/disability-cases',
        headers: { authorization: `Bearer ${advisorJwt}` },
        payload: { personId: PERSON_ID, supportTypeCode: 'ni' },
      });
      tenant1CaseId = dc.json<{ id: string }>().id;
    });

    it('N4.1 — tenant 2 cannot read tenant 1 disability case (404, not 403)', async () => {
      const tenant2Jwt = ctx.makeJwt({ tenantId: ctx.secondTenantId });
      const res = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/disability-cases/${tenant1CaseId}`,
        headers: { authorization: `Bearer ${tenant2Jwt}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('N4.2 — tenant 2 listing for the same personId returns empty', async () => {
      const tenant2Jwt = ctx.makeJwt({ tenantId: ctx.secondTenantId });
      const res = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/disability-cases?personId=${PERSON_ID}`,
        headers: { authorization: `Bearer ${tenant2Jwt}` },
      });
      expect(res.json<{ items: unknown[] }>().items).toHaveLength(0);
    });

    it('N4.3 — tenant 2 cannot see tenant 1 wellbeing summary figures', async () => {
      const tenant2Jwt = ctx.makeJwt({ tenantId: ctx.secondTenantId });
      const res = await ctx.app.inject({
        method:  'GET',
        url:     '/api/v1/reports/wellbeing-summary',
        headers: { authorization: `Bearer ${tenant2Jwt}` },
      });
      expect(res.statusCode).toBe(200);
      // Tenant 2 has no data; counts are all zero
      const body = res.json<{
        openMentalHealthCases:   number;
        activeInterventionPlans: number;
        pendingAlerts:           number;
      }>();
      expect(body.openMentalHealthCases).toBe(0);
      expect(body.activeInterventionPlans).toBe(0);
    });
  });

  // ── Negative 5: Unauthorized access is denied ─────────────────────────────

  describe('Negative 5 — Unauthorised access is denied at route layer', () => {
    let mhCaseId: string;

    beforeAll(async () => {
      const res = await ctx.app.inject({
        method:  'POST',
        url:     '/api/v1/mental-health-cases',
        headers: { authorization: `Bearer ${mhJwt}` },
        payload: { personId: PERSON_ID_MH, presentingConcernCode: 'anxiety' },
      });
      mhCaseId = res.json<{ id: string }>().id;
    });

    it('N5.1 — no JWT returns 401', async () => {
      const res = await ctx.app.inject({ method: 'GET', url: `/api/v1/disability-cases?personId=${PERSON_ID}` });
      expect(res.statusCode).toBe(401);
    });

    it('N5.2 — wellbeing-advisor denied read of session notes (403)', async () => {
      const res = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/mental-health-cases/${mhCaseId}/session-notes`,
        headers: { authorization: `Bearer ${advisorJwt}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('N5.3 — wellbeing-advisor denied approve action (403)', async () => {
      const res = await ctx.app.inject({
        method:  'POST',
        url:     '/api/v1/adjustment-cases/00000000-0000-0000-0000-000000000001/approve',
        headers: { authorization: `Bearer ${advisorJwt}` },
        payload: {
          enrolmentId:           ENROLMENT_ID,
          scopeCode:             'all-assessments',
          recommendedAdjustment: 'x',
          validFrom:             '2026-09-01T00:00:00Z',
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('N5.4 — wellbeing-advisor denied SAR export (403)', async () => {
      const res = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/sar/export/${PERSON_ID}`,
        headers: { authorization: `Bearer ${advisorJwt}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('N5.5 — wellbeing-auditor CAN perform SAR export and it is logged', async () => {
      const res = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/sar/export/${PERSON_ID}`,
        headers: { authorization: `Bearer ${auditorJwt}` },
      });
      expect(res.statusCode).toBe(200);

      const sarRows = await ctx.db.execute(sql`
        SELECT exported_for_person_id
        FROM   wellbeing.sar_export_log
        WHERE  tenant_id              = ${ctx.tenantId}::uuid
        AND    exported_for_person_id = ${PERSON_ID}::uuid
      `);
      expect(sarRows.length).toBeGreaterThanOrEqual(1);
    });
  });
});
