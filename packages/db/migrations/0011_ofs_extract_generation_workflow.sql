-- Revelation SRS — OfS B3/participation extract generation approval workflow
-- Migration: 0011_ofs_extract_generation_workflow
--
-- Third regulatory-submission process converted, following the pattern
-- established for SLC (0008) and HESA (0010). OfS is structurally different
-- from the other three: there is no submit/transmit step anywhere in the
-- codebase (the admin console's only further action is a client-side JSON
-- download), so this gate sits before the one meaningful mutating action
-- that does exist — generating the official extract record — rather than
-- before a submission that doesn't exist. A single workflow covers both the
-- B3 extract and the access/participation report, distinguished by
-- extractTypeCode in the workflow context.

INSERT INTO "workflow_definition" (
  "definition_code",
  "display_name",
  "owner_module_code",
  "status_code",
  "current_version_number",
  "description",
  "created_by"
) VALUES (
  'ofs-extract-generation-approval',
  'OfS extract generation approval',
  'regulatory',
  'active',
  1,
  'Routes a request to generate an official OfS B3 or access/participation extract to a regulatory officer for approval before the extract record is created.',
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
    'decisionStepKey', 'approve-or-reject-generation',
    'decisionGatewayAuditTable', 'workflow_decision_audit'
  ),
  '2026-08-03T00:00:00Z'::timestamptz,
  'system'
FROM "workflow_definition" wd
WHERE wd."definition_code" = 'ofs-extract-generation-approval'
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
  ('generation-requested', 'start', 'Extract generation requested', null, 10, '{}'),
  ('approve-or-reject-generation', 'human-task', 'Regulatory officer approval', 'regulatory-officer', 20, '{"assignmentRulesRequired": true}'),
  ('decision-gateway', 'decision', 'Generation decision gateway', 'regulatory-officer', 30, '{"auditTable": "workflow_decision_audit"}'),
  ('request-closed', 'end', 'Generation workflow closed', null, 40, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'ofs-extract-generation-approval'
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
  'Approve or reject the OfS extract generation?',
  'exclusive',
  'packages/db/migrations/0011_ofs_extract_generation_workflow.sql',
  jsonb_build_object(
    'ownerRole', 'Regulatory Officer',
    'policySource', 'Institutional OfS extract generation policy'
  )
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
WHERE wd."definition_code" = 'ofs-extract-generation-approval'
  AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;
