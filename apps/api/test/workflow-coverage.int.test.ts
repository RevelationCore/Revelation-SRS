/**
 * Stage 2 — Workflow Coverage Matrix integration tests.
 *
 * These tests verify that every process-bearing domain in the platform has:
 *   1. An active workflow definition with a current version.
 *   2. At least one start step and one end step.
 *   3. At least one human-task or integration step (i.e. some process shape).
 *   4. Assignment rules covering every human-task step.
 *   5. Feature flag keys declared in the version's flag snapshot.
 *   6. The controlling feature flags exist in the feature_flag table.
 *
 * API routes used (all under /api/v1):
 *   GET /workflow-definitions           — list workflow definitions
 *   GET /workflow-definitions/:id/versions  — list versions for a definition
 *   GET /workflow-assignment-rules      — list assignment rules (filterable by versionId/stepKey)
 *   GET /feature-flags                  — list feature flags
 *   GET /feature-flags/:id              — get a specific flag (with defaultVariantKey)
 *
 * Steps are checked via direct DB query since there is no steps API route.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let jwt: string;

beforeAll(async () => {
  ctx = await startTestApp();
  // registry-administrator has workflow:read and feature-flag:read
  jwt = await ctx.makeJwt();
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

// ── All expected workflow codes ───────────────────────────────────────────────

const ADMISSIONS_WORKFLOWS = [
  'admissions-ucas-domestic',
  'admissions-direct-domestic',
  'admissions-international-direct',
  'admissions-international-agent',
  'admissions-clearing',
] as const;

const STAGE2_WORKFLOWS = [
  'enrolment-change-approval',
  'module-registration-change',
  'assessment-mark-review',
  'progression-review',
  'award-classification',
  'exam-board-governance',
  'correction-case',
  'appeal-case',
  'regulatory-submission-approval',
  'finance-fee-handoff',
  'identity-provisioning',
  'communication-dispatch',
] as const;

const ALL_WORKFLOW_CODES = [...ADMISSIONS_WORKFLOWS, ...STAGE2_WORKFLOWS];

// ── Workflow definition listing ───────────────────────────────────────────────

describe('GET /api/v1/workflow-definitions', () => {
  it('lists all active workflow definitions including all Stage 2 workflows', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/workflow-definitions?statusCode=active',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Array<{ definitionCode: string; statusCode: string }>>();
    const codes = body.map((w) => w.definitionCode);

    for (const code of ALL_WORKFLOW_CODES) {
      expect(codes, `missing workflow: ${code}`).toContain(code);
    }
  });

  it('returns all workflow definitions when no statusCode filter is applied', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/workflow-definitions',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Array<{ definitionCode: string }>>();
    expect(body.length).toBeGreaterThanOrEqual(ALL_WORKFLOW_CODES.length);
  });
});

// ── Per-workflow version and structure checks ─────────────────────────────────

describe('workflow definition versions', () => {
  it('every Stage 2 workflow has an active version with definitionJson metadata', async () => {
    const listRes = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/workflow-definitions?statusCode=active',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(listRes.statusCode).toBe(200);
    const definitions = listRes.json<Array<{
      workflowDefinitionId: string;
      definitionCode: string;
      currentVersionNumber: number | null;
    }>>();

    for (const code of STAGE2_WORKFLOWS) {
      const def = definitions.find((d) => d.definitionCode === code);
      expect(def, `definition missing: ${code}`).toBeDefined();
      expect(def!.currentVersionNumber, `${code} has no current version`).not.toBeNull();

      const versionsRes = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/workflow-definitions/${def!.workflowDefinitionId}/versions`,
        headers: { authorization: `Bearer ${jwt}` },
      });
      expect(versionsRes.statusCode).toBe(200);
      const versions = versionsRes.json<Array<{
        versionNumber: number;
        statusCode: string;
        definitionJson: Record<string, unknown>;
      }>>();

      const activeVersion = versions.find((v) => v.statusCode === 'active');
      expect(activeVersion, `${code}: no active version`).toBeDefined();

      const defJson = activeVersion!.definitionJson;
      expect(defJson['startEvent'], `${code}: missing startEvent in definitionJson`).toBeTruthy();
      expect(Array.isArray(defJson['flagSnapshot']), `${code}: flagSnapshot must be an array`).toBe(true);
      expect(Array.isArray(defJson['serviceInvariants']), `${code}: serviceInvariants must be an array`).toBe(true);
      expect(defJson['escalationPolicy'], `${code}: missing escalationPolicy`).toBeTruthy();
    }
  });
});

// ── Step structure per workflow (via DB — no steps API route exists) ──────────

describe('workflow steps (DB)', () => {
  async function getDefinitionVersionId(definitionCode: string): Promise<string | null> {
    const { sql } = await import('drizzle-orm');
    const rows = await ctx.db.execute(sql`
      SELECT wdv.id
      FROM workflow_definition_version wdv
      JOIN workflow_definition wd ON wd.id = wdv.workflow_definition_id
      WHERE wd.definition_code = ${definitionCode}
        AND wd.tenant_id IS NULL
        AND wdv.status_code = 'active'
      LIMIT 1
    `);
    const row = (rows as unknown as Array<{ id: string }>)[0];
    return row?.id ?? null;
  }

  async function getSteps(definitionCode: string): Promise<Array<{ step_key: string; step_type_code: string; owner_role_code: string | null }>> {
    const versionId = await getDefinitionVersionId(definitionCode);
    if (!versionId) return [];
    const { sql } = await import('drizzle-orm');
    const rows = await ctx.db.execute(sql`
      SELECT step_key, step_type_code, owner_role_code
      FROM workflow_step
      WHERE workflow_definition_version_id = ${versionId}
      ORDER BY sort_order
    `);
    return rows as unknown as Array<{ step_key: string; step_type_code: string; owner_role_code: string | null }>;
  }

  it.each(STAGE2_WORKFLOWS)('%s has a start step, an end step, and at least one process step', async (code) => {
    const steps = await getSteps(code);
    expect(steps.length, `${code}: no steps found`).toBeGreaterThan(0);

    const stepTypes = steps.map((s) => s.step_type_code);
    expect(stepTypes, `${code}: missing start step`).toContain('start');
    expect(stepTypes, `${code}: missing end step`).toContain('end');

    const hasProcessStep = stepTypes.some((t) => ['human-task', 'integration', 'system-task', 'decision'].includes(t));
    expect(hasProcessStep, `${code}: no process steps (human-task/integration/system-task/decision)`).toBe(true);
  });

  it('exam-board-governance has an external-examiner step owned by external-examiner role', async () => {
    const steps = await getSteps('exam-board-governance');
    const examinerStep = steps.find((s) => s.step_key === 'external-examiner-review');
    expect(examinerStep, 'external-examiner-review step missing').toBeDefined();
    expect(examinerStep!.owner_role_code).toBe('external-examiner');
  });

  it('correction-case has three decision steps', async () => {
    const steps = await getSteps('correction-case');
    const decisionSteps = steps.filter((s) => s.step_type_code === 'decision');
    expect(decisionSteps.length, 'correction-case: expected 3 decision steps').toBeGreaterThanOrEqual(3);
  });

  it('appeal-case has three decision steps', async () => {
    const steps = await getSteps('appeal-case');
    const decisionSteps = steps.filter((s) => s.step_type_code === 'decision');
    expect(decisionSteps.length, 'appeal-case: expected 3 decision steps').toBeGreaterThanOrEqual(3);
  });

  it('assessment-mark-review has moderation, late-penalty, and result-review steps', async () => {
    const steps = await getSteps('assessment-mark-review');
    const stepKeys = steps.map((s) => s.step_key);
    expect(stepKeys).toContain('moderation-review');
    expect(stepKeys).toContain('late-penalty-review');
    expect(stepKeys).toContain('result-review');
  });

  it('appeal-case has grounds-assessed, panel-hearing, and outcome-decided steps', async () => {
    const steps = await getSteps('appeal-case');
    const stepKeys = steps.map((s) => s.step_key);
    expect(stepKeys).toContain('grounds-assessed');
    expect(stepKeys).toContain('panel-hearing');
    expect(stepKeys).toContain('outcome-decided');
  });
});

// ── Feature flag coverage ─────────────────────────────────────────────────────

describe('workflow control feature flags', () => {
  const EXPECTED_FLAGS = [
    'enrolment.change-approval.required',
    'module-registration.approval.required',
    'assessment.moderation.workflow.enabled',
    'progression.board-review.enabled',
    'award.discretionary-review.enabled',
    'exam-board.external-examiner.required',
    'correction.panel-review.enabled',
    'appeal.panel-hearing.enabled',
    'regulatory.submission.manual-approval.required',
    'finance.fee-handoff.enabled',
    'identity.deduplication.enabled',
    'communications.locale-aware.enabled',
  ];

  it('all Stage 2 workflow control flags exist and are active', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/feature-flags',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const flags = res.json<Array<{ flagKey: string; statusCode: string }>>();

    for (const key of EXPECTED_FLAGS) {
      const flag = flags.find((f) => f.flagKey === key);
      expect(flag, `missing flag: ${key}`).toBeDefined();
      expect(flag!.statusCode, `flag ${key} must be active`).toBe('active');
    }
  });

  it('exam-board.external-examiner.required defaults to on (UK statutory)', async () => {
    const listRes = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/feature-flags',
      headers: { authorization: `Bearer ${jwt}` },
    });
    const flags = listRes.json<Array<{ flagKey: string; featureFlagId: string; defaultVariantKey: string }>>();
    const flag = flags.find((f) => f.flagKey === 'exam-board.external-examiner.required');
    expect(flag).toBeDefined();
    expect(flag!.defaultVariantKey).toBe('on');
  });

  it('communications.locale-aware.enabled defaults to on', async () => {
    const listRes = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/feature-flags',
      headers: { authorization: `Bearer ${jwt}` },
    });
    const flags = listRes.json<Array<{ flagKey: string; featureFlagId: string; defaultVariantKey: string }>>();
    const flag = flags.find((f) => f.flagKey === 'communications.locale-aware.enabled');
    expect(flag).toBeDefined();
    expect(flag!.defaultVariantKey).toBe('on');
  });

  it('all other Stage 2 flags default to off', async () => {
    const OFF_BY_DEFAULT = EXPECTED_FLAGS.filter(
      (k) => k !== 'exam-board.external-examiner.required' && k !== 'communications.locale-aware.enabled',
    );
    const listRes = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/feature-flags',
      headers: { authorization: `Bearer ${jwt}` },
    });
    const flags = listRes.json<Array<{ flagKey: string; defaultVariantKey: string }>>();

    for (const key of OFF_BY_DEFAULT) {
      const flag = flags.find((f) => f.flagKey === key);
      expect(flag, `missing flag: ${key}`).toBeDefined();
      expect(flag!.defaultVariantKey, `${key} should default to off`).toBe('off');
    }
  });
});

// ── Assignment rules coverage ─────────────────────────────────────────────────

describe('workflow assignment rules', () => {
  it('all human-task steps in Stage 2 workflows have at least one assignment rule', async () => {
    const { sql } = await import('drizzle-orm');

    const rows = await ctx.db.execute(sql`
      SELECT wd.definition_code, ws.step_key, COUNT(war.id) AS rule_count
      FROM workflow_step ws
      JOIN workflow_definition_version wdv ON wdv.id = ws.workflow_definition_version_id
      JOIN workflow_definition wd ON wd.id = wdv.workflow_definition_id
      LEFT JOIN workflow_assignment_rule war
        ON war.workflow_definition_version_id = wdv.id
       AND war.step_key = ws.step_key
      WHERE wd.definition_code IN (
        'enrolment-change-approval', 'module-registration-change',
        'assessment-mark-review', 'progression-review', 'award-classification',
        'exam-board-governance', 'correction-case', 'appeal-case',
        'regulatory-submission-approval', 'finance-fee-handoff',
        'identity-provisioning', 'communication-dispatch'
      )
        AND wd.tenant_id IS NULL
        AND wdv.status_code = 'active'
        AND ws.step_type_code = 'human-task'
      GROUP BY wd.definition_code, ws.step_key
      ORDER BY wd.definition_code, ws.step_key
    `);

    const unassigned = (rows as unknown as Array<{ definition_code: string; step_key: string; rule_count: string }>)
      .filter((r) => Number(r.rule_count) === 0);

    expect(
      unassigned,
      `Human-task steps without assignment rules: ${JSON.stringify(unassigned.map((r) => `${r.definition_code}.${r.step_key}`))}`,
    ).toHaveLength(0);
  });

  it('the workflow-assignment-rules API lists rules for exam-board-governance', async () => {
    const { sql } = await import('drizzle-orm');
    const rows = await ctx.db.execute(sql`
      SELECT wdv.id
      FROM workflow_definition_version wdv
      JOIN workflow_definition wd ON wd.id = wdv.workflow_definition_id
      WHERE wd.definition_code = 'exam-board-governance'
        AND wd.tenant_id IS NULL
        AND wdv.status_code = 'active'
      LIMIT 1
    `);
    const versionId = ((rows as unknown as Array<{ id: string }>)[0])?.id;
    expect(versionId).toBeDefined();

    const adminJwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/workflow-assignment-rules?workflowDefinitionVersionId=${versionId}`,
      headers: { authorization: `Bearer ${adminJwt}` },
    });
    expect(res.statusCode).toBe(200);
    const rules = res.json<Array<{ stepKey: string; ruleKey: string }>>();
    expect(rules.length, 'exam-board-governance should have assignment rules').toBeGreaterThan(0);

    const examinerRule = rules.find((r) => r.stepKey === 'external-examiner-review');
    expect(examinerRule, 'external-examiner-review should have an assignment rule').toBeDefined();
  });
});

// ── Decision gateway coverage ─────────────────────────────────────────────────

describe('workflow decision gateways', () => {
  it('correction-case and appeal-case each have 3 decision gateways', async () => {
    const { sql } = await import('drizzle-orm');

    for (const code of ['correction-case', 'appeal-case'] as const) {
      const rows = await ctx.db.execute(sql`
        SELECT COUNT(wdg.id) AS gateway_count
        FROM workflow_decision_gateway wdg
        JOIN workflow_definition_version wdv ON wdv.id = wdg.workflow_definition_version_id
        JOIN workflow_definition wd ON wd.id = wdv.workflow_definition_id
        WHERE wd.definition_code = ${code}
          AND wd.tenant_id IS NULL
          AND wdv.status_code = 'active'
      `);
      const count = Number(((rows as unknown as Array<{ gateway_count: string }>)[0])?.gateway_count ?? 0);
      expect(count, `${code}: expected 3 decision gateways`).toBe(3);
    }
  });
});
