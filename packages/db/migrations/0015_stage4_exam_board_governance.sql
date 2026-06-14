-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0015 — Stage 4: Exam Board and Record Governance Refactor
--
-- Adds:
--   1. Three feature flags for board operating-model variants:
--        exam-board.virtual-board.enabled   — async/virtual board operation
--        exam-board.deferral.enabled        — board may be deferred to next cycle
--        exam-board.quorum.required         — minimum quorum must be recorded
--      Plus: the existing exam-board.external-examiner.required flag is now
--      actually checked in BoardService.ratifyBoard() (it was seeded in Stage 2
--      but not yet wired to the service guard).
--
--   2. exam-board-virtual workflow definition — asynchronous board workflow
--      suitable for institutions that conduct board business by correspondence
--      or distributed async review rather than a fixed physical meeting.
--
--   3. Four new nullable columns on exam_board to capture deferral state and
--      quorum evidence without a full bitemporal table:
--        deferred_at         — when the board was deferred
--        deferral_reason     — free-text or coded reason for deferral
--        quorum_count        — number of members recorded as attending / reviewing
--        quorum_recorded_at  — when the quorum count was recorded
--
-- What does NOT change:
--   - Service-level record-lock guards (ratifyBoard: marks, module results, and
--     progression decisions are locked in the same transaction) are unchanged.
--   - Ratification authority (exam-board:ratify → exam-board-chair role) is
--     unchanged in the permission model.
--   - Correction-case authority (separate correction role guards) is unchanged.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Section 1: Board governance feature flags ─────────────────────────────────

WITH stage4_flags AS (
  INSERT INTO "feature_flag" (
    "flag_key", "display_name", "description",
    "owner_module_code", "status_code", "value_type_code", "default_variant_key", "created_by"
  )
  VALUES
    ('exam-board.virtual-board.enabled',
     'Virtual exam board enabled',
     'When on, the exam board does not require a physical meeting date. '
     'Members and the chair review and approve asynchronously. '
     'The exam-board-virtual workflow definition is used instead of the standard one.',
     'governance', 'active', 'boolean', 'off', 'system'),

    ('exam-board.deferral.enabled',
     'Board deferral enabled',
     'When on, an exam board that has not yet been ratified may be deferred to the '
     'next governance cycle by a registry administrator. A deferred board cannot be '
     'ratified until it is explicitly re-opened.',
     'governance', 'active', 'boolean', 'off', 'system'),

    ('exam-board.quorum.required',
     'Board quorum required',
     'When on, a quorum count must be recorded on the exam board before ratification '
     'is permitted. The quorum threshold is defined in the exam-board-quorum-threshold '
     'academic rule (default 3). Enables institutions that have formal quorum '
     'requirements under their academic regulations.',
     'governance', 'active', 'boolean', 'off', 'system')

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
FROM stage4_flags f
JOIN (VALUES
  ('exam-board.virtual-board.enabled', 'off', 'Off', 'false', 10),
  ('exam-board.virtual-board.enabled', 'on',  'On',  'true',  20),
  ('exam-board.deferral.enabled',      'off', 'Off', 'false', 10),
  ('exam-board.deferral.enabled',      'on',  'On',  'true',  20),
  ('exam-board.quorum.required',       'off', 'Off', 'false', 10),
  ('exam-board.quorum.required',       'on',  'On',  'true',  20)
) AS v("flag_key", "variant_key", "display_name", "value", "sort_order")
  ON f."flag_key" = v."flag_key"
ON CONFLICT ("flag_id", "variant_key") DO UPDATE SET
  "display_name" = EXCLUDED."display_name",
  "value"        = EXCLUDED."value",
  "sort_order"   = EXCLUDED."sort_order";

-- ── Section 2: exam-board-virtual workflow definition ─────────────────────────
--
-- Asynchronous board workflow. No fixed meeting date is required. Members review
-- the data pack independently; the chair makes a ratification decision after all
-- required async sign-offs are received.
--
-- Step design:
--   board-constituted        → data-pack-distributed   → async-member-review
--   → async-chair-review     → external-examiner-async (optional via flagGuard)
--   → gateway-concerns       → [concerns-resolved] → record-locked → end

INSERT INTO "workflow_definition" (
  "definition_code", "display_name", "owner_module_code",
  "status_code", "current_version_number", "description", "created_by"
)
VALUES
  ('exam-board-virtual',
   'Exam Board — Virtual / Async Governance',
   'governance', 'active', 1,
   'Async board workflow for institutions where members review and approve '
   'independently without a fixed physical meeting. '
   'Suitable for distributed governance, small institutions, or correspondence boards.',
   'system')
ON CONFLICT (COALESCE("tenant_id", '00000000-0000-0000-0000-000000000000'::uuid), "definition_code")
DO UPDATE SET
  "display_name"           = EXCLUDED."display_name",
  "status_code"            = EXCLUDED."status_code",
  "current_version_number" = EXCLUDED."current_version_number",
  "description"            = EXCLUDED."description",
  "updated_at"             = now();

INSERT INTO "workflow_definition_version" (
  "workflow_definition_id", "version_number", "status_code",
  "definition_json", "bpmn_source_id", "effective_from", "created_by"
)
SELECT wd."id", 1, 'active',
  jsonb_build_object(
    'startEvent',         'exam-board.constitution-command',
    'flagSnapshot',       '["exam-board.virtual-board.enabled", "exam-board.external-examiner.required", "exam-board.quorum.required"]'::jsonb,
    'serviceInvariants',  '["BoardService.ratifyBoard: external-examiner signoff guard (flag controlled), quorum guard (flag controlled), record-lock writes"]'::jsonb,
    'escalationPolicy',   '{"defaultDeadlineDays": 14, "escalateToRole": "exam-board-chair"}'::jsonb,
    'terminalDataWrites', '["board ratified, module results and marks locked, progression decisions locked"]'::jsonb
  ),
  NULL,
  '2026-06-14T00:00:00Z'::timestamptz,
  'system'
FROM "workflow_definition" wd
WHERE wd."definition_code" = 'exam-board-virtual' AND wd."tenant_id" IS NULL
ON CONFLICT ("workflow_definition_id", "version_number") DO NOTHING;

-- Steps: exam-board-virtual
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('board-constituted',        'start',       'Board constituted',                                   NULL,                    10, '{}'),
  ('data-pack-distributed',    'human-task',  'Registry distributes data pack asynchronously',       'registry-administrator', 20, '{}'),
  ('async-member-review',      'human-task',  'Board members review data pack (async)',              'exam-board-member',      30, '{}'),
  ('async-chair-review',       'human-task',  'Chair reviews outcomes and draft decisions (async)',  'exam-board-chair',       40, '{}'),
  ('external-examiner-async',  'human-task',  'External examiner async sign-off',                   'external-examiner',      50, '{"flagGuard": "exam-board.external-examiner.required"}'),
  ('gateway-concerns',         'decision',    'External examiner concerns gateway',                  NULL,                    60, '{"gatewayKey": "G01"}'),
  ('concerns-resolved',        'human-task',  'Concerns resolved by chair (async)',                  'exam-board-chair',       70, '{}'),
  ('record-locked',            'integration', 'Records locked after async ratification',             NULL,                    80, '{"targetService": "BoardService.ratifyBoard"}'),
  ('end',                      'end',         'Virtual board governance complete',                   NULL,                    90, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'exam-board-virtual' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- Decision gateway for virtual board
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", 'G01', 'External examiner concerns raised?', 'exclusive', NULL,
  '{"policySource": "External examiner reporting requirements", "noConcernsOutcome": "record-locked", "concernsOutcome": "concerns-resolved"}'::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
WHERE wd."definition_code" = 'exam-board-virtual' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- Assignment rules for virtual board
INSERT INTO "workflow_assignment_rule" (
  "workflow_definition_version_id", "step_key", "rule_key",
  "priority", "assignee_role_code", "active", "configuration"
)
SELECT wdv."id", r."step_key", r."rule_key", r."priority"::integer, r."assignee_role_code", true, '{}'::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('data-pack-distributed',   'virtual.data-pack.registry-default',         100, 'registry-administrator'),
  ('async-member-review',     'virtual.member-review.member-default',        100, 'exam-board-member'),
  ('async-chair-review',      'virtual.chair-review.chair-default',          100, 'exam-board-chair'),
  ('external-examiner-async', 'virtual.external-examiner.examiner-default',  100, 'external-examiner'),
  ('concerns-resolved',       'virtual.concerns-resolved.chair-default',     100, 'exam-board-chair')
) AS r("step_key", "rule_key", "priority", "assignee_role_code") ON true
WHERE wd."definition_code" = 'exam-board-virtual' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT DO NOTHING;

-- ── Section 3: exam_board schema additions ────────────────────────────────────
--
-- All four columns are nullable. A NULL value for deferred_at means the board
-- is not deferred. A NULL value for quorum_count means quorum has not been
-- recorded (or is not required for this board).

ALTER TABLE "exam_board"
  ADD COLUMN IF NOT EXISTS "deferred_at"        timestamptz,
  ADD COLUMN IF NOT EXISTS "deferral_reason"     text,
  ADD COLUMN IF NOT EXISTS "quorum_count"        integer,
  ADD COLUMN IF NOT EXISTS "quorum_recorded_at"  timestamptz;

CREATE INDEX IF NOT EXISTS "exam_board_deferred_idx"
  ON "exam_board" ("tenant_id", "deferred_at")
  WHERE "deferred_at" IS NOT NULL;
