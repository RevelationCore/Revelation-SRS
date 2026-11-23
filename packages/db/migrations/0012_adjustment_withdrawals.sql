-- 0012_adjustment_withdrawals
--
-- ADR-034 items 5 and 8 (BL-408): a manual, migrated or legacy adjustment is
-- withdrawn early only by a proposal that a second person approves. Until
-- then the adjustment is unchanged.

CREATE TABLE IF NOT EXISTS "adjustment_withdrawal" (
  "id"                        uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                 uuid         NOT NULL REFERENCES "tenant"("id"),
  "adjustment_id"             uuid         NOT NULL,
  "person_id"                 uuid         NOT NULL REFERENCES "person"("id"),
  "withdrawal_reason_code"    text         NOT NULL CHECK ("withdrawal_reason_code" <> 'enrolment-ended'),
  "external_reference"        text         NOT NULL CHECK (char_length("external_reference") BETWEEN 1 AND 100),
  "replacement_adjustment_id" uuid,
  "status_code"               text         NOT NULL DEFAULT 'proposed' CHECK ("status_code" IN ('proposed', 'approved', 'rejected')),
  "proposed_by"               text         NOT NULL,
  "proposed_by_person_id"     uuid,
  "proposed_at"               timestamptz  NOT NULL DEFAULT now(),
  "workflow_instance_id"      uuid,
  "decided_by"                text,
  "decided_by_person_id"      uuid,
  "decided_at"                timestamptz,
  "decision_reason"           text         CHECK ("decision_reason" IS NULL OR char_length("decision_reason") <= 500),
  "withdrawn_at"              timestamptz,
  CONSTRAINT "adjustment_withdrawal_replacement_ck" CHECK (("withdrawal_reason_code" = 'superseded') = ("replacement_adjustment_id" IS NOT NULL)),
  CONSTRAINT "adjustment_withdrawal_decision_ck" CHECK (
    ("status_code" = 'proposed' OR "decided_by" IS NOT NULL)
    AND ("status_code" <> 'rejected' OR "decision_reason" IS NOT NULL)
    AND ("withdrawn_at" IS NULL OR "status_code" = 'approved')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS "adjustment_withdrawal_one_open" ON "adjustment_withdrawal" ("tenant_id", "adjustment_id") WHERE "status_code" = 'proposed';
CREATE INDEX IF NOT EXISTS "adjustment_withdrawal_status_idx" ON "adjustment_withdrawal" ("tenant_id", "status_code", "proposed_at");
CREATE INDEX IF NOT EXISTS "adjustment_withdrawal_person_idx" ON "adjustment_withdrawal" ("tenant_id", "person_id");

ALTER TABLE "adjustment_withdrawal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "adjustment_withdrawal" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "adjustment_withdrawal";
CREATE POLICY tenant_isolation ON "adjustment_withdrawal"
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);
GRANT SELECT, INSERT, UPDATE ON "adjustment_withdrawal" TO srs_app;

-- 0011 left this reference without its foreign key until the table existed.
ALTER TABLE "reasonable_adjustment" ADD CONSTRAINT "reasonable_adjustment_withdrawal_fk"
  FOREIGN KEY ("withdrawal_id") REFERENCES "adjustment_withdrawal"("id");

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('adjustment_withdrawal', 'withdrawal_reason_code', 'adjustment-withdrawal-reason-code'),
  ('adjustment_withdrawal', 'status_code',            'adjustment-proposal-status-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;

-- The approval review (copies adjustment-manual-approval).
INSERT INTO "workflow_definition" ("definition_code", "display_name", "owner_module_code", "status_code", "current_version_number", "description", "created_by")
VALUES ('adjustment-withdrawal-approval', 'Adjustment withdrawal approval', 'adjustments', 'active', 1,
  'An early withdrawal of a manual, migrated or legacy adjustment, approved or rejected by an adjustment approver who did not propose it.', 'system')
ON CONFLICT DO NOTHING;

INSERT INTO "workflow_definition_version" ("workflow_definition_id", "version_number", "status_code", "definition_json", "effective_from", "created_by")
SELECT wd."id", 1, 'active',
  jsonb_build_object('source', 'docs/decisions/ADR-034-authority-for-withdrawing-a-core-adjustment.md', 'decisionStepKey', 'decide-withdrawal', 'decisionGatewayAuditTable', 'workflow_decision_audit'),
  '2026-11-23T00:00:00Z'::timestamptz, 'system'
FROM "workflow_definition" wd WHERE wd."definition_code" = 'adjustment-withdrawal-approval'
ON CONFLICT ("workflow_definition_id", "version_number") DO NOTHING;

INSERT INTO "workflow_step" ("workflow_definition_version_id", "step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration")
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('withdrawal-proposed', 'start',      'Withdrawal proposed',      null,                  10, '{}'),
  ('decide-withdrawal',   'human-task', 'Decide the withdrawal',    'adjustment-approver', 20, '{"assignmentRulesRequired": true}'),
  ('decision-gateway',    'decision',   'Withdrawal gateway',       'adjustment-approver', 30, '{"auditTable": "workflow_decision_audit"}'),
  ('withdrawal-closed',   'end',        'Withdrawal closed',        null,                  40, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'adjustment-withdrawal-approval' AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

INSERT INTO "workflow_decision_gateway" ("workflow_definition_version_id", "gateway_key", "display_name", "decision_type_code", "source_reference", "configuration")
SELECT wdv."id", 'G01', 'Withdraw the adjustment?', 'exclusive', 'bp-04-004', jsonb_build_object('policySource', 'Institutional reasonable adjustments policy')
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
WHERE wd."definition_code" = 'adjustment-withdrawal-approval' AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;
