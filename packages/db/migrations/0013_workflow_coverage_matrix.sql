-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0013 — Stage 2: Workflow Coverage Matrix
--
-- Adds workflow definitions, versions, steps, decision gateways, and assignment
-- rules for every process-bearing domain not already covered by migration 0009.
-- Also seeds feature flags that govern workflow variant selection per domain.
--
-- Domains covered here (admissions workflows already seeded in 0009):
--   enrolment-change-approval       module-registration-change
--   assessment-mark-review          progression-review
--   award-classification            exam-board-governance
--   correction-case                 appeal-case
--   regulatory-submission-approval  finance-fee-handoff
--   identity-provisioning           communication-dispatch
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Section 1: Workflow Control Feature Flags ─────────────────────────────────

WITH coverage_flags AS (
  INSERT INTO "feature_flag" (
    "flag_key", "display_name", "description",
    "owner_module_code", "status_code", "value_type_code", "default_variant_key", "created_by"
  )
  VALUES
    ('enrolment.change-approval.required',
     'Enrolment change requires approval',
     'When on, enrolment status changes must be approved through the enrolment-change-approval workflow before taking effect.',
     'enrolment', 'active', 'boolean', 'off', 'system'),

    ('module-registration.approval.required',
     'Module registration change requires approval',
     'When on, add/drop/complete registration requests are routed through the module-registration-change approval workflow.',
     'module-registration', 'active', 'boolean', 'off', 'system'),

    ('assessment.moderation.workflow.enabled',
     'Assessment mark moderation uses workflow',
     'When on, marks ingested during a controlled period are routed through the assessment-mark-review workflow for moderation and review.',
     'assessment', 'active', 'boolean', 'off', 'system'),

    ('progression.board-review.enabled',
     'Progression review uses board workflow',
     'When on, discretionary progression decisions are routed through the progression-review board workflow.',
     'progression', 'active', 'boolean', 'off', 'system'),

    ('award.discretionary-review.enabled',
     'Award classification allows discretionary review',
     'When on, classification results in the borderline or exceptional range are routed through the award-classification discretionary review step.',
     'progression', 'active', 'boolean', 'off', 'system'),

    ('exam-board.external-examiner.required',
     'Exam board requires external examiner sign-off',
     'When on, the exam-board-governance workflow requires the external-examiner-review step before chair ratification.',
     'governance', 'active', 'boolean', 'on', 'system'),

    ('correction.panel-review.enabled',
     'Correction cases may require panel review',
     'When on, the correction-case workflow may route eligible cases to a review panel before outcome is decided.',
     'governance', 'active', 'boolean', 'off', 'system'),

    ('appeal.panel-hearing.enabled',
     'Appeals may require a panel hearing',
     'When on, the appeal-case workflow may route admissible appeals to a panel hearing before outcome is decided.',
     'governance', 'active', 'boolean', 'off', 'system'),

    ('regulatory.submission.manual-approval.required',
     'Regulatory submissions require manual approval',
     'When on, regulatory data submissions require an explicit approval step in the regulatory-submission-approval workflow before dispatch.',
     'regulatory', 'active', 'boolean', 'off', 'system'),

    ('finance.fee-handoff.enabled',
     'Finance fee handoff workflow enabled',
     'When on, fee liability events are routed through the finance-fee-handoff workflow for invoicing and external system notification.',
     'finance', 'active', 'boolean', 'off', 'system'),

    ('identity.deduplication.enabled',
     'Identity provisioning uses deduplication check',
     'When on, new person records are subject to a deduplication check and optional merge-review step in the identity-provisioning workflow.',
     'identity', 'active', 'boolean', 'off', 'system'),

    ('communications.locale-aware.enabled',
     'Communications use locale-aware dispatch',
     'When on, communication dispatch resolves locale and selects templates through the communication-dispatch workflow.',
     'communications', 'active', 'boolean', 'on', 'system')
  ON CONFLICT ("flag_key") DO UPDATE SET
    "display_name"       = EXCLUDED."display_name",
    "description"        = EXCLUDED."description",
    "owner_module_code"  = EXCLUDED."owner_module_code",
    "status_code"        = EXCLUDED."status_code",
    "value_type_code"    = EXCLUDED."value_type_code",
    "default_variant_key"= EXCLUDED."default_variant_key",
    "updated_at"         = now()
  RETURNING "id"
)
INSERT INTO "feature_flag_variant" ("flag_id", "variant_key", "display_name", "value", "sort_order")
SELECT f."id", v."variant_key", v."display_name", v."value"::jsonb, v."sort_order"
FROM coverage_flags f
JOIN (VALUES
  ('off', 'Off', 'false', 10),
  ('on',  'On',  'true',  20)
) AS v("variant_key", "display_name", "value", "sort_order") ON true
ON CONFLICT ("flag_id", "variant_key") DO UPDATE SET
  "display_name" = EXCLUDED."display_name",
  "value"        = EXCLUDED."value",
  "sort_order"   = EXCLUDED."sort_order";

-- ── Section 2: Workflow Definitions ──────────────────────────────────────────

INSERT INTO "workflow_definition" (
  "definition_code", "display_name", "owner_module_code",
  "status_code", "current_version_number", "description", "created_by"
)
VALUES
  ('enrolment-change-approval',
   'Enrolment Change Approval',
   'enrolment', 'active', 1,
   'Registry or school-led approval for enrolment status changes such as withdrawal, intermission, and reinstatement.',
   'system'),

  ('module-registration-change',
   'Module Registration Change',
   'module-registration', 'active', 1,
   'Add/drop/complete workflow covering registration window checks, prerequisite checks, capacity, and optional approval.',
   'system'),

  ('assessment-mark-review',
   'Assessment Mark Review',
   'assessment', 'active', 1,
   'Structured review of marks ingested during a controlled period: moderation, late-penalty decisions, result review, and approval before board.',
   'system'),

  ('progression-review',
   'Progression Review',
   'progression', 'active', 1,
   'Algorithm-driven progression decision with optional board review and discretionary decision gateway for boundary and exceptional cases.',
   'system'),

  ('award-classification',
   'Award Classification',
   'progression', 'active', 1,
   'Classification calculation, optional discretionary review, award approval, and graduation trigger for eligible students.',
   'system'),

  ('exam-board-governance',
   'Exam Board Governance',
   'governance', 'active', 1,
   'Board constitution, data-pack preparation, external examiner review, chair ratification, and non-bypassable record lock.',
   'system'),

  ('correction-case',
   'Correction Case',
   'governance', 'active', 1,
   'Academic correction case: eligibility assessment, evidence gathering, optional panel review, outcome decision, and locked-record amendment.',
   'system'),

  ('appeal-case',
   'Academic Appeal Case',
   'governance', 'active', 1,
   'Academic appeal processing: grounds assessment, evidence gathering, optional panel hearing, outcome decision, and optional amendment.',
   'system'),

  ('regulatory-submission-approval',
   'Regulatory Submission Approval',
   'regulatory', 'active', 1,
   'Environment-safe regulatory data submission: validation, optional manual approval, dispatch, and response processing.',
   'system'),

  ('finance-fee-handoff',
   'Finance Fee Handoff',
   'finance', 'active', 1,
   'Fee liability event processing: fee calculation, invoice generation, payment confirmation, and optional external finance system notification.',
   'system'),

  ('identity-provisioning',
   'Identity Provisioning',
   'identity', 'active', 1,
   'New person identity creation with deduplication check and optional merge-review step before confirmation.',
   'system'),

  ('communication-dispatch',
   'Communication Dispatch',
   'communications', 'active', 1,
   'Locale-aware communication dispatch: template selection, locale resolution, channel selection, message dispatch, and optional delivery confirmation.',
   'system')
ON CONFLICT (COALESCE("tenant_id", '00000000-0000-0000-0000-000000000000'::uuid), "definition_code")
DO UPDATE SET
  "display_name"            = EXCLUDED."display_name",
  "status_code"             = EXCLUDED."status_code",
  "current_version_number"  = EXCLUDED."current_version_number",
  "description"             = EXCLUDED."description",
  "updated_at"              = now();

-- ── Section 3: Workflow Definition Versions ───────────────────────────────────

INSERT INTO "workflow_definition_version" (
  "workflow_definition_id", "version_number", "status_code",
  "definition_json", "bpmn_source_id", "effective_from", "created_by"
)
SELECT
  wd."id",
  1,
  'active',
  jsonb_build_object(
    'startEvent',          v."start_event",
    'flagSnapshot',        v."flag_snapshot"::jsonb,
    'serviceInvariants',   v."service_invariants"::jsonb,
    'escalationPolicy',    v."escalation_policy"::jsonb,
    'terminalDataWrites',  v."terminal_data_writes"::jsonb
  ),
  NULL,
  '2026-06-14T00:00:00Z'::timestamptz,
  'system'
FROM "workflow_definition" wd
JOIN (VALUES
  ('enrolment-change-approval',
   'enrolment.status-change-requested',
   '["enrolment.change-approval.required"]',
   '["EnrolmentService.transitionStatus: bitemporal write, valid status, record-lock check"]',
   '{"defaultDeadlineDays": 5, "escalateToRole": "registry-administrator"}',
   '["enrolment.status_code updated bitemporally, audit record written"]'),

  ('module-registration-change',
   'module-registration.add-drop-requested',
   '["module-registration.approval.required"]',
   '["RegistrationService: duplicate check, capacity guard, prerequisite check, credit limit, bitemporal write"]',
   '{"defaultDeadlineDays": 3, "escalateToRole": "registry-administrator"}',
   '["module_registration row updated bitemporally, downstream triggers evaluated"]'),

  ('assessment-mark-review',
   'mark.ingested-on-controlled-period',
   '["assessment.moderation.workflow.enabled"]',
   '["MarkService: record-lock guard, valid-mark range, bitemporal write", "ModuleResultService: recalculation deterministic"]',
   '{"defaultDeadlineDays": 10, "escalateToRole": "exam-board-chair"}',
   '["mark bitemporally confirmed, module_result updated, moderation decision audit written"]'),

  ('progression-review',
   'progression.criteria-met',
   '["progression.board-review.enabled"]',
   '["ProgressionService.decide: valid algorithm, credit/mark thresholds, bitemporal persistence"]',
   '{"defaultDeadlineDays": 14, "escalateToRole": "exam-board-chair"}',
   '["progression_decision written, algorithm key and rule ids recorded, workflow decision audit"]'),

  ('award-classification',
   'award.eligible-signal',
   '["award.discretionary-review.enabled"]',
   '["AwardService: locked results required, valid classification, EnrolmentService.transitionStatus graduation"]',
   '{"defaultDeadlineDays": 14, "escalateToRole": "exam-board-chair"}',
   '["award row created, classification and algorithm evidence recorded, enrolment transitioned to graduated"]'),

  ('exam-board-governance',
   'exam-board.constitution-command',
   '["exam-board.external-examiner.required"]',
   '["BoardService.ratifyBoard: external-examiner signoff guard, record-lock writes for marks/results/progressions"]',
   '{"defaultDeadlineDays": 21, "escalateToRole": "exam-board-chair"}',
   '["board ratified, module results and marks locked, progression decisions locked"]'),

  ('correction-case',
   'correction.eligibility-event',
   '["correction.panel-review.enabled"]',
   '["CorrectionService: locked-record amendment authority, valid correction status transitions"]',
   '{"defaultDeadlineDays": 28, "escalateToRole": "registry-administrator"}',
   '["correction_case status updated, locked-record amended if upheld, amendment audit written"]'),

  ('appeal-case',
   'appeal.submission-command',
   '["appeal.panel-hearing.enabled"]',
   '["CorrectionService: locked-record amendment authority, valid correction status transitions"]',
   '{"defaultDeadlineDays": 28, "escalateToRole": "registry-administrator"}',
   '["appeal_case status updated, locked-record amended if upheld, amendment audit written"]'),

  ('regulatory-submission-approval',
   'regulatory.submission-prepared',
   '["regulatory.submission.manual-approval.required", "regulatory.environment-safety.active"]',
   '["RegulatoryExchangeService: endpoint safety class, environment live-traffic approval"]',
   '{"defaultDeadlineDays": 2, "escalateToRole": "regulatory-officer"}',
   '["regulatory_exchange record status updated, outbound exchange dispatched and logged"]'),

  ('finance-fee-handoff',
   'enrolment.fee-event',
   '["finance.fee-handoff.enabled", "finance.external-system-integration.enabled"]',
   '["EnrolmentService: valid fee liability, currency-aware monetary amount"]',
   '{"defaultDeadlineDays": 5, "escalateToRole": "finance-administrator"}',
   '["fee_liability status updated, invoice reference recorded, finance system notified"]'),

  ('identity-provisioning',
   'person.creation-command',
   '["identity.deduplication.enabled"]',
   '["PersonService: valid identity fields, unique person guard"]',
   '{"defaultDeadlineDays": 1, "escalateToRole": "registry-administrator"}',
   '["person_identity created or merged, deduplication evidence recorded"]'),

  ('communication-dispatch',
   'communication.dispatch-trigger',
   '["communications.locale-aware.enabled"]',
   '[]',
   '{"defaultDeadlineDays": 1, "escalateToRole": "registry-administrator"}',
   '["communication dispatch event published, delivery audit written"]')
) AS v(
  "definition_code", "start_event", "flag_snapshot",
  "service_invariants", "escalation_policy", "terminal_data_writes"
) ON wd."definition_code" = v."definition_code"
WHERE wd."tenant_id" IS NULL
ON CONFLICT ("workflow_definition_id", "version_number") DO NOTHING;

-- ── Section 4: Workflow Steps ──────────────────────────────────────────────────

-- enrolment-change-approval steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('change-requested',   'start',         'Enrolment change requested',          NULL,                    10, '{}'),
  ('registrar-review',   'human-task',    'Registrar review',                    'registry-administrator', 20, '{"flagGuard": "enrolment.change-approval.required"}'),
  ('gateway-approval',   'decision',      'Change approval decision',            NULL,                    30, '{"gatewayKey": "G01"}'),
  ('enrolment-updated',  'integration',   'Enrolment status updated',            NULL,                    40, '{"targetService": "EnrolmentService.transitionStatus"}'),
  ('end',                'end',           'Enrolment change workflow complete',   NULL,                    50, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'enrolment-change-approval' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- module-registration-change steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('registration-requested',        'start',       'Registration change requested',          NULL,                    10, '{}'),
  ('window-and-prerequisite-check', 'system-task', 'Window and prerequisite check',          NULL,                    20, '{"serviceCall": "RegistrationService.checkWindowAndPrerequisites"}'),
  ('approval-review',               'human-task',  'Registration approval review',           'registry-administrator', 30, '{"flagGuard": "module-registration.approval.required"}'),
  ('gateway-approval',              'decision',    'Registration approval decision',          NULL,                    40, '{"gatewayKey": "G01"}'),
  ('registration-updated',          'integration', 'Registration updated',                   NULL,                    50, '{"targetService": "RegistrationService.updateRegistration"}'),
  ('end',                           'end',         'Registration change workflow complete',   NULL,                    60, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'module-registration-change' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- assessment-mark-review steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('mark-ingested',      'start',       'Mark ingested on controlled period',  NULL,                    10, '{}'),
  ('moderation-review',  'human-task',  'Moderation review',                   'module-tutor',          20, '{"flagGuard": "assessment.moderation.workflow.enabled"}'),
  ('late-penalty-review','human-task',  'Late penalty review',                 'registry-administrator', 30, '{}'),
  ('result-review',      'human-task',  'Result review',                       'exam-board-chair',      40, '{}'),
  ('outcome-approved',   'system-task', 'Mark review outcome approved',        NULL,                    50, '{"serviceCall": "MarkService.confirmMark"}'),
  ('end',                'end',         'Mark review workflow complete',        NULL,                    60, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'assessment-mark-review' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- progression-review steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('progression-data-gathered',  'start',       'Progression data gathered',           NULL,                10, '{}'),
  ('algorithm-applied',          'system-task', 'Progression algorithm applied',        NULL,                20, '{"serviceCall": "ProgressionService.decide"}'),
  ('gateway-complexity',         'decision',    'Complexity and discretion gateway',    NULL,                30, '{"gatewayKey": "G01"}'),
  ('board-review',               'human-task',  'Board review',                         'exam-board-chair',  40, '{"flagGuard": "progression.board-review.enabled"}'),
  ('outcome-decided',            'human-task',  'Progression outcome decided',          'exam-board-chair',  50, '{}'),
  ('outcome-notified',           'system-task', 'Progression outcome notified',         NULL,                60, '{"eventType": "srs.progression.outcome-decided"}'),
  ('end',                        'end',         'Progression review workflow complete',  NULL,               70, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'progression-review' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- award-classification steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('results-verified',       'start',       'Award results verified',                 NULL,                10, '{}'),
  ('classification-calculated','system-task','Classification calculated',              NULL,                20, '{"serviceCall": "AwardService.calculateClassification"}'),
  ('gateway-discretionary',  'decision',    'Discretionary review gateway',           NULL,                30, '{"gatewayKey": "G01"}'),
  ('discretionary-review',   'human-task',  'Discretionary classification review',    'exam-board-chair',  40, '{"flagGuard": "award.discretionary-review.enabled"}'),
  ('award-approved',         'human-task',  'Award approved',                         'exam-board-chair',  50, '{}'),
  ('graduation-triggered',   'integration', 'Graduation triggered',                   NULL,                60, '{"targetService": "EnrolmentService.transitionStatus", "targetStatus": "graduated"}'),
  ('end',                    'end',         'Award classification workflow complete',  NULL,                70, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'award-classification' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- exam-board-governance steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('board-constituted',       'start',       'Board constituted',                      NULL,                    10, '{}'),
  ('data-pack-prepared',      'human-task',  'Data pack prepared',                     'registry-administrator', 20, '{}'),
  ('external-examiner-review','human-task',  'External examiner review',               'external-examiner',      30, '{"flagGuard": "exam-board.external-examiner.required"}'),
  ('gateway-concerns',        'decision',    'External examiner concerns gateway',      NULL,                    40, '{"gatewayKey": "G01"}'),
  ('concerns-resolved',       'human-task',  'External examiner concerns resolved',    'exam-board-chair',       50, '{}'),
  ('chair-ratification',      'human-task',  'Chair ratification',                     'exam-board-chair',       60, '{}'),
  ('record-locked',           'integration', 'Records locked after ratification',       NULL,                    70, '{"targetService": "BoardService.ratifyBoard"}'),
  ('end',                     'end',         'Exam board governance workflow complete', NULL,                    80, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'exam-board-governance' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- correction-case steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('case-received',       'start',       'Correction case received',           NULL,                    10, '{}'),
  ('eligibility-assessed','human-task',  'Eligibility assessed',               'registry-administrator', 20, '{}'),
  ('gateway-admissible',  'decision',    'Case admissibility gateway',          NULL,                    30, '{"gatewayKey": "G01"}'),
  ('evidence-gathered',   'human-task',  'Evidence gathered',                  'registry-administrator', 40, '{}'),
  ('gateway-panel',       'decision',    'Panel review required gateway',       NULL,                    50, '{"gatewayKey": "G02", "flagGuard": "correction.panel-review.enabled"}'),
  ('panel-review',        'human-task',  'Panel review',                       'exam-board-chair',       60, '{}'),
  ('outcome-decided',     'human-task',  'Outcome decided',                    'registry-administrator', 70, '{}'),
  ('gateway-upheld',      'decision',    'Case upheld gateway',                 NULL,                    80, '{"gatewayKey": "G03"}'),
  ('amendment-applied',   'integration', 'Locked-record amendment applied',     NULL,                    90, '{"targetService": "CorrectionService.applyAmendment"}'),
  ('case-closed',         'end',         'Correction case closed',              NULL,                   100, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'correction-case' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- appeal-case steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('appeal-received',       'start',       'Appeal received',                    NULL,                    10, '{}'),
  ('grounds-assessed',      'human-task',  'Grounds assessed',                   'registry-administrator', 20, '{}'),
  ('gateway-admissible',    'decision',    'Appeal admissibility gateway',        NULL,                    30, '{"gatewayKey": "G01"}'),
  ('evidence-gathered',     'human-task',  'Evidence gathered',                  'registry-administrator', 40, '{}'),
  ('gateway-hearing',       'decision',    'Panel hearing required gateway',      NULL,                    50, '{"gatewayKey": "G02", "flagGuard": "appeal.panel-hearing.enabled"}'),
  ('panel-hearing',         'human-task',  'Panel hearing',                      'exam-board-chair',       60, '{}'),
  ('outcome-decided',       'human-task',  'Outcome decided',                    'registry-administrator', 70, '{}'),
  ('gateway-upheld',        'decision',    'Appeal upheld gateway',               NULL,                    80, '{"gatewayKey": "G03"}'),
  ('amendment-applied',     'integration', 'Locked-record amendment applied',    NULL,                     90, '{"targetService": "CorrectionService.applyAmendment"}'),
  ('case-closed',           'end',         'Appeal case closed',                  NULL,                   100, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'appeal-case' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- regulatory-submission-approval steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('submission-prepared',    'start',       'Regulatory submission prepared',          NULL,                 10, '{}'),
  ('validation-complete',    'system-task', 'Submission validation complete',          NULL,                 20, '{"serviceCall": "RegulatoryExchangeService.validate"}'),
  ('gateway-approval',       'decision',    'Manual approval required gateway',        NULL,                 30, '{"gatewayKey": "G01", "flagGuard": "regulatory.submission.manual-approval.required"}'),
  ('submission-approved',    'human-task',  'Submission approved',                     'regulatory-officer', 40, '{}'),
  ('submission-dispatched',  'integration', 'Submission dispatched',                   NULL,                 50, '{"targetService": "RegulatoryExchangeService.dispatch", "safetyClassRequired": true}'),
  ('gateway-response',       'decision',    'Response awaited gateway',                NULL,                 60, '{"gatewayKey": "G02"}'),
  ('response-processed',     'system-task', 'Response processed',                      NULL,                 70, '{}'),
  ('end',                    'end',         'Regulatory submission workflow complete',  NULL,                 80, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'regulatory-submission-approval' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- finance-fee-handoff steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('fee-liability-created',   'start',       'Fee liability created',              NULL,                     10, '{}'),
  ('fee-calculated',          'system-task', 'Fee calculated',                     NULL,                     20, '{"serviceCall": "FeeService.calculateFee"}'),
  ('gateway-external-system', 'decision',    'External finance system gateway',    NULL,                     30, '{"gatewayKey": "G01", "flagGuard": "finance.fee-handoff.enabled"}'),
  ('invoice-generated',       'integration', 'Invoice generated',                  NULL,                     40, '{"targetService": "InvoiceService.generate"}'),
  ('payment-confirmed',       'human-task',  'Payment confirmed',                  'finance-administrator',  50, '{}'),
  ('finance-system-notified', 'integration', 'External finance system notified',   NULL,                     60, '{"flagGuard": "finance.external-system-integration.enabled"}'),
  ('end',                     'end',         'Finance fee handoff complete',        NULL,                     70, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'finance-fee-handoff' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- identity-provisioning steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('identity-submitted',    'start',       'Identity submitted',                  NULL,                    10, '{}'),
  ('deduplication-check',   'system-task', 'Deduplication check',                 NULL,                    20, '{"flagGuard": "identity.deduplication.enabled", "serviceCall": "PersonService.checkDuplicates"}'),
  ('gateway-match-found',   'decision',    'Duplicate match gateway',             NULL,                    30, '{"gatewayKey": "G01"}'),
  ('merge-review',          'human-task',  'Merge review',                        'registry-administrator', 40, '{}'),
  ('identity-confirmed',    'system-task', 'Identity confirmed',                  NULL,                    50, '{"serviceCall": "PersonService.confirmIdentity"}'),
  ('end',                   'end',         'Identity provisioning complete',       NULL,                    60, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'identity-provisioning' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- communication-dispatch steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('trigger-received',           'start',       'Communication trigger received',         NULL, 10, '{}'),
  ('template-selected',          'system-task', 'Template selected',                      NULL, 20, '{"serviceCall": "CommunicationService.selectTemplate"}'),
  ('locale-resolved',            'system-task', 'Locale resolved',                        NULL, 30, '{"flagGuard": "communications.locale-aware.enabled", "serviceCall": "LocaleService.resolveLocale"}'),
  ('channel-selected',           'system-task', 'Channel selected',                       NULL, 40, '{"serviceCall": "CommunicationService.selectChannel"}'),
  ('message-dispatched',         'integration', 'Message dispatched',                     NULL, 50, '{}'),
  ('gateway-delivery-confirm',   'decision',    'Delivery confirmation required gateway', NULL, 60, '{"gatewayKey": "G01"}'),
  ('delivery-confirmed',         'system-task', 'Delivery confirmed',                     NULL, 70, '{}'),
  ('end',                        'end',         'Communication dispatch complete',         NULL, 80, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'communication-dispatch' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- ── Section 5: Workflow Decision Gateways ─────────────────────────────────────

-- enrolment-change-approval gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'Change request approved or rejected?', '{"policySource": "Enrolment Policy, status transition rules", "approvedOutcome": "enrolment-updated", "rejectedOutcome": "end"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'enrolment-change-approval' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- module-registration-change gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'Registration change approved or rejected?', '{"policySource": "Registration Window Policy, prerequisite rules", "approvedOutcome": "registration-updated", "rejectedOutcome": "end"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'module-registration-change' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- progression-review gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'Straightforward or discretionary case?', '{"policySource": "Academic progression rules and cohort thresholds", "straightforwardOutcome": "outcome-decided", "discretionaryOutcome": "board-review"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'progression-review' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- award-classification gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'Straightforward or discretionary classification?', '{"policySource": "Classification algorithm and boundary rules", "straightforwardOutcome": "award-approved", "discretionaryOutcome": "discretionary-review"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'award-classification' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- exam-board-governance gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'External examiner concerns raised?', '{"policySource": "External examiner reporting requirements", "noConcernsOutcome": "chair-ratification", "concernsOutcome": "concerns-resolved"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'exam-board-governance' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- correction-case gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'Correction case admissible?',    '{"policySource": "Correction eligibility policy", "admissibleOutcome": "evidence-gathered", "inadmissibleOutcome": "case-closed"}'),
  ('G02', 'Panel review required?',         '{"policySource": "Correction panel review policy", "panelRequiredOutcome": "panel-review", "noPanelOutcome": "outcome-decided"}'),
  ('G03', 'Correction case upheld?',        '{"policySource": "Correction outcome decision", "upheldOutcome": "amendment-applied", "notUpheldOutcome": "case-closed"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'correction-case' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- appeal-case gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'Appeal admissible?',         '{"policySource": "Academic appeals policy and grounds criteria", "admissibleOutcome": "evidence-gathered", "inadmissibleOutcome": "case-closed"}'),
  ('G02', 'Panel hearing required?',    '{"policySource": "Academic appeals panel policy", "hearingRequiredOutcome": "panel-hearing", "noHearingOutcome": "outcome-decided"}'),
  ('G03', 'Appeal upheld?',             '{"policySource": "Academic appeals outcome decision", "upheldOutcome": "amendment-applied", "notUpheldOutcome": "case-closed"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'appeal-case' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- regulatory-submission-approval gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'Manual approval required?',    '{"policySource": "Environment safety class and regulatory submission policy", "approvalRequiredOutcome": "submission-approved", "autoApproveOutcome": "submission-dispatched"}'),
  ('G02', 'Response awaited?',            '{"policySource": "Regulatory exchange protocol", "awaitedOutcome": "response-processed", "noResponseOutcome": "end"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'regulatory-submission-approval' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- finance-fee-handoff gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'External finance system integration enabled?', '{"policySource": "Finance integration configuration", "enabledOutcome": "invoice-generated", "disabledOutcome": "end"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'finance-fee-handoff' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- identity-provisioning gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'Potential duplicate match found?', '{"policySource": "Identity deduplication policy", "matchFoundOutcome": "merge-review", "noMatchOutcome": "identity-confirmed"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'identity-provisioning' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- communication-dispatch gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'Delivery confirmation required?', '{"policySource": "Communication channel configuration", "confirmationRequiredOutcome": "delivery-confirmed", "noConfirmationOutcome": "end"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'communication-dispatch' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- ── Section 6: Workflow Assignment Rules ──────────────────────────────────────

-- Default role assignment rules for all Stage 2 workflows.
-- rule_key must be unique within (workflow_definition_version_id, tenant_id),
-- so each rule key embeds both the workflow short-name and the step key.
INSERT INTO "workflow_assignment_rule" (
  "workflow_definition_version_id", "step_key", "rule_key",
  "priority", "assignee_role_code", "active", "configuration"
)
SELECT wdv."id", r."step_key", r."rule_key", r."priority"::integer, r."assignee_role_code", true, r."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  -- enrolment-change-approval
  ('enrolment-change-approval', 'registrar-review',         'enrolment-change.registrar-review.registry-default',          100, 'registry-administrator', '{}'),

  -- module-registration-change
  ('module-registration-change', 'approval-review',         'module-reg-change.approval-review.registry-default',          100, 'registry-administrator', '{}'),

  -- assessment-mark-review
  ('assessment-mark-review', 'moderation-review',           'mark-review.moderation-review.module-tutor-default',          100, 'module-tutor',           '{}'),
  ('assessment-mark-review', 'late-penalty-review',         'mark-review.late-penalty-review.registry-default',            100, 'registry-administrator', '{}'),
  ('assessment-mark-review', 'result-review',               'mark-review.result-review.board-chair-default',               100, 'exam-board-chair',       '{}'),

  -- progression-review
  ('progression-review', 'board-review',                    'progression.board-review.board-chair-default',                100, 'exam-board-chair',       '{}'),
  ('progression-review', 'outcome-decided',                 'progression.outcome-decided.board-chair-default',             100, 'exam-board-chair',       '{}'),

  -- award-classification
  ('award-classification', 'discretionary-review',          'award.discretionary-review.board-chair-default',              100, 'exam-board-chair',       '{}'),
  ('award-classification', 'award-approved',                'award.award-approved.board-chair-default',                    100, 'exam-board-chair',       '{}'),

  -- exam-board-governance
  ('exam-board-governance', 'data-pack-prepared',           'board.data-pack-prepared.registry-default',                   100, 'registry-administrator', '{}'),
  ('exam-board-governance', 'external-examiner-review',     'board.external-examiner-review.external-examiner-default',    100, 'external-examiner',      '{}'),
  ('exam-board-governance', 'concerns-resolved',            'board.concerns-resolved.chair-default',                       100, 'exam-board-chair',       '{}'),
  ('exam-board-governance', 'chair-ratification',           'board.chair-ratification.chair-default',                      100, 'exam-board-chair',       '{}'),

  -- correction-case
  ('correction-case', 'eligibility-assessed',               'correction.eligibility-assessed.registry-default',            100, 'registry-administrator', '{}'),
  ('correction-case', 'evidence-gathered',                  'correction.evidence-gathered.registry-default',               100, 'registry-administrator', '{}'),
  ('correction-case', 'panel-review',                       'correction.panel-review.panel-chair-default',                 100, 'exam-board-chair',       '{}'),
  ('correction-case', 'outcome-decided',                    'correction.outcome-decided.registry-default',                 100, 'registry-administrator', '{}'),

  -- appeal-case
  ('appeal-case', 'grounds-assessed',                       'appeal.grounds-assessed.registry-default',                    100, 'registry-administrator', '{}'),
  ('appeal-case', 'evidence-gathered',                      'appeal.evidence-gathered.registry-default',                   100, 'registry-administrator', '{}'),
  ('appeal-case', 'panel-hearing',                          'appeal.panel-hearing.panel-chair-default',                    100, 'exam-board-chair',       '{}'),
  ('appeal-case', 'outcome-decided',                        'appeal.outcome-decided.registry-default',                     100, 'registry-administrator', '{}'),

  -- regulatory-submission-approval
  ('regulatory-submission-approval', 'submission-approved', 'regulatory.submission-approved.officer-default',              100, 'regulatory-officer',     '{}'),

  -- finance-fee-handoff
  ('finance-fee-handoff', 'payment-confirmed',              'finance.payment-confirmed.administrator-default',             100, 'finance-administrator',  '{}'),

  -- identity-provisioning
  ('identity-provisioning', 'merge-review',                 'identity.merge-review.registry-default',                      100, 'registry-administrator', '{}')
  -- communication-dispatch: fully automated, no human-task assignment rules required
) AS r(
  "definition_code", "step_key", "rule_key", "priority",
  "assignee_role_code", "configuration"
) ON wd."definition_code" = r."definition_code"
WHERE wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT DO NOTHING;
