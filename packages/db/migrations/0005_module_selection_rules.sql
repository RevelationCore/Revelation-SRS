-- ============================================================
-- Module selection rules: diet groups, curriculum binding, and the
-- selection-proposal workflow.
--
-- See docs/architecture/module-selection-rules.md.
-- Resolves BP-03-002 OQ-1; BP-03-003 OQ-1; BP-03-004 OQ-1, OQ-2.
-- ============================================================

-- ── Module Group (Bitemporal) ─────────────────────────────────────────────────
-- Gives programme_rule_set actual diet content: compulsory/optional/elective
-- pools of modules, with count and/or credit bounds and level composition rules.
CREATE TABLE IF NOT EXISTS "module_group" (
  "version_id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                  uuid        NOT NULL,
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant"("id"),
  "programme_rule_set_id" uuid      NOT NULL,
  "fheq_level"          smallint,
  "group_code"          text        NOT NULL,
  "title"               text        NOT NULL,
  "group_type_code"     text        NOT NULL
                          CHECK ("group_type_code" IN ('compulsory','optional-pool','elective-pool')),
  "min_modules"         smallint,
  "max_modules"         smallint,
  "min_credits"         smallint,
  "max_credits"         smallint,
  "min_fheq_level"      smallint,
  "max_fheq_level"      smallint,
  "valid_from"          timestamptz NOT NULL,
  "valid_to"            timestamptz,
  "recorded_at"         timestamptz NOT NULL DEFAULT now(),
  "recorded_until"      timestamptz,
  CONSTRAINT "module_group_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "module_group_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "module_group_unique_logical_transaction"
  ON "module_group" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "module_group_current_version_unique"
  ON "module_group" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

CREATE INDEX IF NOT EXISTS "module_group_rule_set_idx"
  ON "module_group" ("tenant_id", "programme_rule_set_id")
  WHERE recorded_until IS NULL;

ALTER TABLE "module_group" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "module_group" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "module_group"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

-- ── Module Group Member (Bitemporal) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "module_group_member" (
  "version_id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                  uuid        NOT NULL,
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant"("id"),
  "module_group_id"     uuid        NOT NULL,
  "module_id"           uuid        NOT NULL,
  "is_default"          boolean     NOT NULL DEFAULT false,
  "is_non_condonable"   boolean     NOT NULL DEFAULT false,
  "valid_from"          timestamptz NOT NULL,
  "valid_to"            timestamptz,
  "recorded_at"         timestamptz NOT NULL DEFAULT now(),
  "recorded_until"      timestamptz,
  CONSTRAINT "module_group_member_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "module_group_member_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "module_group_member_unique_logical_transaction"
  ON "module_group_member" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "module_group_member_current_version_unique"
  ON "module_group_member" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

CREATE INDEX IF NOT EXISTS "module_group_member_group_idx"
  ON "module_group_member" ("tenant_id", "module_group_id")
  WHERE recorded_until IS NULL;

ALTER TABLE "module_group_member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "module_group_member" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "module_group_member"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

-- ── Enrolment Curriculum Binding (Bitemporal) ─────────────────────────────────
-- Explicit, fixed binding of an enrolment to the route/rule-set version that
-- governs its module choices, progression and award (BP-03-002 OQ-1).
CREATE TABLE IF NOT EXISTS "enrolment_curriculum_binding" (
  "version_id"             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                     uuid        NOT NULL,
  "tenant_id"              uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"           uuid        NOT NULL,
  "programme_route_id"     uuid,
  "programme_rule_set_id"  uuid        NOT NULL,
  "decision_authority_code" text       NOT NULL
                              CHECK ("decision_authority_code" IN ('automatic','registry-administrator','academic-approver')),
  "decision_reason"        text,
  "valid_from"             timestamptz NOT NULL,
  "valid_to"               timestamptz,
  "recorded_at"            timestamptz NOT NULL DEFAULT now(),
  "recorded_until"         timestamptz,
  CONSTRAINT "enrolment_curriculum_binding_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "enrolment_curriculum_binding_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "enrolment_curriculum_binding_unique_logical_transaction"
  ON "enrolment_curriculum_binding" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "enrolment_curriculum_binding_current_version_unique"
  ON "enrolment_curriculum_binding" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

CREATE INDEX IF NOT EXISTS "enrolment_curriculum_binding_enrolment_idx"
  ON "enrolment_curriculum_binding" ("tenant_id", "enrolment_id")
  WHERE recorded_until IS NULL;

ALTER TABLE "enrolment_curriculum_binding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "enrolment_curriculum_binding" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "enrolment_curriculum_binding"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

-- ── Module Selection Proposal (Bitemporal) ────────────────────────────────────
-- The draft/submitted/validated/approved lifecycle described in BP-03-003/004,
-- ahead of confirmation as durable module_registration rows.
CREATE TABLE IF NOT EXISTS "module_selection_proposal" (
  "version_id"              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                      uuid        NOT NULL,
  "tenant_id"               uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"            uuid        NOT NULL,
  "academic_period_id"      uuid        NOT NULL,
  "programme_rule_set_id"   uuid        NOT NULL,
  "status_code"             text        NOT NULL DEFAULT 'draft'
                              CHECK ("status_code" IN (
                                'draft','submitted','validated','approved',
                                'returned','waitlisted','rejected','confirmed'
                              )),
  "submitted_at"            timestamptz,
  "decided_at"              timestamptz,
  "decision_authority_code" text
                              CHECK ("decision_authority_code" IS NULL OR "decision_authority_code" IN (
                                'automatic','registry-administrator','programme-approver'
                              )),
  "decision_reason"         text,
  "workflow_instance_id"    uuid,
  "valid_from"              timestamptz NOT NULL,
  "valid_to"                timestamptz,
  "recorded_at"             timestamptz NOT NULL DEFAULT now(),
  "recorded_until"          timestamptz,
  CONSTRAINT "module_selection_proposal_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "module_selection_proposal_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "module_selection_proposal_unique_logical_transaction"
  ON "module_selection_proposal" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "module_selection_proposal_current_version_unique"
  ON "module_selection_proposal" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

CREATE INDEX IF NOT EXISTS "module_selection_proposal_enrolment_idx"
  ON "module_selection_proposal" ("tenant_id", "enrolment_id")
  WHERE recorded_until IS NULL;

CREATE INDEX IF NOT EXISTS "module_selection_proposal_status_idx"
  ON "module_selection_proposal" ("tenant_id", "status_code")
  WHERE recorded_until IS NULL;

ALTER TABLE "module_selection_proposal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "module_selection_proposal" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "module_selection_proposal"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

-- ── Module Selection Proposal Item ────────────────────────────────────────────
-- Not bitemporal: line items are freely edited while a proposal is in draft,
-- and re-validated in place. The durable, versioned record is module_registration,
-- created once the parent proposal reaches 'approved'/'confirmed'.
CREATE TABLE IF NOT EXISTS "module_selection_proposal_item" (
  "id"                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"              uuid        NOT NULL REFERENCES "tenant"("id"),
  "proposal_id"            uuid        NOT NULL,
  "module_id"               uuid        NOT NULL,
  "module_offering_id"     uuid,
  "preference_rank"        smallint,
  "source_code"            text        NOT NULL
                              CHECK ("source_code" IN ('compulsory-auto','student-choice','staff-assisted')),
  "validation_state_code"  text        NOT NULL DEFAULT 'pending'
                              CHECK ("validation_state_code" IN ('pending','passed','failed')),
  "validation_messages"    jsonb,
  "created_at"             timestamptz NOT NULL DEFAULT now(),
  "updated_at"             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "module_selection_proposal_item_proposal_idx"
  ON "module_selection_proposal_item" ("tenant_id", "proposal_id");

ALTER TABLE "module_selection_proposal_item" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "module_selection_proposal_item" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "module_selection_proposal_item"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Value sets

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('module-group-type-code', 'Module Group Type', 'srs-internal', 'Whether a module diet group is compulsory or a choice pool', false),
  ('curriculum-binding-decision-authority-code', 'Curriculum Binding Decision Authority', 'srs-internal', 'Who authorised an enrolment''s route/rule-set binding', false),
  ('module-selection-proposal-status-code', 'Module Selection Proposal Status', 'srs-internal', 'Lifecycle status of a module selection proposal', false),
  ('module-selection-item-source-code', 'Module Selection Item Source', 'srs-internal', 'How a proposed module choice was added', false),
  ('module-selection-item-validation-state-code', 'Module Selection Item Validation State', 'srs-internal', 'Outcome of rule validation for a proposed module choice', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, member.code, member.label, member.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('module-group-type-code', 'compulsory', 'Compulsory', 10),
  ('module-group-type-code', 'optional-pool', 'Optional pool', 20),
  ('module-group-type-code', 'elective-pool', 'Elective pool', 30),

  ('curriculum-binding-decision-authority-code', 'automatic', 'Automatic', 10),
  ('curriculum-binding-decision-authority-code', 'registry-administrator', 'Registry administrator', 20),
  ('curriculum-binding-decision-authority-code', 'academic-approver', 'Academic approver', 30),

  ('module-selection-proposal-status-code', 'draft', 'Draft', 10),
  ('module-selection-proposal-status-code', 'submitted', 'Submitted', 20),
  ('module-selection-proposal-status-code', 'validated', 'Validated', 30),
  ('module-selection-proposal-status-code', 'approved', 'Approved', 40),
  ('module-selection-proposal-status-code', 'returned', 'Returned', 50),
  ('module-selection-proposal-status-code', 'waitlisted', 'Waitlisted', 60),
  ('module-selection-proposal-status-code', 'rejected', 'Rejected', 70),
  ('module-selection-proposal-status-code', 'confirmed', 'Confirmed', 80),

  ('module-selection-item-source-code', 'compulsory-auto', 'Compulsory (automatic)', 10),
  ('module-selection-item-source-code', 'student-choice', 'Student choice', 20),
  ('module-selection-item-source-code', 'staff-assisted', 'Staff-assisted', 30),

  ('module-selection-item-validation-state-code', 'pending', 'Pending', 10),
  ('module-selection-item-validation-state-code', 'passed', 'Passed', 20),
  ('module-selection-item-validation-state-code', 'failed', 'Failed', 30)
) AS member(set_code, code, label, sort_order)
  ON member.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('module_group', 'group_type_code', 'module-group-type-code'),
  ('enrolment_curriculum_binding', 'decision_authority_code', 'curriculum-binding-decision-authority-code'),
  ('module_selection_proposal', 'status_code', 'module-selection-proposal-status-code'),
  ('module_selection_proposal_item', 'source_code', 'module-selection-item-source-code'),
  ('module_selection_proposal_item', 'validation_state_code', 'module-selection-item-validation-state-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Approval workflow for exception cases (BP-03-004 A5b): oversubscription,
-- non-standard diet, or a rule failure with an authorised override.

INSERT INTO "workflow_definition" (
  "definition_code",
  "display_name",
  "owner_module_code",
  "status_code",
  "current_version_number",
  "description",
  "created_by"
) VALUES (
  'module-selection-approval',
  'Module selection exception approval',
  'registration',
  'active',
  1,
  'Routes a module selection proposal to a programme or teaching-unit approver when automated validation cannot confirm it outright (oversubscription, non-standard diet, or an authorised rule exception).',
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
    'source', 'docs/business-processes/03-curriculum-and-module-registration/bp-03-004-validate-and-approve-module-selection.md',
    'decisionStepKey', 'approve-or-reject-selection',
    'decisionGatewayAuditTable', 'workflow_decision_audit'
  ),
  '2026-08-02T00:00:00Z'::timestamptz,
  'system'
FROM "workflow_definition" wd
WHERE wd."definition_code" = 'module-selection-approval'
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
  ('proposal-submitted', 'start', 'Proposal submitted', null, 10, '{}'),
  ('automated-validation', 'human-task', 'Automated rule validation', null, 20, '{"assignmentRulesRequired": false}'),
  ('approve-or-reject-selection', 'human-task', 'Programme or teaching-unit approval', 'programme-approver', 30, '{"assignmentRulesRequired": true}'),
  ('decision-gateway', 'decision', 'Selection decision gateway', 'programme-approver', 40, '{"auditTable": "workflow_decision_audit"}'),
  ('proposal-closed', 'end', 'Proposal workflow closed', null, 50, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'module-selection-approval'
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
  'Approve, reject, substitute or waitlist?',
  'exclusive',
  'bp-03-004-validate-and-approve-module-selection.md',
  jsonb_build_object(
    'bpmnGatewayId', 'G01',
    'ownerRole', 'Programme or Teaching Unit Approver',
    'policySource', 'Institutional module selection and approval policy'
  )
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
WHERE wd."definition_code" = 'module-selection-approval'
  AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;
