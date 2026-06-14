-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0014 — Stage 3: Assessment, Grade, and Progression Refactor
--
-- Adds:
--   1. Feature flags for assessment policy variants (late-penalty, resit-cap)
--      and board operating-model selection.
--   2. Two additional exam-board workflow definitions for school-led and
--      departmental-staged board governance models (large-institution variants).
--   3. Three append-only calculation evidence tables that satisfy the Stage 3
--      exit criterion: grade and progression calculations are reproducible from
--      rules, workflow decision evidence, and source marks.
--
-- What does NOT change in this migration:
--   - No existing service behaviour is altered by the migration alone; the new
--     flags default to backward-compatible values (late-penalty on, resit-cap
--     off) so existing tenants are unaffected until they opt in.
--   - Hard service guards (locked-record, valid-mark-range, ratification
--     authority) remain enforced in code and are unchanged.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Section 1: Assessment policy and board operating-model feature flags ──────

WITH stage3_flags AS (
  INSERT INTO "feature_flag" (
    "flag_key", "display_name", "description",
    "owner_module_code", "status_code", "value_type_code", "default_variant_key", "created_by"
  )
  VALUES
    ('assessment.late-penalty.enabled',
     'Late submission penalty enabled',
     'When off, late penalty calculation is suppressed for all mark ingestion in the tenant, '
     'regardless of due-date information submitted with the mark. '
     'Useful for institutions using external penalty management or mitigating-circumstances-first policies.',
     'assessment', 'active', 'boolean', 'on', 'system'),

    ('assessment.resit-cap.enabled',
     'Resit mark cap enabled',
     'When on, marks for attempt number 2 or higher are capped at the value configured in the '
     'resit-mark-cap academic rule (default 40 — the standard UK HE resit pass mark cap). '
     'The cap is applied after late penalty calculation.',
     'assessment', 'active', 'boolean', 'off', 'system'),

    ('exam-board.operating-model',
     'Exam board operating model',
     'Selects the workflow definition used for exam board governance. '
     'registry-led uses the standard exam-board-governance workflow seeded in Stage 2. '
     'school-led uses a school-initiated model where departmental chair prepares and school '
     'director ratifies before registry finalises. '
     'departmental-staged uses a three-stage model: department → school → registry for '
     'large multi-faculty institutions.',
     'governance', 'active', 'selection', 'registry-led', 'system')

  ON CONFLICT ("flag_key") DO UPDATE SET
    "display_name"        = EXCLUDED."display_name",
    "description"         = EXCLUDED."description",
    "owner_module_code"   = EXCLUDED."owner_module_code",
    "status_code"         = EXCLUDED."status_code",
    "value_type_code"     = EXCLUDED."value_type_code",
    "default_variant_key" = EXCLUDED."default_variant_key",
    "updated_at"          = now()
  RETURNING "id", "flag_key"
)
INSERT INTO "feature_flag_variant" ("flag_id", "variant_key", "display_name", "value", "sort_order")
SELECT f."id", v."variant_key", v."display_name", v."value"::jsonb, v."sort_order"
FROM stage3_flags f
JOIN (VALUES
  -- assessment.late-penalty.enabled (boolean)
  ('assessment.late-penalty.enabled', 'off', 'Off', 'false', 10),
  ('assessment.late-penalty.enabled', 'on',  'On',  'true',  20),
  -- assessment.resit-cap.enabled (boolean)
  ('assessment.resit-cap.enabled',    'off', 'Off', 'false', 10),
  ('assessment.resit-cap.enabled',    'on',  'On',  'true',  20),
  -- exam-board.operating-model (selection)
  ('exam-board.operating-model', 'registry-led',        'Registry-Led',        '"registry-led"',        10),
  ('exam-board.operating-model', 'school-led',          'School-Led',          '"school-led"',          20),
  ('exam-board.operating-model', 'departmental-staged', 'Departmental-Staged', '"departmental-staged"', 30)
) AS v("flag_key", "variant_key", "display_name", "value", "sort_order")
  ON f."flag_key" = v."flag_key"
ON CONFLICT ("flag_id", "variant_key") DO UPDATE SET
  "display_name" = EXCLUDED."display_name",
  "value"        = EXCLUDED."value",
  "sort_order"   = EXCLUDED."sort_order";

-- ── Section 2: Board operating-model workflow definitions ─────────────────────

-- exam-board-school-led: School-initiated model
--   Department chair prepares data pack → School director reviews and approves
--   → External examiner reviews → Registry finalises and locks.
--   Appropriate for faculty-led universities where the school owns the board.

INSERT INTO "workflow_definition" (
  "definition_code", "display_name", "owner_module_code",
  "status_code", "current_version_number", "description", "created_by"
)
VALUES
  ('exam-board-school-led',
   'Exam Board — School-Led Governance',
   'governance', 'active', 1,
   'School-initiated exam board workflow. Department chair prepares the data pack; '
   'school director approves before external examiner review and registry finalisation.',
   'system'),

  ('exam-board-departmental-staged',
   'Exam Board — Departmental Staged Governance',
   'governance', 'active', 1,
   'Large-institution three-stage board workflow: departmental committee sign-off, '
   'school executive approval, external examiner review, and central registry lock.',
   'system')
ON CONFLICT (COALESCE("tenant_id", '00000000-0000-0000-0000-000000000000'::uuid), "definition_code")
DO UPDATE SET
  "display_name"           = EXCLUDED."display_name",
  "status_code"            = EXCLUDED."status_code",
  "current_version_number" = EXCLUDED."current_version_number",
  "description"            = EXCLUDED."description",
  "updated_at"             = now();

-- Definition versions
INSERT INTO "workflow_definition_version" (
  "workflow_definition_id", "version_number", "status_code",
  "definition_json", "bpmn_source_id", "effective_from", "created_by"
)
SELECT wd."id", 1, 'active',
  jsonb_build_object(
    'startEvent',         v."start_event",
    'flagSnapshot',       v."flag_snapshot"::jsonb,
    'serviceInvariants',  v."service_invariants"::jsonb,
    'escalationPolicy',   v."escalation_policy"::jsonb,
    'terminalDataWrites', v."terminal_data_writes"::jsonb
  ),
  NULL,
  '2026-06-14T00:00:00Z'::timestamptz,
  'system'
FROM "workflow_definition" wd
JOIN (VALUES
  ('exam-board-school-led',
   'exam-board.constitution-command',
   '["exam-board.external-examiner.required", "exam-board.operating-model"]',
   '["BoardService.ratifyBoard: external-examiner signoff guard, record-lock writes for marks/results/progressions"]',
   '{"defaultDeadlineDays": 21, "escalateToRole": "exam-board-chair"}',
   '["board ratified, module results and marks locked, progression decisions locked"]'),

  ('exam-board-departmental-staged',
   'exam-board.constitution-command',
   '["exam-board.external-examiner.required", "exam-board.operating-model"]',
   '["BoardService.ratifyBoard: external-examiner signoff guard, record-lock writes for marks/results/progressions"]',
   '{"defaultDeadlineDays": 28, "escalateToRole": "exam-board-chair"}',
   '["board ratified, module results and marks locked, progression decisions locked"]')
) AS v("definition_code", "start_event", "flag_snapshot", "service_invariants", "escalation_policy", "terminal_data_writes")
  ON wd."definition_code" = v."definition_code"
WHERE wd."tenant_id" IS NULL
ON CONFLICT ("workflow_definition_id", "version_number") DO NOTHING;

-- Steps: exam-board-school-led
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('board-constituted',          'start',       'Board constituted',                               NULL,                     10, '{}'),
  ('data-pack-prepared',         'human-task',  'Department chair prepares data pack',             'department-chair',        20, '{}'),
  ('school-director-review',     'human-task',  'School director approves board pack',             'school-director',         30, '{}'),
  ('external-examiner-review',   'human-task',  'External examiner review',                        'external-examiner',       40, '{"flagGuard": "exam-board.external-examiner.required"}'),
  ('gateway-concerns',           'decision',    'External examiner concerns gateway',              NULL,                     50, '{"gatewayKey": "G01"}'),
  ('concerns-resolved',          'human-task',  'External examiner concerns resolved',             'school-director',         60, '{}'),
  ('registry-finalisation',      'human-task',  'Registry finalisation and lock',                  'registry-administrator',  70, '{}'),
  ('record-locked',              'integration', 'Records locked after finalisation',               NULL,                     80, '{"targetService": "BoardService.ratifyBoard"}'),
  ('end',                        'end',         'School-led board governance complete',            NULL,                     90, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'exam-board-school-led' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- Steps: exam-board-departmental-staged
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('board-constituted',            'start',       'Board constituted',                               NULL,                     10, '{}'),
  ('departmental-committee-review','human-task',  'Departmental committee sign-off',                 'department-chair',        20, '{}'),
  ('school-executive-approval',    'human-task',  'School executive approval',                       'school-director',         30, '{}'),
  ('external-examiner-review',     'human-task',  'External examiner review',                        'external-examiner',       40, '{"flagGuard": "exam-board.external-examiner.required"}'),
  ('gateway-concerns',             'decision',    'External examiner concerns gateway',              NULL,                     50, '{"gatewayKey": "G01"}'),
  ('concerns-resolved',            'human-task',  'External examiner concerns resolved',             'exam-board-chair',        60, '{}'),
  ('central-registry-lock',        'human-task',  'Central registry lock and confirmation',          'registry-administrator',  70, '{}'),
  ('record-locked',                'integration', 'Records locked after central registry sign-off',  NULL,                     80, '{"targetService": "BoardService.ratifyBoard"}'),
  ('end',                          'end',         'Departmental-staged board governance complete',   NULL,                     90, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'exam-board-departmental-staged' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- Decision gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", 'G01', 'External examiner concerns raised?', 'exclusive', NULL,
  '{"policySource": "External examiner reporting requirements", "noConcernsOutcome": "registry-finalisation", "concernsOutcome": "concerns-resolved"}'::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
WHERE wd."definition_code" = 'exam-board-school-led' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", 'G01', 'External examiner concerns raised?', 'exclusive', NULL,
  '{"policySource": "External examiner reporting requirements", "noConcernsOutcome": "central-registry-lock", "concernsOutcome": "concerns-resolved"}'::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
WHERE wd."definition_code" = 'exam-board-departmental-staged' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- Assignment rules
INSERT INTO "workflow_assignment_rule" (
  "workflow_definition_version_id", "step_key", "rule_key",
  "priority", "assignee_role_code", "active", "configuration"
)
SELECT wdv."id", r."step_key", r."rule_key", r."priority"::integer, r."assignee_role_code", true, '{}'::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  -- exam-board-school-led
  ('exam-board-school-led', 'data-pack-prepared',       'school-led.data-pack-prepared.dept-chair-default',   100, 'department-chair'),
  ('exam-board-school-led', 'school-director-review',   'school-led.school-director-review.director-default',  100, 'school-director'),
  ('exam-board-school-led', 'external-examiner-review', 'school-led.external-examiner-review.examiner-default',100, 'external-examiner'),
  ('exam-board-school-led', 'concerns-resolved',        'school-led.concerns-resolved.director-default',       100, 'school-director'),
  ('exam-board-school-led', 'registry-finalisation',    'school-led.registry-finalisation.registry-default',   100, 'registry-administrator'),
  -- exam-board-departmental-staged
  ('exam-board-departmental-staged', 'departmental-committee-review','dept-staged.dept-committee.chair-default',        100, 'department-chair'),
  ('exam-board-departmental-staged', 'school-executive-approval',    'dept-staged.school-exec.director-default',        100, 'school-director'),
  ('exam-board-departmental-staged', 'external-examiner-review',     'dept-staged.external-examiner.examiner-default',  100, 'external-examiner'),
  ('exam-board-departmental-staged', 'concerns-resolved',            'dept-staged.concerns-resolved.chair-default',     100, 'exam-board-chair'),
  ('exam-board-departmental-staged', 'central-registry-lock',        'dept-staged.registry-lock.registry-default',      100, 'registry-administrator')
) AS r("definition_code", "step_key", "rule_key", "priority", "assignee_role_code")
  ON wd."definition_code" = r."definition_code"
WHERE wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT DO NOTHING;

-- ── Section 3: Calculation evidence tables ────────────────────────────────────
--
-- These tables are append-only audit records.  No bitemporal columns — each row
-- is a snapshot of what was calculated, when, and with which rule values.
-- They satisfy the Stage 3 exit criterion:
--   "Grade and progression calculations are reproducible from rules,
--    workflow decision evidence, and source marks."

CREATE TABLE IF NOT EXISTS "mark_calculation_evidence" (
  "id"                       uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                uuid         NOT NULL,
  "mark_id"                  uuid         NOT NULL,
  "attempt_number"           integer      NOT NULL,
  "raw_mark"                 numeric(6,2) NOT NULL,
  "late_penalty_enabled"     boolean      NOT NULL DEFAULT false,
  "late_penalty_percent"     numeric(6,2),
  "late_penalty_cap_applied" boolean      NOT NULL DEFAULT false,
  "late_penalty_cap_percent" numeric(6,2),
  "resit_cap_applied"        boolean      NOT NULL DEFAULT false,
  "resit_cap_mark"           numeric(6,2),
  "adjusted_mark"            numeric(6,2) NOT NULL,
  "rule_snapshot"            jsonb        NOT NULL DEFAULT '{}',
  "calculated_at"            timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "mark_calc_evidence_mark_idx"
  ON "mark_calculation_evidence" ("mark_id");

CREATE INDEX IF NOT EXISTS "mark_calc_evidence_tenant_idx"
  ON "mark_calculation_evidence" ("tenant_id", "calculated_at" DESC);

CREATE TABLE IF NOT EXISTS "progression_calculation_evidence" (
  "id"                           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                    uuid         NOT NULL,
  "progression_decision_id"      uuid         NOT NULL,
  "academic_year"                text         NOT NULL,
  "required_credits"             numeric      NOT NULL,
  "compensation_threshold"       numeric,
  "compensation_credit_limit"    numeric      NOT NULL,
  "condonement_threshold"        numeric,
  "earned_credits"               numeric      NOT NULL,
  "compensation_credits"         numeric      NOT NULL,
  "unresolved_credits"           numeric      NOT NULL,
  "decision_code"                text         NOT NULL,
  "rule_snapshot"                jsonb        NOT NULL DEFAULT '{}',
  "calculated_at"                timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "prog_calc_evidence_decision_idx"
  ON "progression_calculation_evidence" ("progression_decision_id");

CREATE INDEX IF NOT EXISTS "prog_calc_evidence_tenant_idx"
  ON "progression_calculation_evidence" ("tenant_id", "calculated_at" DESC);

CREATE TABLE IF NOT EXISTS "award_calculation_evidence" (
  "id"                    uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid         NOT NULL,
  "award_id"              uuid         NOT NULL,
  "algorithm"             text         NOT NULL,
  "aggregate_mark"        numeric(6,2) NOT NULL,
  "classification_code"   text         NOT NULL,
  "boundaries_applied"    jsonb        NOT NULL DEFAULT '[]',
  "outcome_count"         integer      NOT NULL,
  "total_credit_value"    numeric      NOT NULL,
  "rule_snapshot"         jsonb        NOT NULL DEFAULT '{}',
  "calculated_at"         timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "award_calc_evidence_award_idx"
  ON "award_calculation_evidence" ("award_id");

CREATE INDEX IF NOT EXISTS "award_calc_evidence_tenant_idx"
  ON "award_calculation_evidence" ("tenant_id", "calculated_at" DESC);
