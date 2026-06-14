/**
 * Stage 3 — Assessment, Grade, and Progression Refactor integration tests.
 *
 * Exit criterion: "Grade and progression calculations are reproducible from
 * rules, workflow decision evidence, and source marks."
 *
 * Tests cover:
 *   1. assessment.late-penalty.enabled flag disables penalty when off
 *   2. assessment.resit-cap.enabled flag caps attempt-2 marks
 *   3. mark_calculation_evidence written after mark ingestion
 *   4. progression_calculation_evidence written after progression decision
 *   5. award_calculation_evidence written after award conferral
 *   6. exam-board.operating-model flag exists with correct variants
 *   7. exam-board-school-led and exam-board-departmental-staged definitions exist
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let jwt: string;       // registry-administrator
let adminJwt: string;  // tenant-administrator  (feature-flag:write, rule:write)
let chairJwt: string;  // exam-board-chair       (exam-board:ratify)

beforeAll(async () => {
  ctx      = await startTestApp();
  jwt      = await ctx.makeJwt();
  adminJwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
  chairJwt = await ctx.makeJwt({ roles: ['exam-board-chair'] });
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

// ── Shared helpers ────────────────────────────────────────────────────────────

async function createStudent(firstName: string, familyName: string): Promise<string> {
  const res = await ctx.app.inject({
    method:  'POST',
    url:     '/api/v1/students',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { legalFirstName: firstName, legalFamilyName: familyName },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ personId: string }>().personId;
}

async function createEnrolment(personId: string, academicYear = '2026-27'): Promise<string> {
  const res = await ctx.app.inject({
    method:  'POST',
    url:     '/api/v1/enrolments',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      personId,
      modeOfStudyCode:     'full-time',
      academicYearOfEntry: academicYear,
      startDate:           `${academicYear.slice(0, 4)}-09-22`,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ enrolmentId: string }>().enrolmentId;
}

async function createAcademicRule(
  ruleTypeCode: string,
  ruleKey: string,
  ruleValue: Record<string, unknown>,
): Promise<void> {
  const res = await ctx.app.inject({
    method:  'POST',
    url:     '/api/v1/academic-rules',
    headers: { authorization: `Bearer ${adminJwt}` },
    payload: { ruleTypeCode, ruleKey, ruleValue },
  });
  expect(res.statusCode).toBe(201);
}

async function enableFlag(flagKey: string, variantKey: string): Promise<void> {
  const listRes = await ctx.app.inject({
    method:  'GET',
    url:     '/api/v1/feature-flags',
    headers: { authorization: `Bearer ${adminJwt}` },
  });
  const flags = listRes.json<Array<{ flagKey: string; featureFlagId: string }>>();
  const flag = flags.find((f) => f.flagKey === flagKey);
  if (!flag) throw new Error(`Feature flag not found: ${flagKey}`);

  // Expire any existing active tenant-scoped assignments so the new one wins
  await ctx.db.execute(sql`
    UPDATE feature_flag_assignment
    SET active_to = now() - interval '1 millisecond'
    WHERE flag_id = ${flag.featureFlagId}::uuid
      AND tenant_id = ${ctx.tenantId}::uuid
      AND (active_to IS NULL OR active_to > now())
  `);

  const res = await ctx.app.inject({
    method:  'POST',
    url:     `/api/v1/feature-flags/${flag.featureFlagId}/assignments`,
    headers: { authorization: `Bearer ${adminJwt}` },
    payload: { variantKey, activeFrom: new Date(Date.now() - 1000).toISOString() },
  });
  expect(res.statusCode).toBe(201);
}

interface RegistrationSetup {
  academicPeriodId:     string;
  moduleOfferingId:     string;
  moduleRegistrationId: string;
  assessmentComponentId: string;
}

async function setupRegistration(enrolmentId: string, opts: {
  academicYear: string;
  moduleCode:   string;
  creditValue:  number;
}): Promise<RegistrationSetup> {
  const modRes = await ctx.app.inject({
    method:  'POST',
    url:     '/api/v1/modules',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { code: opts.moduleCode, title: `${opts.moduleCode} Module`, creditValue: opts.creditValue },
  });
  expect(modRes.statusCode).toBe(201);
  const { moduleId } = modRes.json<{ moduleId: string }>();

  const periodRes = await ctx.app.inject({
    method:  'POST',
    url:     '/api/v1/academic-periods',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      academicYear:   opts.academicYear,
      periodCode:     `${opts.moduleCode}-S1`,
      periodTypeCode: 'semester',
      startDate:      `${opts.academicYear.slice(0, 4)}-09-22`,
      endDate:        `${opts.academicYear.slice(0, 4)}-12-19`,
    },
  });
  expect(periodRes.statusCode).toBe(201);
  const { academicPeriodId } = periodRes.json<{ academicPeriodId: string }>();

  const offeringRes = await ctx.app.inject({
    method:  'POST',
    url:     '/api/v1/module-offerings',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { moduleId, academicPeriodId, deliveryModeCode: 'in-person', capacity: 30 },
  });
  expect(offeringRes.statusCode).toBe(201);
  const { moduleOfferingId } = offeringRes.json<{ moduleOfferingId: string }>();

  const compRes = await ctx.app.inject({
    method:  'POST',
    url:     `/api/v1/module-offerings/${moduleOfferingId}/components`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      componentTypeCode: 'coursework',
      title:             `${opts.moduleCode} Coursework`,
      weighting:         100,
    },
  });
  expect(compRes.statusCode).toBe(201);
  const { assessmentComponentId } = compRes.json<{ assessmentComponentId: string }>();

  const regRes = await ctx.app.inject({
    method:  'POST',
    url:     '/api/v1/module-registrations',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      enrolmentId,
      moduleOfferingId,
      registrationDate: `${opts.academicYear.slice(0, 4)}-10-01`,
    },
  });
  expect(regRes.statusCode).toBe(201);
  const { moduleRegistrationId } = regRes.json<{ moduleRegistrationId: string }>();

  return { academicPeriodId, moduleOfferingId, moduleRegistrationId, assessmentComponentId };
}

/** Create a locked module result by going through the full board ratification path. */
async function seedRatifiedResult(
  enrolmentId: string,
  moduleCode:  string,
  mark:        number,
  creditValue: number,
  academicYear = '2025-26',
): Promise<void> {
  const { academicPeriodId, moduleRegistrationId, assessmentComponentId } =
    await setupRegistration(enrolmentId, { academicYear, moduleCode, creditValue });

  await ctx.app.inject({
    method:  'POST',
    url:     `/api/v1/module-registrations/${moduleRegistrationId}/marks`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: { assessmentComponentId, rawMark: mark },
  });

  const boardRes = await ctx.app.inject({
    method:  'POST',
    url:     '/api/v1/exam-boards',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { boardTypeCode: 'award', academicYear, academicPeriodId },
  });
  expect(boardRes.statusCode).toBe(201);
  const { examBoardId } = boardRes.json<{ examBoardId: string }>();

  const signoffRes = await ctx.app.inject({
    method:  'POST',
    url:     `/api/v1/exam-boards/${examBoardId}/external-examiner-signoff`,
    headers: { authorization: `Bearer ${chairJwt}` },
    payload: { commentary: 'Approved' },
  });
  expect(signoffRes.statusCode).toBe(201);

  const ratifyRes = await ctx.app.inject({
    method:  'POST',
    url:     `/api/v1/exam-boards/${examBoardId}/ratification`,
    headers: { authorization: `Bearer ${chairJwt}` },
  });
  expect(ratifyRes.statusCode).toBe(204);
}

// ── Feature flags ─────────────────────────────────────────────────────────────

describe('Stage 3 feature flags', () => {
  it('assessment.late-penalty.enabled exists with on/off variants and defaults to on', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/feature-flags',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const flags = res.json<Array<{ flagKey: string; statusCode: string; defaultVariantKey: string }>>();
    const flag = flags.find((f) => f.flagKey === 'assessment.late-penalty.enabled');
    expect(flag, 'assessment.late-penalty.enabled must exist').toBeDefined();
    expect(flag!.statusCode).toBe('active');
    expect(flag!.defaultVariantKey).toBe('on');
  });

  it('assessment.resit-cap.enabled exists and defaults to off', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/feature-flags',
      headers: { authorization: `Bearer ${jwt}` },
    });
    const flags = res.json<Array<{ flagKey: string; defaultVariantKey: string }>>();
    const flag = flags.find((f) => f.flagKey === 'assessment.resit-cap.enabled');
    expect(flag, 'assessment.resit-cap.enabled must exist').toBeDefined();
    expect(flag!.defaultVariantKey).toBe('off');
  });

  it('exam-board.operating-model exists with registry-led, school-led, departmental-staged variants', async () => {
    const listRes = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/feature-flags',
      headers: { authorization: `Bearer ${jwt}` },
    });
    const flags = listRes.json<Array<{ flagKey: string; featureFlagId: string; defaultVariantKey: string }>>();
    const flag = flags.find((f) => f.flagKey === 'exam-board.operating-model');
    expect(flag, 'exam-board.operating-model must exist').toBeDefined();
    expect(flag!.defaultVariantKey).toBe('registry-led');

    const detailRes = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/feature-flags/${flag!.featureFlagId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(detailRes.statusCode).toBe(200);
    const detail = detailRes.json<{ variants: Array<{ variantKey: string }> }>();
    const keys = detail.variants.map((v) => v.variantKey);
    expect(keys).toContain('registry-led');
    expect(keys).toContain('school-led');
    expect(keys).toContain('departmental-staged');
  });
});

// ── Board operating-model workflow definitions ────────────────────────────────

describe('board operating model workflow definitions', () => {
  it('exam-board-school-led is active and has board-constituted, data-pack-prepared, school-director-review, registry-finalisation steps', async () => {
    const listRes = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/workflow-definitions?statusCode=active',
      headers: { authorization: `Bearer ${jwt}` },
    });
    const defs = listRes.json<Array<{ workflowDefinitionId: string; definitionCode: string }>>();
    const def = defs.find((d) => d.definitionCode === 'exam-board-school-led');
    expect(def, 'exam-board-school-led must be an active workflow definition').toBeDefined();

    const steps = await ctx.db.execute(sql`
      SELECT ws.step_key, ws.step_type_code, ws.owner_role_code
      FROM workflow_step ws
      JOIN workflow_definition_version wdv ON wdv.id = ws.workflow_definition_version_id
      JOIN workflow_definition wd ON wd.id = wdv.workflow_definition_id
      WHERE wd.definition_code = 'exam-board-school-led'
        AND wd.tenant_id IS NULL
        AND wdv.status_code = 'active'
      ORDER BY ws.sort_order
    `);
    const stepList = steps as unknown as Array<{
      step_key: string;
      step_type_code: string;
      owner_role_code: string | null;
    }>;
    const stepKeys = stepList.map((s) => s.step_key);
    expect(stepKeys).toContain('data-pack-prepared');
    expect(stepKeys).toContain('school-director-review');
    expect(stepKeys).toContain('external-examiner-review');
    expect(stepKeys).toContain('registry-finalisation');

    const schoolStep = stepList.find((s) => s.step_key === 'school-director-review');
    expect(schoolStep?.owner_role_code).toBe('school-director');
  });

  it('exam-board-departmental-staged is active and has departmental-committee-review and school-executive-approval steps', async () => {
    const steps = await ctx.db.execute(sql`
      SELECT ws.step_key, ws.owner_role_code
      FROM workflow_step ws
      JOIN workflow_definition_version wdv ON wdv.id = ws.workflow_definition_version_id
      JOIN workflow_definition wd ON wd.id = wdv.workflow_definition_id
      WHERE wd.definition_code = 'exam-board-departmental-staged'
        AND wd.tenant_id IS NULL
        AND wdv.status_code = 'active'
      ORDER BY ws.sort_order
    `);
    const stepList = steps as unknown as Array<{ step_key: string; owner_role_code: string | null }>;
    const stepKeys = stepList.map((s) => s.step_key);
    expect(stepKeys).toContain('departmental-committee-review');
    expect(stepKeys).toContain('school-executive-approval');
    expect(stepKeys).toContain('central-registry-lock');

    const deptStep = stepList.find((s) => s.step_key === 'departmental-committee-review');
    expect(deptStep?.owner_role_code).toBe('department-chair');
  });
});

// ── Late-penalty flag ─────────────────────────────────────────────────────────

describe('assessment.late-penalty.enabled flag', () => {
  it('when off, no late penalty is applied even for a submission 9 days late', async () => {
    await enableFlag('assessment.late-penalty.enabled', 'off');
    await createAcademicRule('late-penalty-rate', 'default', { percentPerDay: 5 });

    const personId = await createStudent('LatePenalty', 'Disabled');
    const enrolmentId = await createEnrolment(personId);
    const uid = Math.random().toString(36).slice(2, 8).toUpperCase();
    const { moduleRegistrationId, assessmentComponentId } = await setupRegistration(enrolmentId, {
      academicYear: '2026-27',
      moduleCode:   `LP${uid}`,
      creditValue:  20,
    });

    const markRes = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/module-registrations/${moduleRegistrationId}/marks`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        assessmentComponentId,
        rawMark:       60,
        attemptNumber: 1,
        submittedAt:   '2026-11-10T12:00:00Z',
        dueAt:         '2026-11-01T12:00:00Z',  // 9 days late → 45 % if enabled
      },
    });
    expect(markRes.statusCode).toBe(201);
    const { markId } = markRes.json<{ markId: string }>();

    const listRes = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/module-registrations/${moduleRegistrationId}/marks`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    const marks = listRes.json<Array<{ markId: string; rawMark: number; adjustedMark: number; penaltyApplied: boolean }>>();
    const mark = marks.find((m) => m.markId === markId);
    expect(mark).toBeDefined();
    expect(mark!.penaltyApplied).toBe(false);
    expect(mark!.adjustedMark).toBe(60);

    // Re-enable for tests that follow
    await enableFlag('assessment.late-penalty.enabled', 'on');
  });

  it('when on (default), a late penalty of 5 % per day is deducted', async () => {
    await createAcademicRule('late-penalty-rate', 'default', { percentPerDay: 5 });

    const personId = await createStudent('LatePenalty', 'Applied');
    const enrolmentId = await createEnrolment(personId);
    const uid = Math.random().toString(36).slice(2, 8).toUpperCase();
    const { moduleRegistrationId, assessmentComponentId } = await setupRegistration(enrolmentId, {
      academicYear: '2026-27',
      moduleCode:   `LPA${uid}`,
      creditValue:  20,
    });

    const markRes = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/module-registrations/${moduleRegistrationId}/marks`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        assessmentComponentId,
        rawMark:       70,
        attemptNumber: 1,
        submittedAt:   '2026-11-05T12:00:00Z',
        dueAt:         '2026-11-01T12:00:00Z',  // 4 days late → 20 %
      },
    });
    expect(markRes.statusCode).toBe(201);
    const { markId } = markRes.json<{ markId: string }>();

    const listRes = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/module-registrations/${moduleRegistrationId}/marks`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    const marks = listRes.json<Array<{ markId: string; rawMark: number; adjustedMark: number; penaltyApplied: boolean }>>();
    const mark = marks.find((m) => m.markId === markId);
    expect(mark).toBeDefined();
    expect(mark!.penaltyApplied).toBe(true);
    expect(mark!.adjustedMark).toBe(50);  // 70 − (4 × 5) = 50
  });
});

// ── Resit mark cap ────────────────────────────────────────────────────────────

describe('assessment.resit-cap.enabled flag', () => {
  it('when on, attempt-2 mark above 40 is capped at the UK HE default of 40', async () => {
    await enableFlag('assessment.resit-cap.enabled', 'on');

    const personId = await createStudent('ResitCap', 'Applied');
    const enrolmentId = await createEnrolment(personId);
    const uid = Math.random().toString(36).slice(2, 8).toUpperCase();
    const { moduleRegistrationId, assessmentComponentId } = await setupRegistration(enrolmentId, {
      academicYear: '2026-27',
      moduleCode:   `RC${uid}`,
      creditValue:  20,
    });

    // First attempt fails
    await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/module-registrations/${moduleRegistrationId}/marks`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { assessmentComponentId, rawMark: 25, attemptNumber: 1 },
    });

    // Second attempt: raw 75 → capped at 40
    const attempt2Res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/module-registrations/${moduleRegistrationId}/marks`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { assessmentComponentId, rawMark: 75, attemptNumber: 2 },
    });
    expect(attempt2Res.statusCode).toBe(201);
    const { markId } = attempt2Res.json<{ markId: string }>();

    const listRes = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/module-registrations/${moduleRegistrationId}/marks`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    const marks = listRes.json<Array<{ markId: string; rawMark: number; adjustedMark: number }>>();
    const resitMark = marks.find((m) => m.markId === markId);
    expect(resitMark).toBeDefined();
    expect(resitMark!.rawMark).toBe(75);
    expect(resitMark!.adjustedMark).toBe(40);

    await enableFlag('assessment.resit-cap.enabled', 'off');
  });

  it('when off (default), attempt-2 marks are NOT capped', async () => {
    const personId = await createStudent('ResitNoCap', 'Student');
    const enrolmentId = await createEnrolment(personId);
    const uid = Math.random().toString(36).slice(2, 8).toUpperCase();
    const { moduleRegistrationId, assessmentComponentId } = await setupRegistration(enrolmentId, {
      academicYear: '2026-27',
      moduleCode:   `RN${uid}`,
      creditValue:  20,
    });

    const attempt2Res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/module-registrations/${moduleRegistrationId}/marks`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { assessmentComponentId, rawMark: 75, attemptNumber: 2 },
    });
    expect(attempt2Res.statusCode).toBe(201);
    const { markId } = attempt2Res.json<{ markId: string }>();

    const listRes = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/module-registrations/${moduleRegistrationId}/marks`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    const marks = listRes.json<Array<{ markId: string; rawMark: number; adjustedMark: number }>>();
    const mark = marks.find((m) => m.markId === markId);
    expect(mark!.adjustedMark).toBe(75);
  });
});

// ── mark_calculation_evidence table ──────────────────────────────────────────

describe('mark_calculation_evidence', () => {
  it('is written for every ingested mark with correct raw mark, adjusted mark, and flag states', async () => {
    const personId = await createStudent('MarkEvidence', 'Basic');
    const enrolmentId = await createEnrolment(personId);
    const uid = Math.random().toString(36).slice(2, 8).toUpperCase();
    const { moduleRegistrationId, assessmentComponentId } = await setupRegistration(enrolmentId, {
      academicYear: '2026-27',
      moduleCode:   `ME${uid}`,
      creditValue:  20,
    });

    const markRes = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/module-registrations/${moduleRegistrationId}/marks`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { assessmentComponentId, rawMark: 65, attemptNumber: 1 },
    });
    expect(markRes.statusCode).toBe(201);
    const { markId } = markRes.json<{ markId: string }>();

    const rows = await ctx.db.execute(sql`
      SELECT raw_mark, adjusted_mark, late_penalty_enabled, resit_cap_applied, attempt_number
      FROM mark_calculation_evidence
      WHERE mark_id = ${markId}::uuid
        AND tenant_id = ${ctx.tenantId}::uuid
    `);
    const evidence = rows as unknown as Array<{
      raw_mark: string;
      adjusted_mark: string;
      late_penalty_enabled: boolean;
      resit_cap_applied: boolean;
      attempt_number: number;
    }>;
    expect(evidence.length).toBe(1);
    expect(Number(evidence[0]!.raw_mark)).toBe(65);
    expect(Number(evidence[0]!.adjusted_mark)).toBe(65);
    expect(evidence[0]!.late_penalty_enabled).toBe(true);
    expect(evidence[0]!.resit_cap_applied).toBe(false);
    expect(evidence[0]!.attempt_number).toBe(1);
  });

  it('records late penalty details when penalty is applied', async () => {
    await createAcademicRule('late-penalty-rate', 'default', { percentPerDay: 5 });

    const personId = await createStudent('MarkEvidence', 'Penalty');
    const enrolmentId = await createEnrolment(personId);
    const uid = Math.random().toString(36).slice(2, 8).toUpperCase();
    const { moduleRegistrationId, assessmentComponentId } = await setupRegistration(enrolmentId, {
      academicYear: '2026-27',
      moduleCode:   `MEP${uid}`,
      creditValue:  20,
    });

    const markRes = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/module-registrations/${moduleRegistrationId}/marks`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        assessmentComponentId,
        rawMark:       70,
        attemptNumber: 1,
        submittedAt:   '2026-11-05T12:00:00Z',
        dueAt:         '2026-11-01T12:00:00Z',  // 4 days late → 20 %
      },
    });
    expect(markRes.statusCode).toBe(201);
    const { markId } = markRes.json<{ markId: string }>();

    const rows = await ctx.db.execute(sql`
      SELECT raw_mark, adjusted_mark, late_penalty_percent, late_penalty_enabled
      FROM mark_calculation_evidence
      WHERE mark_id = ${markId}::uuid
        AND tenant_id = ${ctx.tenantId}::uuid
    `);
    const evidence = rows as unknown as Array<{
      raw_mark: string;
      adjusted_mark: string;
      late_penalty_percent: string | null;
      late_penalty_enabled: boolean;
    }>;
    expect(evidence.length).toBe(1);
    expect(Number(evidence[0]!.raw_mark)).toBe(70);
    expect(Number(evidence[0]!.adjusted_mark)).toBe(50);  // 70 − 20 = 50
    expect(Number(evidence[0]!.late_penalty_percent)).toBe(20);
    expect(evidence[0]!.late_penalty_enabled).toBe(true);
  });
});

// ── progression_calculation_evidence table ────────────────────────────────────

describe('progression_calculation_evidence', () => {
  it('is written for every progression decision', async () => {
    const personId = await createStudent('ProgEvidence', 'Student');
    const enrolmentId = await createEnrolment(personId, '2025-26');
    const uid = Math.random().toString(36).slice(2, 8).toUpperCase();
    const { moduleRegistrationId, assessmentComponentId } = await setupRegistration(enrolmentId, {
      academicYear: '2025-26',
      moduleCode:   `PE${uid}`,
      creditValue:  20,
    });

    await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/module-registrations/${moduleRegistrationId}/marks`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { assessmentComponentId, rawMark: 65, attemptNumber: 1 },
    });

    const progRes = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/enrolments/${enrolmentId}/progression`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { academicYear: '2025-26' },
    });
    expect(progRes.statusCode).toBe(201);
    const { progressionDecisionId } = progRes.json<{ progressionDecisionId: string }>();

    const rows = await ctx.db.execute(sql`
      SELECT decision_code, earned_credits, required_credits, academic_year
      FROM progression_calculation_evidence
      WHERE progression_decision_id = ${progressionDecisionId}::uuid
        AND tenant_id = ${ctx.tenantId}::uuid
    `);
    const evidence = rows as unknown as Array<{
      decision_code: string;
      earned_credits: string;
      required_credits: string;
      academic_year: string;
    }>;
    expect(evidence.length).toBe(1);
    expect(evidence[0]!.academic_year).toBe('2025-26');
    expect(['progress', 'resit', 'repeat-year']).toContain(evidence[0]!.decision_code);
    expect(Number(evidence[0]!.earned_credits)).toBeGreaterThanOrEqual(0);
  });
});

// ── award_calculation_evidence table ─────────────────────────────────────────

describe('award_calculation_evidence', () => {
  it('is written when an award is conferred', async () => {
    const personId = await createStudent('AwardEvidence', 'Graduate');
    const enrolmentId = await createEnrolment(personId, '2025-26');
    const uid = Math.random().toString(36).slice(2, 8).toUpperCase();

    // Seed a locked module result for this enrolment
    await seedRatifiedResult(enrolmentId, `AE${uid}`, 72, 20, '2025-26');

    // Get the calculated classification (requires exam-board:read → registry-admin has it)
    const classRes = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/enrolments/${enrolmentId}/classification`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(classRes.statusCode).toBe(200);
    const { classificationCode, aggregateMark } = classRes.json<{
      classificationCode: string;
      aggregateMark: number;
    }>();
    expect(aggregateMark).toBeCloseTo(72, 1);

    // Create a second ratified board (no period scope, so covers all registrations in the year)
    const boardRes = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/exam-boards',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { boardTypeCode: 'award', academicYear: '2025-26' },
    });
    expect(boardRes.statusCode).toBe(201);
    const { examBoardId } = boardRes.json<{ examBoardId: string }>();

    await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/exam-boards/${examBoardId}/external-examiner-signoff`,
      headers: { authorization: `Bearer ${chairJwt}` },
      payload: { commentary: 'Ready for award conferral' },
    });
    await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/exam-boards/${examBoardId}/ratification`,
      headers: { authorization: `Bearer ${chairJwt}` },
    });

    const awardRes = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/enrolments/${enrolmentId}/award`,
      headers: { authorization: `Bearer ${chairJwt}` },
      payload: {
        examBoardId,
        qualificationCode:  'BSc',
        classificationCode,
        awardDate:          '2026-07-15',
      },
    });
    expect(awardRes.statusCode).toBe(201);
    const { awardId } = awardRes.json<{ awardId: string }>();

    const rows = await ctx.db.execute(sql`
      SELECT algorithm, aggregate_mark, classification_code, boundaries_applied
      FROM award_calculation_evidence
      WHERE award_id = ${awardId}::uuid
        AND tenant_id = ${ctx.tenantId}::uuid
    `);
    const evidence = rows as unknown as Array<{
      algorithm: string;
      aggregate_mark: string;
      classification_code: string;
      boundaries_applied: unknown;
    }>;
    expect(evidence.length).toBe(1);
    expect(evidence[0]!.algorithm).toBe('weighted-average');
    expect(Number(evidence[0]!.aggregate_mark)).toBeCloseTo(72, 1);
    expect(evidence[0]!.classification_code).toBe(classificationCode);
    expect(Array.isArray(evidence[0]!.boundaries_applied)).toBe(true);
  });
});
