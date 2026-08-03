-- Revelation SRS — SLC confirmation submission approval workflow
-- Migration: 0008_slc_submission_approval_workflow
--
-- Reference implementation for the broader technical debt item: all
-- regulatory submission processes (HESA, SLC, OfS, UCAS, UKVI) are
-- stateless synchronous operations with no task-inbox integration or
-- human-approval gate. SLC is the first converted, following exactly the
-- same seed pattern as 0007_module_registration_change_workflow.sql
-- (itself modeled on 0005_module_selection_rules.sql's
-- 'module-selection-approval'). Remaining processes are tracked as
-- follow-up work, not implemented in this migration.

INSERT INTO "workflow_definition" (
  "definition_code",
  "display_name",
  "owner_module_code",
  "status_code",
  "current_version_number",
  "description",
  "created_by"
) VALUES (
  'slc-confirmation-submission-approval',
  'SLC confirmation submission approval',
  'regulatory',
  'active',
  1,
  'Routes a batch of previewed SLC enrolment confirmations to a regulatory officer for approval before they are transmitted, snapshotting the exact trigger set previewed so a later approval acts on what was actually reviewed.',
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
    'decisionStepKey', 'approve-or-reject-submission',
    'decisionGatewayAuditTable', 'workflow_decision_audit'
  ),
  '2026-08-03T00:00:00Z'::timestamptz,
  'system'
FROM "workflow_definition" wd
WHERE wd."definition_code" = 'slc-confirmation-submission-approval'
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
  ('batch-previewed', 'start', 'Confirmation batch previewed', null, 10, '{}'),
  ('approve-or-reject-submission', 'human-task', 'Regulatory officer approval', 'regulatory-officer', 20, '{"assignmentRulesRequired": true}'),
  ('decision-gateway', 'decision', 'Submission decision gateway', 'regulatory-officer', 30, '{"auditTable": "workflow_decision_audit"}'),
  ('request-closed', 'end', 'Submission workflow closed', null, 40, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'slc-confirmation-submission-approval'
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
  'Approve or reject the SLC confirmation batch?',
  'exclusive',
  'packages/db/migrations/0008_slc_submission_approval_workflow.sql',
  jsonb_build_object(
    'ownerRole', 'Regulatory Officer',
    'policySource', 'Institutional SLC confirmation submission policy'
  )
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
WHERE wd."definition_code" = 'slc-confirmation-submission-approval'
  AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;
