-- Revelation SRS — Legal identity change (gender/nationality) approval workflow
-- Migration: 0009_legal_identity_change_workflow
--
-- Technical debt item: gender and nationality were removed from the portal
-- profile edit form because legal identity changes require documentation and
-- administrative approval, not self-service. However PATCH
-- /students/:personId/identity had no field-level restriction at all — a
-- student could self-PATCH genderCode/nationalityCode directly with no
-- approval; only the portal UI omitted the fields. This migration adds the
-- workflow definition for a governed request/approve path; the API-level
-- restriction on the direct PATCH route and the request/decide routes are
-- added in the same change (apps/api/src/routes/students.ts).
--
-- Follows the same seed pattern as 0007_module_registration_change_workflow.sql
-- and 0008_slc_submission_approval_workflow.sql.

INSERT INTO "workflow_definition" (
  "definition_code",
  "display_name",
  "owner_module_code",
  "status_code",
  "current_version_number",
  "description",
  "created_by"
) VALUES (
  'legal-identity-change-approval',
  'Legal identity change (gender/nationality) approval',
  'students',
  'active',
  1,
  'Routes a student-initiated request to change their recorded gender or nationality to a personal tutor or registry administrator for approval before the bitemporal person_identity record is updated.',
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
    'decisionStepKey', 'approve-or-reject-identity-change',
    'decisionGatewayAuditTable', 'workflow_decision_audit'
  ),
  '2026-08-03T00:00:00Z'::timestamptz,
  'system'
FROM "workflow_definition" wd
WHERE wd."definition_code" = 'legal-identity-change-approval'
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
  ('request-submitted', 'start', 'Identity change request submitted', null, 10, '{}'),
  ('approve-or-reject-identity-change', 'human-task', 'Personal tutor or registry approval', 'personal-tutor', 20, '{"assignmentRulesRequired": true}'),
  ('decision-gateway', 'decision', 'Identity change decision gateway', 'personal-tutor', 30, '{"auditTable": "workflow_decision_audit"}'),
  ('request-closed', 'end', 'Identity change request workflow closed', null, 40, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'legal-identity-change-approval'
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
  'Approve or reject the legal identity change?',
  'exclusive',
  'packages/db/migrations/0009_legal_identity_change_workflow.sql',
  jsonb_build_object(
    'ownerRole', 'Personal Tutor or Registry Administrator',
    'policySource', 'Institutional legal identity change and documentation policy'
  )
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
WHERE wd."definition_code" = 'legal-identity-change-approval'
  AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;
