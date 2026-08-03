-- Revelation SRS — Module registration/withdrawal change-request workflow
-- Migration: 0007_module_registration_change_workflow
--
-- Technical debt item: module registration and withdrawal were immediate,
-- single-step operations with no approval step, despite workflow being a
-- core architectural principle (ADR-016) and despite the module-selection
-- proposal flow already demonstrating the pattern for capacity exceptions
-- (see 0005_module_selection_rules.sql, workflow code
-- 'module-selection-approval'). This migration adds a second, simpler
-- workflow so *every* portal-initiated registration or withdrawal request
-- goes through a personal-tutor (or registry-administrator) approval step,
-- not just capacity-conflict cases. Staff-initiated direct registration via
-- POST /module-registrations is unaffected — only the new portal-facing
-- request endpoints use this workflow.

INSERT INTO "workflow_definition" (
  "definition_code",
  "display_name",
  "owner_module_code",
  "status_code",
  "current_version_number",
  "description",
  "created_by"
) VALUES (
  'module-registration-change-approval',
  'Module registration/withdrawal change request approval',
  'registration',
  'active',
  1,
  'Routes a student-initiated module registration or withdrawal request to a personal tutor or registry administrator for approval before it is applied.',
  'system'
)
ON CONFLICT DO NOTHING;

INSERT INTO "workflow_definition_version" (
  "workflow_definition_id",
  "version_number",
  "status_code",
  "definition_json",
  "effective_from",
  "created_by"
)
SELECT
  wd."id",
  1,
  'active',
  jsonb_build_object(
    'decisionStepKey', 'approve-or-reject-registration-change',
    'decisionGatewayAuditTable', 'workflow_decision_audit'
  ),
  '2026-08-03T00:00:00Z'::timestamptz,
  'system'
FROM "workflow_definition" wd
WHERE wd."definition_code" = 'module-registration-change-approval'
ON CONFLICT ("workflow_definition_id", "version_number") DO NOTHING;

INSERT INTO "workflow_step" (
  "workflow_definition_version_id",
  "step_key",
  "step_type_code",
  "display_name",
  "owner_role_code",
  "sort_order",
  "configuration"
)
SELECT
  wdv."id",
  s."step_key",
  s."step_type_code",
  s."display_name",
  s."owner_role_code",
  s."sort_order",
  s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('request-submitted', 'start', 'Change request submitted', null, 10, '{}'),
  ('approve-or-reject-registration-change', 'human-task', 'Personal tutor or registry approval', 'personal-tutor', 20, '{"assignmentRulesRequired": true}'),
  ('decision-gateway', 'decision', 'Registration change decision gateway', 'personal-tutor', 30, '{"auditTable": "workflow_decision_audit"}'),
  ('request-closed', 'end', 'Change request workflow closed', null, 40, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'module-registration-change-approval'
  AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id",
  "gateway_key",
  "display_name",
  "decision_type_code",
  "source_reference",
  "configuration"
)
SELECT
  wdv."id",
  'G01',
  'Approve or reject the registration change?',
  'exclusive',
  'packages/db/migrations/0007_module_registration_change_workflow.sql',
  jsonb_build_object(
    'ownerRole', 'Personal Tutor or Registry Administrator',
    'policySource', 'Institutional module registration and withdrawal policy'
  )
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
WHERE wd."definition_code" = 'module-registration-change-approval'
  AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;
