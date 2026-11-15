-- ============================================================
-- 0005_curriculum_regulatory_and_pgr
--
-- Module selection and registration, the regulatory-submission and legal
-- identity workflows, and the PGR lifecycle.
--
-- Squashed on 2026-11-15 from migrations 0005–0018, which follow as
-- sections in their original order and with their original text. Nothing
-- has been run in production, so the history carries no data obligations.
-- scripts/verify-migration-squash.sh checked that the squashed set yields
-- the same schema and seed data.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- Originally 0005_module_selection_rules.sql
-- ════════════════════════════════════════════════════════════

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


-- ════════════════════════════════════════════════════════════
-- Originally 0006_registration_window.sql
-- ════════════════════════════════════════════════════════════

-- Revelation SRS — Registration window enforcement
-- Migration: 0006_registration_window
--
-- Technical debt item: ModuleRegistrationService.createRegistration used to
-- call a #validateRegistrationWindow method that was removed during UAT
-- because the AUTUMN 2025 teaching period had passed. Tenant configuration
-- already carries a registrationWindowMode key (see
-- apps/api/test/tenant-admin.int.test.ts) that was never wired to any real
-- behaviour. This migration adds the missing registration_window table so
-- admins can set an explicit open/close window per academic period; the
-- service only enforces it when a tenant's configuration.registrationWindowMode
-- is 'academic-period', so tenants that leave it unset keep the previous
-- unrestricted behaviour.

CREATE TABLE IF NOT EXISTS "registration_window" (
  "id"                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"          uuid        NOT NULL REFERENCES "tenant"("id"),
  "academic_period_id" uuid        NOT NULL REFERENCES "academic_period"("id"),
  "opens_at"           timestamptz NOT NULL,
  "closes_at"          timestamptz NOT NULL,
  CONSTRAINT "registration_window_tenant_period_unique"
    UNIQUE ("tenant_id", "academic_period_id"),
  CONSTRAINT "registration_window_closes_after_opens"
    CHECK ("closes_at" > "opens_at")
);

CREATE INDEX IF NOT EXISTS "registration_window_tenant_period_idx"
  ON "registration_window" ("tenant_id", "academic_period_id");

ALTER TABLE "registration_window" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "registration_window" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "registration_window";
CREATE POLICY tenant_isolation ON "registration_window"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);


-- ════════════════════════════════════════════════════════════
-- Originally 0007_module_registration_change_workflow.sql
-- ════════════════════════════════════════════════════════════

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


-- ════════════════════════════════════════════════════════════
-- Originally 0008_slc_submission_approval_workflow.sql
-- ════════════════════════════════════════════════════════════

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


-- ════════════════════════════════════════════════════════════
-- Originally 0009_legal_identity_change_workflow.sql
-- ════════════════════════════════════════════════════════════

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


-- ════════════════════════════════════════════════════════════
-- Originally 0010_hesa_submission_approval_workflow.sql
-- ════════════════════════════════════════════════════════════

-- Revelation SRS — HESA student return submission approval workflow
-- Migration: 0010_hesa_submission_approval_workflow
--
-- Second regulatory-submission process converted to the workflow-gated
-- pattern established for SLC (0008_slc_submission_approval_workflow.sql).
-- Unlike SLC, HESA already has a persisted, stateful batch entity — the
-- hesa_student_return row and its status_code lifecycle — so the returnId
-- itself is the workflow subject; no trigger-ID snapshot is needed since a
-- return's records are already fixed at generation time.

INSERT INTO "workflow_definition" (
  "definition_code",
  "display_name",
  "owner_module_code",
  "status_code",
  "current_version_number",
  "description",
  "created_by"
) VALUES (
  'hesa-return-submission-approval',
  'HESA student return submission approval',
  'regulatory',
  'active',
  1,
  'Routes a validated HESA student return, with its submission file already generated, to a regulatory officer for approval before it is marked submitted.',
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
WHERE wd."definition_code" = 'hesa-return-submission-approval'
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
  ('return-ready', 'start', 'Return validated and file generated', null, 10, '{}'),
  ('approve-or-reject-submission', 'human-task', 'Regulatory officer approval', 'regulatory-officer', 20, '{"assignmentRulesRequired": true}'),
  ('decision-gateway', 'decision', 'Submission decision gateway', 'regulatory-officer', 30, '{"auditTable": "workflow_decision_audit"}'),
  ('request-closed', 'end', 'Submission workflow closed', null, 40, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'hesa-return-submission-approval'
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
  'Approve or reject the HESA return submission?',
  'exclusive',
  'packages/db/migrations/0010_hesa_submission_approval_workflow.sql',
  jsonb_build_object(
    'ownerRole', 'Regulatory Officer',
    'policySource', 'Institutional HESA return submission policy'
  )
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
WHERE wd."definition_code" = 'hesa-return-submission-approval'
  AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- Originally 0011_ofs_extract_generation_workflow.sql
-- ════════════════════════════════════════════════════════════

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


-- ════════════════════════════════════════════════════════════
-- Originally 0012_ucas_confirmation_submission_workflow.sql
-- ════════════════════════════════════════════════════════════

-- Revelation SRS — UCAS confirmation submission approval workflow
-- Migration: 0012_ucas_confirmation_submission_workflow
--
-- Continues the BPR-W12 rollout begun in 0008 (SLC), 0009 (legal identity
-- change), 0010 (HESA) and 0011 (OfS): converts the previously stateless
-- "generate outbound confirmations" call into a workflow-gated request/decide
-- pattern, following the exact same seed shape as
-- 0008_slc_submission_approval_workflow.sql.

INSERT INTO "workflow_definition" (
  "definition_code",
  "display_name",
  "owner_module_code",
  "status_code",
  "current_version_number",
  "description",
  "created_by"
) VALUES (
  'ucas-confirmation-submission-approval',
  'UCAS confirmation submission approval',
  'regulatory',
  'active',
  1,
  'Routes a batch of previewed UCAS enrolment confirmations to a regulatory officer for approval before they are transmitted, snapshotting the exact trigger set previewed so a later approval acts on what was actually reviewed.',
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
WHERE wd."definition_code" = 'ucas-confirmation-submission-approval'
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
WHERE wd."definition_code" = 'ucas-confirmation-submission-approval'
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
  'Approve or reject the UCAS confirmation batch?',
  'exclusive',
  'packages/db/migrations/0012_ucas_confirmation_submission_workflow.sql',
  jsonb_build_object(
    'ownerRole', 'Regulatory Officer',
    'policySource', 'Institutional UCAS confirmation submission policy'
  )
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
WHERE wd."definition_code" = 'ucas-confirmation-submission-approval'
  AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- Originally 0013_ukvi_cas_submission_workflow.sql
-- ════════════════════════════════════════════════════════════

-- Revelation SRS — UKVI CAS request submission approval workflow
-- Migration: 0013_ukvi_cas_submission_workflow
--
-- Final step of the BPR-W12 rollout begun in 0008 (SLC), 0009 (legal identity
-- change), 0010 (HESA), 0011 (OfS) and 0012 (UCAS): converts the previously
-- stateless "generate CAS requests" call into a workflow-gated request/decide
-- pattern, following the exact same seed shape as
-- 0008_slc_submission_approval_workflow.sql.

INSERT INTO "workflow_definition" (
  "definition_code",
  "display_name",
  "owner_module_code",
  "status_code",
  "current_version_number",
  "description",
  "created_by"
) VALUES (
  'ukvi-cas-request-submission-approval',
  'UKVI CAS request submission approval',
  'regulatory',
  'active',
  1,
  'Routes a batch of previewed UKVI CAS requests to a regulatory officer for approval before they are transmitted, snapshotting the exact trigger set previewed so a later approval acts on what was actually reviewed.',
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
WHERE wd."definition_code" = 'ukvi-cas-request-submission-approval'
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
  ('batch-previewed', 'start', 'CAS request batch previewed', null, 10, '{}'),
  ('approve-or-reject-submission', 'human-task', 'Regulatory officer approval', 'regulatory-officer', 20, '{"assignmentRulesRequired": true}'),
  ('decision-gateway', 'decision', 'Submission decision gateway', 'regulatory-officer', 30, '{"auditTable": "workflow_decision_audit"}'),
  ('request-closed', 'end', 'Submission workflow closed', null, 40, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'ukvi-cas-request-submission-approval'
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
  'Approve or reject the UKVI CAS request batch?',
  'exclusive',
  'packages/db/migrations/0013_ukvi_cas_submission_workflow.sql',
  jsonb_build_object(
    'ownerRole', 'Regulatory Officer',
    'policySource', 'Institutional UKVI CAS request submission policy'
  )
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
WHERE wd."definition_code" = 'ukvi-cas-request-submission-approval'
  AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- Originally 0014_pgr_foundation.sql
-- ════════════════════════════════════════════════════════════

-- Revelation SRS — PGR lifecycle foundation
-- Migration: 0014_pgr_foundation
--
-- Stage 0 of the PGR lifecycle build (ADR-023): seeds the shared vocabulary
-- and integration-contract registrations needed before any PGR schema lands.
-- PGR is built core-hosted, rooted on the existing business_case/case_decision
-- primitive (packages/db/src/schema/business-case.ts) — no new case/workflow
-- engine is introduced here.

-- ── Value set: PGR examination outcome (verbatim from docs/domain-glossary.md) ─

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible")
VALUES
  ('pgr-examination-outcome-code', 'PGR Examination Outcome', 'srs-internal', 'Outcome of a PGR thesis viva voce examination', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('pass',                     'Pass',                              10),
  ('pass-minor-corrections',   'Pass with minor corrections',       20),
  ('pass-major-corrections',   'Pass with major corrections',       30),
  ('resubmission',             'Resubmission',                      40),
  ('fail',                     'Fail',                              50)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'pgr-examination-outcome-code'
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code")
VALUES
  ('pgr_examination_outcome', 'outcome_code', 'pgr-examination-outcome-code')
ON CONFLICT DO NOTHING;

-- ── Integration contracts: HR and CRIS boundaries (BP-03-007, BP-04-003) ──────
-- Seeded now for completeness/documentation; research-proposal-eligibility.v1
-- is not built against until a concrete research-proposals consumer exists.

INSERT INTO "integration_contract" ("contract_id", "display_name", "owner_module_code", "direction_code", "pattern_type", "current_contract_version", "data_classification_code")
VALUES
  ('hr-staff-assignments.v1',        'HR Staff Assignments',              'pgr', 'inbound',       'api', '1.0.0', 'personal'),
  ('cris-pgr-profile.v1',            'CRIS PGR Profile',                  'pgr', 'outbound',      'api', '1.0.0', 'personal'),
  ('cris-pgr-milestones.v1',         'CRIS PGR Milestones',               'pgr', 'bidirectional', 'api', '1.0.0', 'personal'),
  ('research-proposal-eligibility.v1','Research Proposal Eligibility',    'pgr', 'outbound',      'api', '1.0.0', 'personal')
ON CONFLICT ("contract_id") DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- Originally 0015_pgr_supervision.sql
-- ════════════════════════════════════════════════════════════

-- Revelation SRS — PGR supervision and research context
-- Migration: 0015_pgr_supervision
--
-- Stage 1 of the PGR lifecycle build (BP-03-007, BPR-D07 part 1). Per
-- ADR-023, pgr_supervision_case extends the shared business_case primitive
-- (0004_business_process_foundations) via business_case_id rather than
-- re-implementing case status/ownership. staff_assignment is the durable,
-- bitemporal effect of an approved case: a change of supervisor end-dates
-- the superseded assignment and creates a new one, never overwriting history.

CREATE TABLE "pgr_supervision_case" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "business_case_id" uuid NOT NULL,
  "enrolment_id" uuid NOT NULL,
  "degree_aim" text,
  "research_area" text,
  "school_owner" text,
  "intended_start_date" date,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "pgr_supervision_case_business_case_idx"
  ON "pgr_supervision_case" ("tenant_id", "business_case_id");
CREATE INDEX "pgr_supervision_case_enrolment_idx"
  ON "pgr_supervision_case" ("tenant_id", "enrolment_id");

ALTER TABLE "pgr_supervision_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pgr_supervision_case" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pgr_supervision_case"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Proposed nominees — working data only, never a source of current authority.

CREATE TABLE "pgr_supervisor_nomination" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "supervision_case_id" uuid NOT NULL REFERENCES "pgr_supervision_case"("id"),
  "person_id" uuid NOT NULL REFERENCES "person"("id"),
  "role_detail_code" text NOT NULL,
  "org_owner" text,
  "external_organisation" text,
  "contractual_status_code" text,
  "access_level_code" text,
  "eligibility_checked_at" timestamptz,
  "nominated_by" text NOT NULL,
  "nominated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "pgr_supervisor_nomination_case_idx"
  ON "pgr_supervisor_nomination" ("tenant_id", "supervision_case_id");

ALTER TABLE "pgr_supervisor_nomination" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pgr_supervisor_nomination" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pgr_supervisor_nomination"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "staff_assignment" (
  "version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id" uuid NOT NULL,
  "supervision_case_id" uuid NOT NULL REFERENCES "pgr_supervision_case"("id"),
  "person_id" uuid NOT NULL REFERENCES "person"("id"),
  "assignment_type_code" text NOT NULL,
  "role_detail_code" text NOT NULL,
  "org_owner" text,
  "external_organisation" text,
  "contractual_status_code" text,
  "access_level_code" text,
  "actor_id" text NOT NULL,
  "valid_from" timestamptz NOT NULL,
  "valid_to" timestamptz,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz,
  CONSTRAINT "staff_assignment_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "staff_assignment_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX "staff_assignment_unique_logical_transaction"
  ON "staff_assignment" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX "staff_assignment_current_version_unique"
  ON "staff_assignment" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

CREATE INDEX "staff_assignment_enrolment_idx"
  ON "staff_assignment" ("tenant_id", "enrolment_id")
  WHERE recorded_until IS NULL;
CREATE INDEX "staff_assignment_supervision_case_idx"
  ON "staff_assignment" ("tenant_id", "supervision_case_id");

ALTER TABLE "staff_assignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_assignment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "staff_assignment"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Value sets

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('pgr-supervisor-role-code', 'PGR Supervisor Role', 'srs-internal', 'Role of a supervisor within a PGR supervisory team', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('principal',  'Principal supervisor',  10),
  ('additional', 'Additional supervisor',  20),
  ('external',   'External supervisor',    30)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'pgr-supervisor-role-code'
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code")
VALUES
  ('staff_assignment', 'assignment_type_code', 'staff-assignment-type'),
  ('staff_assignment', 'role_detail_code',     'pgr-supervisor-role-code'),
  ('pgr_supervisor_nomination', 'role_detail_code', 'pgr-supervisor-role-code')
ON CONFLICT DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- Originally 0016_pgr_progress_review.sql
-- ════════════════════════════════════════════════════════════

-- Revelation SRS — PGR progress review and milestones
-- Migration: 0016_pgr_progress_review
--
-- Stage 2 of the PGR lifecycle build (BP-04-003, BPR-D07 part 2). Per
-- ADR-023, pgr_progress_review extends the shared business_case primitive —
-- each review (initial, annual, upgrade, return-from-interruption) is its
-- own case instance, not a version of a prior one. pgr_review_member
-- mirrors board_member_conflict's shape (0004_business_process_foundations)
-- for panel composition and conflict/recusal tracking. research_milestone
-- is append-only: an unsatisfactory outcome never alters candidature until
-- the case is decided, and a milestone is only published once a decision
-- exists.

CREATE TABLE "pgr_progress_review" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "business_case_id" uuid NOT NULL,
  "enrolment_id" uuid NOT NULL,
  "supervision_case_id" uuid REFERENCES "pgr_supervision_case"("id"),
  "review_type_code" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "pgr_progress_review_business_case_idx"
  ON "pgr_progress_review" ("tenant_id", "business_case_id");
CREATE INDEX "pgr_progress_review_enrolment_idx"
  ON "pgr_progress_review" ("tenant_id", "enrolment_id");

ALTER TABLE "pgr_progress_review" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pgr_progress_review" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pgr_progress_review"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "pgr_review_member" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "review_id" uuid NOT NULL REFERENCES "pgr_progress_review"("id"),
  "person_id" uuid NOT NULL REFERENCES "person"("id"),
  "role_code" text NOT NULL,
  "conflict_type_code" text,
  "declared_at" timestamptz,
  "recused_at" timestamptz,
  "added_by" text NOT NULL,
  "added_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "pgr_review_member_review_idx"
  ON "pgr_review_member" ("tenant_id", "review_id");

ALTER TABLE "pgr_review_member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pgr_review_member" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pgr_review_member"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "research_milestone" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id" uuid NOT NULL,
  "review_id" uuid REFERENCES "pgr_progress_review"("id"),
  "milestone_type_code" text NOT NULL,
  "achieved_date" date NOT NULL,
  "published_at" timestamptz,
  "actor_id" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "research_milestone_enrolment_idx"
  ON "research_milestone" ("tenant_id", "enrolment_id");

ALTER TABLE "research_milestone" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "research_milestone" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "research_milestone"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Value sets

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('pgr-review-type-code',        'PGR Review Type',         'srs-internal', 'Type of PGR progress review', false),
  ('pgr-review-member-role-code', 'PGR Review Member Role',   'srs-internal', 'Role of a member on a PGR progress-review panel', false),
  ('pgr-review-outcome-code',     'PGR Review Outcome',       'srs-internal', 'Outcome of a PGR progress review', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('pgr-review-type-code', 'initial',                     'Initial review',                 10),
  ('pgr-review-type-code', 'annual',                      'Annual review',                  20),
  ('pgr-review-type-code', 'upgrade',                      'Upgrade / confirmation review',  30),
  ('pgr-review-type-code', 'return-from-interruption',     'Return-from-interruption review',40),

  ('pgr-review-member-role-code', 'chair',                'Chair',                10),
  ('pgr-review-member-role-code', 'independent-reviewer', 'Independent reviewer', 20),
  ('pgr-review-member-role-code', 'panel-member',         'Panel member',         30),

  ('pgr-review-outcome-code', 'satisfactory', 'Satisfactory progress', 10),
  ('pgr-review-outcome-code', 'conditions',   'Conditions set',        20),
  ('pgr-review-outcome-code', 'referral',     'Referral',              30),
  ('pgr-review-outcome-code', 'transfer',     'Transfer',              40),
  ('pgr-review-outcome-code', 'escalation',   'Escalation',            50)
) AS v(set_code, code, display_label, sort_order)
  ON v.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code")
VALUES
  ('pgr_progress_review', 'review_type_code',    'pgr-review-type-code'),
  ('pgr_review_member',   'role_code',            'pgr-review-member-role-code'),
  ('pgr_review_member',   'conflict_type_code',   'board-conflict-type-code'),
  ('research_milestone',  'milestone_type_code',  'research-milestone-type')
ON CONFLICT DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- Originally 0017_pgr_thesis_examination.sql
-- ════════════════════════════════════════════════════════════

-- Revelation SRS — PGR thesis submission and examination
-- Migration: 0017_pgr_thesis_examination
--
-- Stage 3 of the PGR lifecycle build (BP-05-010, BPR-D12). Per ADR-023,
-- pgr_examination_case extends the shared business_case primitive. Follows
-- ADR-020's staged-authority pattern: immutable submitted thesis version
-- (thesis_submission, append-only) -> examiner nomination and chair
-- approval -> examiner reports (append-only) -> viva (viva_event) ->
-- ratified, immutable outcome (pgr_examination_outcome, append-only — the
-- outcome value set was already seeded in 0014_pgr_foundation). Corrections
-- are deadlined follow-up requirements linked to the ratified outcome,
-- never an edit to it.

CREATE TABLE "pgr_examination_case" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "business_case_id" uuid NOT NULL,
  "enrolment_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "pgr_examination_case_business_case_idx"
  ON "pgr_examination_case" ("tenant_id", "business_case_id");
CREATE INDEX "pgr_examination_case_enrolment_idx"
  ON "pgr_examination_case" ("tenant_id", "enrolment_id");

ALTER TABLE "pgr_examination_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pgr_examination_case" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pgr_examination_case"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "thesis_submission" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "examination_case_id" uuid NOT NULL REFERENCES "pgr_examination_case"("id"),
  "version_number" integer NOT NULL,
  "format_code" text NOT NULL,
  "declaration_confirmed" boolean NOT NULL,
  "restricted" boolean NOT NULL DEFAULT false,
  "restriction_reason_text" text,
  "restriction_review_date" date,
  "storage_ref" text NOT NULL,
  "submitted_by" text NOT NULL,
  "submitted_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "thesis_submission_case_version_unique"
  ON "thesis_submission" ("tenant_id", "examination_case_id", "version_number");

ALTER TABLE "thesis_submission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "thesis_submission" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "thesis_submission"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "examiner_appointment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "examination_case_id" uuid NOT NULL REFERENCES "pgr_examination_case"("id"),
  "person_id" uuid NOT NULL REFERENCES "person"("id"),
  "examiner_role_code" text NOT NULL,
  "independence_checked_at" timestamptz,
  "conflict_type_code" text,
  "recused_at" timestamptz,
  "confirmed_at" timestamptz,
  "nominated_by" text NOT NULL,
  "nominated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "examiner_appointment_case_idx"
  ON "examiner_appointment" ("tenant_id", "examination_case_id");

ALTER TABLE "examiner_appointment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "examiner_appointment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "examiner_appointment"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "examiner_report" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "examination_case_id" uuid NOT NULL REFERENCES "pgr_examination_case"("id"),
  "examiner_appointment_id" uuid NOT NULL REFERENCES "examiner_appointment"("id"),
  "report_ref" text NOT NULL,
  "recommendation_code" text,
  "submitted_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "examiner_report_case_idx"
  ON "examiner_report" ("tenant_id", "examination_case_id");

ALTER TABLE "examiner_report" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "examiner_report" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "examiner_report"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "viva_event" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "examination_case_id" uuid NOT NULL REFERENCES "pgr_examination_case"("id"),
  "held_at" timestamptz NOT NULL,
  "joint_recommendation_text" text NOT NULL,
  "recorded_by" text NOT NULL,
  "recorded_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "viva_event_case_idx"
  ON "viva_event" ("tenant_id", "examination_case_id");

ALTER TABLE "viva_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "viva_event" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "viva_event"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "pgr_examination_outcome" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "examination_case_id" uuid NOT NULL REFERENCES "pgr_examination_case"("id"),
  "outcome_code" text NOT NULL,
  "decided_by" text NOT NULL,
  "decided_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "pgr_examination_outcome_case_idx"
  ON "pgr_examination_outcome" ("tenant_id", "examination_case_id");

ALTER TABLE "pgr_examination_outcome" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pgr_examination_outcome" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pgr_examination_outcome"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "thesis_correction_requirement" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "outcome_id" uuid NOT NULL REFERENCES "pgr_examination_outcome"("id"),
  "deadline_date" date NOT NULL,
  "completed_at" timestamptz,
  "completed_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "thesis_correction_requirement_outcome_idx"
  ON "thesis_correction_requirement" ("tenant_id", "outcome_id");

ALTER TABLE "thesis_correction_requirement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "thesis_correction_requirement" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "thesis_correction_requirement"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Value sets

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('pgr-thesis-format-code', 'PGR Thesis Format',  'srs-internal', 'Format of a submitted PGR thesis', false),
  ('pgr-examiner-role-code', 'PGR Examiner Role',  'srs-internal', 'Role of an examiner on a PGR examination case', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('pgr-thesis-format-code', 'traditional',     'Traditional thesis',        10),
  ('pgr-thesis-format-code', 'practice-based',  'Practice-based submission', 20),
  ('pgr-thesis-format-code', 'published-work',  'Published-work submission', 30),

  ('pgr-examiner-role-code', 'internal', 'Internal examiner', 10),
  ('pgr-examiner-role-code', 'external', 'External examiner', 20)
) AS v(set_code, code, display_label, sort_order)
  ON v.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code")
VALUES
  ('thesis_submission',    'format_code',          'pgr-thesis-format-code'),
  ('examiner_appointment', 'examiner_role_code',   'pgr-examiner-role-code'),
  ('examiner_appointment', 'conflict_type_code',   'board-conflict-type-code'),
  ('examiner_report',      'recommendation_code',  'pgr-examination-outcome-code')
ON CONFLICT DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- Originally 0018_pgr_completion_and_research_award.sql
-- ════════════════════════════════════════════════════════════

-- Revelation SRS — PGR completion and research award conferral
-- Migration: 0018_pgr_completion_and_research_award
--
-- Stage 4 of the PGR lifecycle build (BP-06-006, BPR-D14). Per ADR-023,
-- pgr_completion_case extends the shared business_case primitive and links
-- back to the examination case whose ratified, corrections-complete
-- outcome authorises completion. final_thesis_deposit confirms repository
-- deposit and IP declarations — a missing deposit holds completion.
--
-- The award table is additively relaxed so a research award can be
-- conferred without a taught exam board: exam_board_id becomes nullable
-- and a new source_case_id column (the PGR completion case) is added for
-- research awards. Exactly one of the two is populated per award.

CREATE TABLE "pgr_completion_case" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "business_case_id" uuid NOT NULL,
  "enrolment_id" uuid NOT NULL,
  "examination_case_id" uuid NOT NULL REFERENCES "pgr_examination_case"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "pgr_completion_case_business_case_idx"
  ON "pgr_completion_case" ("tenant_id", "business_case_id");
CREATE INDEX "pgr_completion_case_enrolment_idx"
  ON "pgr_completion_case" ("tenant_id", "enrolment_id");

ALTER TABLE "pgr_completion_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pgr_completion_case" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pgr_completion_case"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "final_thesis_deposit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "completion_case_id" uuid NOT NULL REFERENCES "pgr_completion_case"("id"),
  "deposit_ref" text NOT NULL,
  "ip_declaration_confirmed" boolean NOT NULL,
  "confirmed_by" text NOT NULL,
  "confirmed_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "final_thesis_deposit_completion_case_idx"
  ON "final_thesis_deposit" ("tenant_id", "completion_case_id");

ALTER TABLE "final_thesis_deposit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "final_thesis_deposit" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "final_thesis_deposit"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Additive relaxation of "award" for research (PGR) awards

ALTER TABLE "award" ALTER COLUMN "exam_board_id" DROP NOT NULL;
ALTER TABLE "award" ADD COLUMN "source_case_id" uuid;

ALTER TABLE "award"
  ADD CONSTRAINT "award_exactly_one_authority"
    CHECK (num_nonnulls("exam_board_id", "source_case_id") = 1);
