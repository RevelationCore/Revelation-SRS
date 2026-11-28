-- 0009_adjustment_proposals
--
-- ADR-033 item 2 (BL-378): a core adjustment with no wellbeing case behind it
-- is a proposal until a second person approves it. Proposals live in their own
-- table, so no reader of reasonable_adjustment (mark service, board pack, exam
-- entries, dispatcher, portal) can see one before it is approved.
-- SME-6 (2026-11-23): adjustment:propose belongs to registry-administrator and
-- a narrow adjustment-proposer role, not wellbeing-advisor.

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, NULL, NULL
FROM "value_set" vs,
(VALUES
  ('srs-role-code', 'adjustment-approver', 'Adjustment approver', 320),
  ('srs-role-code', 'adjustment-proposer', 'Adjustment proposer', 330)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS "adjustment_proposal" (
  "id"                    uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid         NOT NULL REFERENCES "tenant"("id"),
  "person_id"             uuid         NOT NULL REFERENCES "person"("id"),
  "enrolment_id"          uuid         NOT NULL,
  "adjustment_type_code"  text         NOT NULL,
  "scope_code"            text         NOT NULL,
  "amount_value"          numeric(8,2),
  "amount_unit_code"      text,
  "valid_from"            timestamptz  NOT NULL,
  "valid_to"              timestamptz,
  "manual_reason_code"    text         NOT NULL,
  -- Where the decision is held (a case number or file reference): an identifier, never narrative.
  "external_reference"    text         NOT NULL CHECK (char_length("external_reference") BETWEEN 1 AND 100),
  "status_code"           text         NOT NULL DEFAULT 'proposed' CHECK ("status_code" IN ('proposed', 'approved', 'rejected')),
  "proposed_by"           text         NOT NULL,
  "proposed_by_person_id" uuid,
  "proposed_at"           timestamptz  NOT NULL DEFAULT now(),
  "workflow_instance_id"  uuid,
  "decided_by"            text,
  "decided_by_person_id"  uuid,
  "decided_at"            timestamptz,
  "decision_reason"       text         CHECK ("decision_reason" IS NULL OR char_length("decision_reason") <= 500),
  "adjustment_id"         uuid,
  CONSTRAINT "adjustment_proposal_amount_ck" CHECK (("amount_value" IS NULL) = ("amount_unit_code" IS NULL)),
  CONSTRAINT "adjustment_proposal_valid_ck" CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from"),
  CONSTRAINT "adjustment_proposal_decision_ck" CHECK (
    ("status_code" <> 'approved' OR ("adjustment_id" IS NOT NULL AND "decided_by" IS NOT NULL))
    AND ("status_code" <> 'rejected' OR ("decided_by" IS NOT NULL AND "decision_reason" IS NOT NULL))
  )
);
CREATE INDEX IF NOT EXISTS "adjustment_proposal_status_idx" ON "adjustment_proposal" ("tenant_id", "status_code", "proposed_at");
CREATE INDEX IF NOT EXISTS "adjustment_proposal_person_idx" ON "adjustment_proposal" ("tenant_id", "person_id");

ALTER TABLE "adjustment_proposal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "adjustment_proposal" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "adjustment_proposal";
CREATE POLICY tenant_isolation ON "adjustment_proposal"
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);
GRANT SELECT, INSERT, UPDATE ON "adjustment_proposal" TO srs_app;

-- 0008 left this reference without its foreign key until the table existed.
ALTER TABLE "reasonable_adjustment" ADD CONSTRAINT "reasonable_adjustment_manual_proposal_fk"
  FOREIGN KEY ("manual_proposal_id") REFERENCES "adjustment_proposal"("id");

-- Value sets (P-16).
INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('adjustment-manual-reason-code', 'Manual Adjustment Reason', 'srs-internal', 'Why a core adjustment has no wellbeing case behind it (ADR-033)', true),
  ('adjustment-proposal-status-code', 'Adjustment Proposal Status', 'srs-internal', 'Where a manual adjustment proposal is (ADR-033)', false)
ON CONFLICT DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, NULL, NULL
FROM "value_set" vs,
(VALUES
  ('adjustment-manual-reason-code', 'external-case-system', 'Decided in the disability service''s own case system', 10),
  ('adjustment-manual-reason-code', 'paper-record',         'A signed paper support plan',                       20),
  ('adjustment-manual-reason-code', 'prior-provider-plan',  'A plan from a previous or partner provider',         30),
  ('adjustment-manual-reason-code', 'migration-correction', 'Re-entering a legacy adjustment the migration could not express', 40),
  ('adjustment-proposal-status-code', 'proposed', 'Proposed', 10),
  ('adjustment-proposal-status-code', 'approved', 'Approved', 20),
  ('adjustment-proposal-status-code', 'rejected', 'Rejected', 30)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('adjustment_proposal', 'manual_reason_code', 'adjustment-manual-reason-code'),
  ('adjustment_proposal', 'status_code',        'adjustment-proposal-status-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;

-- The manual path is off unless a tenant turns it on (ADR-033 item 4, SME-7).
WITH flag AS (
  INSERT INTO "feature_flag" ("flag_key", "display_name", "description", "owner_module_code", "status_code", "value_type_code", "default_variant_key", "created_by")
  VALUES ('adjustments.manual-proposals.enabled', 'Manual adjustment proposals',
    'When on, staff may propose a core adjustment with no wellbeing case, for a second person to approve. '
    'Leave off where the wellbeing module records every adjustment (ADR-033).',
    'adjustments', 'active', 'boolean', 'off', 'system')
  ON CONFLICT ("flag_key") DO NOTHING
  RETURNING "id"
)
INSERT INTO "feature_flag_variant" ("flag_id", "variant_key", "display_name", "value", "sort_order")
SELECT flag."id", v."variant_key", v."display_name", v."value"::jsonb, v."sort_order"
FROM flag, (VALUES ('off', 'Off', 'false', 10), ('on', 'On', 'true', 20)) AS v("variant_key", "display_name", "value", "sort_order")
ON CONFLICT ("flag_id", "variant_key") DO NOTHING;

-- The approval review (copies ec-determination).
INSERT INTO "workflow_definition" ("definition_code", "display_name", "owner_module_code", "status_code", "current_version_number", "description", "created_by")
VALUES ('adjustment-manual-approval', 'Manual adjustment approval', 'adjustments', 'active', 1,
  'A core adjustment proposed with no wellbeing case, approved or rejected by an adjustment approver who did not propose it.', 'system')
ON CONFLICT DO NOTHING;

INSERT INTO "workflow_definition_version" ("workflow_definition_id", "version_number", "status_code", "definition_json", "effective_from", "created_by")
SELECT wd."id", 1, 'active',
  jsonb_build_object('source', 'docs/decisions/ADR-033-authority-for-recording-a-core-adjustment.md', 'decisionStepKey', 'decide-manual-adjustment', 'decisionGatewayAuditTable', 'workflow_decision_audit'),
  '2026-11-23T00:00:00Z'::timestamptz, 'system'
FROM "workflow_definition" wd WHERE wd."definition_code" = 'adjustment-manual-approval'
ON CONFLICT ("workflow_definition_id", "version_number") DO NOTHING;

INSERT INTO "workflow_step" ("workflow_definition_version_id", "step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration")
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('manual-adjustment-proposed', 'start',      'Manual adjustment proposed',   null,                  10, '{}'),
  ('decide-manual-adjustment',   'human-task', 'Decide the manual adjustment', 'adjustment-approver', 20, '{"assignmentRulesRequired": true}'),
  ('decision-gateway',           'decision',   'Manual adjustment gateway',    'adjustment-approver', 30, '{"auditTable": "workflow_decision_audit"}'),
  ('manual-adjustment-closed',   'end',        'Manual adjustment closed',     null,                  40, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'adjustment-manual-approval' AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

INSERT INTO "workflow_decision_gateway" ("workflow_definition_version_id", "gateway_key", "display_name", "decision_type_code", "source_reference", "configuration")
SELECT wdv."id", 'G01', 'Approve the manual adjustment?', 'exclusive', 'bp-04-004', jsonb_build_object('policySource', 'Institutional reasonable adjustments policy')
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
WHERE wd."definition_code" = 'adjustment-manual-approval' AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;
