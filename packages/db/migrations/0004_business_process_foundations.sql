-- ============================================================
-- Originally: 0044_business_case_foundations.sql
-- ============================================================

-- Revelation SRS — Shared business-case/evidence/decision/distribution primitives
-- Migration: 0044_business_case_foundations
--
-- Stage 0 of the business-process P0 backlog (docs/business-processes/
-- revelation-change-backlog.md, docs/architecture/business-process-target-data-model.md
-- "Shared primitives"). Every later P0 domain migration (CAS, support outcome,
-- assessment moderation, board authority, correction, regulatory, identity,
-- rights, audit) builds on these seven tables. Purely additive: no existing
-- table is altered or dropped.

CREATE TABLE "business_case" (
  "version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "subject_type" text NOT NULL,
  "subject_id" uuid NOT NULL,
  "process_id" text NOT NULL,
  "status_code" text NOT NULL,
  "owner_id" text NOT NULL,
  "actor_id" text NOT NULL,
  "valid_from" timestamptz NOT NULL,
  "valid_to" timestamptz,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz
);

CREATE UNIQUE INDEX "business_case_unique_logical_transaction"
  ON "business_case" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX "business_case_current_version_unique"
  ON "business_case" ("tenant_id", "id") WHERE "recorded_until" IS NULL;
CREATE INDEX "business_case_subject_idx"
  ON "business_case" ("tenant_id", "subject_type", "subject_id");
CREATE INDEX "business_case_process_idx"
  ON "business_case" ("tenant_id", "process_id");

ALTER TABLE "business_case"
  ADD CONSTRAINT "business_case_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  ADD CONSTRAINT "business_case_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at);

ALTER TABLE "business_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_case" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "business_case"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "case_evidence_reference" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "business_case_id" uuid NOT NULL,
  "evidence_ref" text NOT NULL,
  "classification_code" text NOT NULL,
  "source_system" text NOT NULL,
  "source_reference" text,
  "content_hash" text,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "received_by" text NOT NULL
);

CREATE INDEX "case_evidence_reference_case_idx"
  ON "case_evidence_reference" ("tenant_id", "business_case_id");

ALTER TABLE "case_evidence_reference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "case_evidence_reference" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "case_evidence_reference"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "case_decision" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "business_case_id" uuid NOT NULL,
  "decision_type_code" text NOT NULL,
  "authority_actor_id" text NOT NULL,
  "policy_version" text,
  "reason_code" text,
  "reason_text" text,
  "effective_at" timestamptz NOT NULL,
  "decided_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "case_decision_case_idx"
  ON "case_decision" ("tenant_id", "business_case_id");

ALTER TABLE "case_decision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "case_decision" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "case_decision"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "source_version_reference" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "case_decision_id" uuid,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "version_id" uuid NOT NULL,
  "purpose_code" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "source_version_reference_decision_idx"
  ON "source_version_reference" ("tenant_id", "case_decision_id");
CREATE INDEX "source_version_reference_entity_idx"
  ON "source_version_reference" ("tenant_id", "entity_type", "entity_id");

ALTER TABLE "source_version_reference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "source_version_reference" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "source_version_reference"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "distribution_item" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "source_decision_id" uuid,
  "target_system_code" text NOT NULL,
  "content_ref" text NOT NULL,
  "status_code" text NOT NULL DEFAULT 'pending',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "distribution_item_decision_idx"
  ON "distribution_item" ("tenant_id", "source_decision_id");
CREATE INDEX "distribution_item_status_idx"
  ON "distribution_item" ("tenant_id", "status_code");

ALTER TABLE "distribution_item" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "distribution_item" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "distribution_item"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "distribution_attempt" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "distribution_item_id" uuid NOT NULL,
  "attempted_at" timestamptz NOT NULL DEFAULT now(),
  "transport_code" text NOT NULL,
  "payload_hash" text,
  "response_code" text,
  "error_detail" text
);

CREATE INDEX "distribution_attempt_item_idx"
  ON "distribution_attempt" ("tenant_id", "distribution_item_id");

ALTER TABLE "distribution_attempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "distribution_attempt" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "distribution_attempt"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "distribution_acknowledgement" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "distribution_item_id" uuid NOT NULL,
  "acknowledged_at" timestamptz NOT NULL DEFAULT now(),
  "result_code" text NOT NULL,
  "reconciliation_ref" text,
  "detail" jsonb
);

CREATE INDEX "distribution_acknowledgement_item_idx"
  ON "distribution_acknowledgement" ("tenant_id", "distribution_item_id");

ALTER TABLE "distribution_acknowledgement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "distribution_acknowledgement" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "distribution_acknowledgement"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Value sets

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('business-case-status-code', 'Business Case Status', 'srs-internal', 'Lifecycle status of a governed business-case instance', true),
  ('case-evidence-classification-code', 'Case Evidence Classification', 'srs-internal', 'Sensitivity classification of an opaque evidence reference', false),
  ('distribution-item-status-code', 'Distribution Item Status', 'srs-internal', 'Delivery status of a durable distribution target item', false),
  ('distribution-acknowledgement-result-code', 'Distribution Acknowledgement Result', 'srs-internal', 'Outcome of a target system acknowledging a distribution item', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, member.code, member.label, member.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('business-case-status-code', 'open', 'Open', 10),
  ('business-case-status-code', 'under-review', 'Under review', 20),
  ('business-case-status-code', 'decided', 'Decided', 30),
  ('business-case-status-code', 'closed', 'Closed', 40),
  ('business-case-status-code', 'withdrawn', 'Withdrawn', 50),

  ('case-evidence-classification-code', 'restricted-case', 'Restricted case evidence', 10),
  ('case-evidence-classification-code', 'sensitive-academic', 'Sensitive academic evidence', 20),
  ('case-evidence-classification-code', 'regulatory', 'Regulatory evidence', 30),
  ('case-evidence-classification-code', 'personal', 'Personal evidence', 40),
  ('case-evidence-classification-code', 'operational', 'Operational evidence', 50),

  ('distribution-item-status-code', 'pending', 'Pending', 10),
  ('distribution-item-status-code', 'sent', 'Sent', 20),
  ('distribution-item-status-code', 'acknowledged', 'Acknowledged', 30),
  ('distribution-item-status-code', 'failed', 'Failed', 40),
  ('distribution-item-status-code', 'superseded', 'Superseded', 50),

  ('distribution-acknowledgement-result-code', 'applied', 'Applied', 10),
  ('distribution-acknowledgement-result-code', 'rejected', 'Rejected', 20),
  ('distribution-acknowledgement-result-code', 'reconciled', 'Reconciled', 30),
  ('distribution-acknowledgement-result-code', 'mismatch', 'Mismatch', 40)
) AS member(set_code, code, label, sort_order)
  ON member.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('business_case', 'status_code', 'business-case-status-code'),
  ('case_evidence_reference', 'classification_code', 'case-evidence-classification-code'),
  ('distribution_item', 'status_code', 'distribution-item-status-code'),
  ('distribution_acknowledgement', 'result_code', 'distribution-acknowledgement-result-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;


-- ============================================================
-- Originally: 0045_cas_governance.sql
-- ============================================================

-- Revelation SRS — CAS governance (BPR-D03)
-- Migration: 0045_cas_governance
--
-- Stage 1 of the business-process P0 backlog. ukvi_cas_request is a
-- separate table; cas_case is a separate governed aggregate. Adds the eligibility-check,
-- assignment-version and sponsor-report-version evidence trail the legacy
-- table never captured.

CREATE TABLE "cas_case" (
  "version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id" uuid NOT NULL,
  "cas_reference" text,
  "status_code" text NOT NULL DEFAULT 'opened',
  "actor_id" text NOT NULL,
  "valid_from" timestamptz NOT NULL,
  "valid_to" timestamptz,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz
);

CREATE UNIQUE INDEX "cas_case_unique_logical_transaction"
  ON "cas_case" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX "cas_case_current_version_unique"
  ON "cas_case" ("tenant_id", "id") WHERE "recorded_until" IS NULL;
CREATE INDEX "cas_case_enrolment_idx"
  ON "cas_case" ("tenant_id", "enrolment_id");

ALTER TABLE "cas_case"
  ADD CONSTRAINT "cas_case_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  ADD CONSTRAINT "cas_case_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at);

ALTER TABLE "cas_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cas_case" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cas_case"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "cas_eligibility_check" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "cas_case_id" uuid NOT NULL,
  "guidance_version" text NOT NULL,
  "check_type_code" text NOT NULL,
  "result_code" text NOT NULL,
  "evidence_ref" uuid,
  "checked_by" text NOT NULL,
  "checked_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "cas_eligibility_check_case_idx"
  ON "cas_eligibility_check" ("tenant_id", "cas_case_id");

ALTER TABLE "cas_eligibility_check" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cas_eligibility_check" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cas_eligibility_check"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "cas_assignment_version" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "cas_case_id" uuid NOT NULL,
  "version_number" integer NOT NULL,
  "assigned_payload_hash" text NOT NULL,
  "cas_number" text,
  "approved_by" text NOT NULL,
  "approved_at" timestamptz NOT NULL DEFAULT now(),
  "sms_request_sent_at" timestamptz,
  "sms_receipt_ref" text
);

CREATE UNIQUE INDEX "cas_assignment_version_case_version_unique"
  ON "cas_assignment_version" ("tenant_id", "cas_case_id", "version_number");

ALTER TABLE "cas_assignment_version" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cas_assignment_version" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cas_assignment_version"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "sponsor_report_version" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "cas_case_id" uuid NOT NULL,
  "report_payload_ref" text NOT NULL,
  "distribution_item_id" uuid,
  "generated_at" timestamptz NOT NULL DEFAULT now(),
  "generated_by" text NOT NULL
);

CREATE INDEX "sponsor_report_version_case_idx"
  ON "sponsor_report_version" ("tenant_id", "cas_case_id");

ALTER TABLE "sponsor_report_version" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sponsor_report_version" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sponsor_report_version"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Value sets

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('cas-case-status-code', 'CAS Case Status', 'srs-internal', 'Lifecycle status of a governed CAS case', false),
  ('cas-eligibility-check-type-code', 'CAS Eligibility Check Type', 'srs-internal', 'Type of eligibility check performed on a CAS case', true),
  ('cas-eligibility-result-code', 'CAS Eligibility Result', 'srs-internal', 'Outcome of a CAS eligibility check', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, member.code, member.label, member.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('cas-case-status-code', 'opened', 'Opened', 10),
  ('cas-case-status-code', 'eligibility-checked', 'Eligibility checked', 20),
  ('cas-case-status-code', 'assigned', 'Assigned', 30),
  ('cas-case-status-code', 'withdrawn', 'Withdrawn', 40),
  ('cas-case-status-code', 'closed', 'Closed', 50),

  ('cas-eligibility-check-type-code', 'genuine-student', 'Genuine student requirement', 10),
  ('cas-eligibility-check-type-code', 'academic-progress', 'Academic progress', 20),
  ('cas-eligibility-check-type-code', 'financial-requirement', 'Financial requirement', 30),
  ('cas-eligibility-check-type-code', 'immigration-history', 'Immigration history', 40),

  ('cas-eligibility-result-code', 'pass', 'Pass', 10),
  ('cas-eligibility-result-code', 'fail', 'Fail', 20),
  ('cas-eligibility-result-code', 'referred', 'Referred for review', 30)
) AS member(set_code, code, label, sort_order)
  ON member.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('cas_case', 'status_code', 'cas-case-status-code'),
  ('cas_eligibility_check', 'check_type_code', 'cas-eligibility-check-type-code'),
  ('cas_eligibility_check', 'result_code', 'cas-eligibility-result-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;


-- ============================================================
-- Originally: 0046_support_outcome_distribution.sql
-- ============================================================

-- Revelation SRS — Support-outcome distribution (BPR-D09)
-- Migration: 0046_support_outcome_distribution
--
-- Stage 2 of the business-process P0 backlog. adjustment_distribution stays
-- as the legacy compat path. support_outcome is the new minimum-necessary
-- outcome record, optionally sourced from a business_case/case_decision
-- (migration 0044) and optionally bridged from a legacy reasonable_adjustment.
-- Per-target delivery uses the shared distribution_item primitives rather
-- than a flat status column.

CREATE TABLE "support_outcome" (
  "version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id" uuid NOT NULL,
  "source_case_id" uuid,
  "source_decision_id" uuid,
  "outcome_type_code" text NOT NULL,
  "minimum_necessary_text" text NOT NULL,
  "visibility_scope_code" text NOT NULL,
  "actor_id" text NOT NULL,
  "valid_from" timestamptz NOT NULL,
  "valid_to" timestamptz,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz
);

CREATE UNIQUE INDEX "support_outcome_unique_logical_transaction"
  ON "support_outcome" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX "support_outcome_current_version_unique"
  ON "support_outcome" ("tenant_id", "id") WHERE "recorded_until" IS NULL;
CREATE INDEX "support_outcome_enrolment_idx"
  ON "support_outcome" ("tenant_id", "enrolment_id");

ALTER TABLE "support_outcome"
  ADD CONSTRAINT "support_outcome_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  ADD CONSTRAINT "support_outcome_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at);

ALTER TABLE "support_outcome" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "support_outcome" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "support_outcome"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Value sets

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('support-outcome-type-code', 'Support Outcome Type', 'srs-internal', 'Type of minimum-necessary support outcome recorded for a student', true),
  ('support-outcome-visibility-scope-code', 'Support Outcome Visibility Scope', 'srs-internal', 'Who a support outcome is visible to downstream', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, member.code, member.label, member.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('support-outcome-type-code', 'extra-time', 'Extra time', 10),
  ('support-outcome-type-code', 'separate-room', 'Separate room', 20),
  ('support-outcome-type-code', 'deadline-extension', 'Deadline extension', 30),
  ('support-outcome-type-code', 'reader', 'Reader', 40),
  ('support-outcome-type-code', 'scribe', 'Scribe', 50),
  ('support-outcome-type-code', 'rest-breaks', 'Rest breaks', 60),

  ('support-outcome-visibility-scope-code', 'module-tutor', 'Module tutor', 10),
  ('support-outcome-visibility-scope-code', 'exam-officer', 'Exam officer', 20),
  ('support-outcome-visibility-scope-code', 'programme-team', 'Programme team', 30),
  ('support-outcome-visibility-scope-code', 'all-authorised-staff', 'All authorised staff', 40)
) AS member(set_code, code, label, sort_order)
  ON member.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('support_outcome', 'outcome_type_code', 'support-outcome-type-code'),
  ('support_outcome', 'visibility_scope_code', 'support-outcome-visibility-scope-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;


-- ============================================================
-- Originally: 0047_assessment_moderation.sql
-- ============================================================

-- Revelation SRS — Assessment candidate attempt & moderation (BPR-D10)
-- Migration: 0047_assessment_moderation
--
-- Stage 3 of the business-process P0 backlog. mark.attempt_number stays as
-- the legacy source column; assessment_candidate_attempt gives moderation a
-- stable attempt identity that survives a mark being superseded.

CREATE TABLE "assessment_candidate_attempt" (
  "version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "module_registration_id" uuid NOT NULL,
  "assessment_component_id" uuid NOT NULL,
  "attempt_number" integer NOT NULL,
  "attempt_type_code" text NOT NULL,
  "created_from_mark_id" uuid,
  "actor_id" text NOT NULL,
  "valid_from" timestamptz NOT NULL,
  "valid_to" timestamptz,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz
);

CREATE UNIQUE INDEX "assessment_candidate_attempt_unique_logical_transaction"
  ON "assessment_candidate_attempt" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX "assessment_candidate_attempt_current_version_unique"
  ON "assessment_candidate_attempt" ("tenant_id", "id") WHERE "recorded_until" IS NULL;
CREATE INDEX "assessment_candidate_attempt_registration_idx"
  ON "assessment_candidate_attempt" ("tenant_id", "module_registration_id", "assessment_component_id");

ALTER TABLE "assessment_candidate_attempt"
  ADD CONSTRAINT "assessment_candidate_attempt_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  ADD CONSTRAINT "assessment_candidate_attempt_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at);

ALTER TABLE "assessment_candidate_attempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_candidate_attempt" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "assessment_candidate_attempt"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "mark_set" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "assessment_component_id" uuid NOT NULL,
  "generated_at" timestamptz NOT NULL DEFAULT now(),
  "generated_by" text NOT NULL,
  "source_query_hash" text NOT NULL
);

CREATE INDEX "mark_set_component_idx"
  ON "mark_set" ("tenant_id", "assessment_component_id");

ALTER TABLE "mark_set" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mark_set" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "mark_set"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "mark_set_member" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "mark_set_id" uuid NOT NULL,
  "mark_id" uuid NOT NULL,
  "candidate_attempt_id" uuid NOT NULL
);

CREATE INDEX "mark_set_member_set_idx"
  ON "mark_set_member" ("tenant_id", "mark_set_id");
CREATE UNIQUE INDEX "mark_set_member_unique"
  ON "mark_set_member" ("tenant_id", "mark_set_id", "mark_id");

ALTER TABLE "mark_set_member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mark_set_member" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "mark_set_member"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "moderation_review" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "mark_set_id" uuid NOT NULL,
  "moderator_actor_id" text NOT NULL,
  "rule_version" text NOT NULL,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "outcome_code" text
);

CREATE INDEX "moderation_review_mark_set_idx"
  ON "moderation_review" ("tenant_id", "mark_set_id");

ALTER TABLE "moderation_review" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "moderation_review" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "moderation_review"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "moderation_sample" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "moderation_review_id" uuid NOT NULL,
  "mark_id" uuid NOT NULL,
  "sample_reason_code" text NOT NULL,
  "original_mark" numeric(5,2) NOT NULL,
  "moderated_mark" numeric(5,2),
  "change_reason_code" text
);

CREATE INDEX "moderation_sample_review_idx"
  ON "moderation_sample" ("tenant_id", "moderation_review_id");

ALTER TABLE "moderation_sample" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "moderation_sample" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "moderation_sample"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Value sets

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('candidate-attempt-type-code', 'Candidate Attempt Type', 'srs-internal', 'Nature of an assessment attempt', false),
  ('moderation-outcome-code', 'Moderation Outcome', 'srs-internal', 'Outcome of a moderation review', false),
  ('moderation-sample-reason-code', 'Moderation Sample Reason', 'srs-internal', 'Reason a mark was sampled for moderation', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, member.code, member.label, member.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('candidate-attempt-type-code', 'first-sit', 'First sit', 10),
  ('candidate-attempt-type-code', 'resit', 'Resit', 20),
  ('candidate-attempt-type-code', 'repeat', 'Repeat', 30),

  ('moderation-outcome-code', 'no-change', 'No change', 10),
  ('moderation-outcome-code', 'adjusted', 'Adjusted', 20),
  ('moderation-outcome-code', 'escalated', 'Escalated', 30),

  ('moderation-sample-reason-code', 'random', 'Random sample', 10),
  ('moderation-sample-reason-code', 'boundary', 'Boundary mark', 20),
  ('moderation-sample-reason-code', 'first-marker-flag', 'First-marker flagged', 30),
  ('moderation-sample-reason-code', 'outlier', 'Statistical outlier', 40)
) AS member(set_code, code, label, sort_order)
  ON member.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('assessment_candidate_attempt', 'attempt_type_code', 'candidate-attempt-type-code'),
  ('moderation_review', 'outcome_code', 'moderation-outcome-code'),
  ('moderation_sample', 'sample_reason_code', 'moderation-sample-reason-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;


-- ============================================================
-- Originally: 0048_board_authority_ratification.sql
-- ============================================================

-- Revelation SRS — Board authority & ratification (BPR-D11)
-- Migration: 0048_board_authority_ratification
--
-- Stage 4 of the business-process P0 backlog. exam_board.ratified_at and
-- quorum_count/quorum_recorded_at stay for compat. This migration adds the
-- structured decision/quorum/conflict/ratification/publication chain that
-- proves exactly which pack, rule set and quorum a ratification relied on.

ALTER TABLE "exam_board_data_pack"
  ADD COLUMN "pack_hash" text,
  ADD COLUMN "rule_manifest_ref" text;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "board_member_conflict" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "exam_board_id" uuid NOT NULL REFERENCES "exam_board"("id"),
  "actor_id" text NOT NULL,
  "enrolment_id" uuid,
  "conflict_type_code" text NOT NULL,
  "declared_at" timestamptz NOT NULL DEFAULT now(),
  "recused_at" timestamptz
);

CREATE INDEX "board_member_conflict_board_idx"
  ON "board_member_conflict" ("tenant_id", "exam_board_id");

ALTER TABLE "board_member_conflict" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "board_member_conflict" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "board_member_conflict"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "board_quorum_decision" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "exam_board_id" uuid NOT NULL REFERENCES "exam_board"("id"),
  "required_count" integer NOT NULL,
  "attending_count" integer NOT NULL,
  "quorum_met" boolean NOT NULL,
  "decided_by" text NOT NULL,
  "decided_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "board_quorum_decision_board_idx"
  ON "board_quorum_decision" ("tenant_id", "exam_board_id");

ALTER TABLE "board_quorum_decision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "board_quorum_decision" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "board_quorum_decision"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "exam_board_decision" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "exam_board_id" uuid NOT NULL REFERENCES "exam_board"("id"),
  "data_pack_id" uuid NOT NULL REFERENCES "exam_board_data_pack"("id"),
  "decision_type_code" text NOT NULL,
  "decided_by" text NOT NULL,
  "decided_at" timestamptz NOT NULL DEFAULT now(),
  "rationale" text
);

CREATE INDEX "exam_board_decision_board_idx"
  ON "exam_board_decision" ("tenant_id", "exam_board_id");

ALTER TABLE "exam_board_decision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exam_board_decision" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "exam_board_decision"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "ratification_record" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "exam_board_decision_id" uuid NOT NULL REFERENCES "exam_board_decision"("id"),
  "exam_board_id" uuid NOT NULL REFERENCES "exam_board"("id"),
  "ratified_at" timestamptz NOT NULL DEFAULT now(),
  "ratified_by" text NOT NULL
);

CREATE UNIQUE INDEX "ratification_record_decision_unique"
  ON "ratification_record" ("tenant_id", "exam_board_decision_id");

ALTER TABLE "ratification_record" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ratification_record" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ratification_record"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "result_publication" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "ratification_record_id" uuid NOT NULL REFERENCES "ratification_record"("id"),
  "status_code" text NOT NULL DEFAULT 'locked',
  "published_at" timestamptz,
  "published_by" text
);

CREATE UNIQUE INDEX "result_publication_ratification_unique"
  ON "result_publication" ("tenant_id", "ratification_record_id");

ALTER TABLE "result_publication" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "result_publication" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "result_publication"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Value sets
--
-- Note (found during this migration): migration 0027 added an
-- 'exam-board-type-code' value set (undergraduate/postgraduate-taught/...)
-- intending to replace 'board-type-code' (module/award) as the mapping for
-- exam_board.board_type_code, but its field_value_set INSERT used
-- ON CONFLICT DO NOTHING against a mapping 0005 had already created, so it
-- silently never took effect — 'board-type-code' (module/award) remains the
-- live mapping and matches what application code actually writes.
-- 'exam-board-type-code' is orphaned data, not touched here: changing which
-- value set governs a live field is a product decision outside this
-- migration's additive scope.

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('board-conflict-type-code', 'Board Member Conflict Type', 'srs-internal', 'Type of conflict of interest declared by a board member', true),
  ('board-decision-type-code', 'Exam Board Decision Type', 'srs-internal', 'Type of decision an exam board reached', false),
  ('result-publication-status-code', 'Result Publication Status', 'srs-internal', 'Publication lifecycle status of a ratified result set', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, member.code, member.label, member.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('board-conflict-type-code', 'family', 'Family relationship', 10),
  ('board-conflict-type-code', 'supervisory', 'Supervisory relationship', 20),
  ('board-conflict-type-code', 'financial', 'Financial interest', 30),
  ('board-conflict-type-code', 'other', 'Other', 40),

  ('board-decision-type-code', 'ratify', 'Ratify', 10),
  ('board-decision-type-code', 'defer', 'Defer', 20),
  ('board-decision-type-code', 'refer-back', 'Refer back', 30),

  ('result-publication-status-code', 'locked', 'Locked', 10),
  ('result-publication-status-code', 'published', 'Published', 20),
  ('result-publication-status-code', 'withdrawn', 'Withdrawn', 30)
) AS member(set_code, code, label, sort_order)
  ON member.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('board_member_conflict', 'conflict_type_code', 'board-conflict-type-code'),
  ('exam_board_decision', 'decision_type_code', 'board-decision-type-code'),
  ('result_publication', 'status_code', 'result-publication-status-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;


-- ============================================================
-- Originally: 0049_post_ratification_correction_distribution.sql
-- ============================================================

-- Revelation SRS — Post-ratification correction distribution (BPR-D13)
-- Migration: 0049_post_ratification_correction_distribution
--
-- Stage 5 of the business-process P0 backlog. Additive columns on
-- post_ratification_case (why/under what authority a correction was
-- raised) and post_ratification_amendment (exact before/after version
-- references plus a distribution_item so downstream consumers of the
-- corrected record are notified, not just the record itself).
--
-- Also fixes a value-set/field mapping bug found while working in this
-- area: migration 0005 wired post_ratification_case.status_code to value
-- set 'post-ratification-case-status-code' (members submitted/under-review/
-- upheld/dismissed/not-eligible), but CorrectionService (apps/api) has only
-- ever written open/under-review/upheld/not-upheld/withdrawn. Migration
-- 0027 added a *correct* value set ('correction-case-status-code', members
-- open/under-review/upheld/not-upheld/withdrawn matching the real code) but
-- mapped it against entity_name 'correction_case' — a table that has never
-- existed — so the fix never attached and the wrong value set stayed live.

ALTER TABLE "post_ratification_case"
  ADD COLUMN "superseded_version_id" uuid,
  ADD COLUMN "error_category_code" text,
  ADD COLUMN "evidence_ref" uuid,
  ADD COLUMN "authorised_by" text;

ALTER TABLE "post_ratification_amendment"
  ADD COLUMN "before_version_ref" uuid,
  ADD COLUMN "after_version_ref" uuid,
  ADD COLUMN "distribution_item_id" uuid;

-- ─────────────────────────────────────────────────────────────────────────────
-- Value sets

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('correction-error-category-code', 'Correction Error Category', 'srs-internal', 'Category of error a post-ratification correction addresses', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, member.code, member.label, member.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('correction-error-category-code', 'data-entry', 'Data entry error', 10),
  ('correction-error-category-code', 'calculation', 'Calculation error', 20),
  ('correction-error-category-code', 'procedural', 'Procedural error', 30),
  ('correction-error-category-code', 'third-party', 'Third-party error', 40)
) AS member(set_code, code, label, sort_order)
  ON member.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('post_ratification_case', 'error_category_code', 'correction-error-category-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;

-- Repoint the live mapping at the value set whose members actually match
-- what CorrectionService writes, and align the column default to match.
-- The orphaned ('correction_case', 'case_status_code') row from 0027/0028
-- is left as historical record — deleting migration-authored rows outside
-- an expand-only migration is avoided even for dead data.
UPDATE "field_value_set"
SET    "value_set_code" = 'correction-case-status-code'
WHERE  "entity_name" = 'post_ratification_case' AND "field_name" = 'status_code';

ALTER TABLE "post_ratification_case" ALTER COLUMN "status_code" SET DEFAULT 'open';


-- ============================================================
-- Originally: 0050_regulatory_collection_lineage.sql
-- ============================================================

-- Revelation SRS — Regulatory collection, lineage & devolved-nation returns (BPR-D16)
-- Migration: 0050_regulatory_collection_lineage
--
-- Stage 6 of the business-process P0 backlog. HESA/OfS keep their bespoke
-- tables and routes unchanged; regulatory_collection is a regulator-neutral
-- parent that HESA/OfS can optionally bridge into, and that SFC (Scotland),
-- Medr (Wales) and DfE-NI collections use directly rather than each getting
-- three more bespoke table sets.

CREATE TABLE "regulatory_collection" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "regulator_code" text NOT NULL,
  "collection_type_code" text NOT NULL,
  "academic_year" text NOT NULL,
  "status_code" text NOT NULL DEFAULT 'draft',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" text NOT NULL
);

CREATE INDEX "regulatory_collection_regulator_idx"
  ON "regulatory_collection" ("tenant_id", "regulator_code", "academic_year");

ALTER TABLE "regulatory_collection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "regulatory_collection" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "regulatory_collection"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "collection_snapshot" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "regulatory_collection_id" uuid NOT NULL REFERENCES "regulatory_collection"("id"),
  "snapshot_version" integer NOT NULL DEFAULT 1,
  "source_transaction_time" timestamptz NOT NULL,
  "generated_at" timestamptz NOT NULL DEFAULT now(),
  "generated_by" text NOT NULL
);

CREATE INDEX "collection_snapshot_collection_idx"
  ON "collection_snapshot" ("tenant_id", "regulatory_collection_id");

ALTER TABLE "collection_snapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "collection_snapshot" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "collection_snapshot"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "regulatory_record" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "collection_snapshot_id" uuid NOT NULL REFERENCES "collection_snapshot"("id"),
  "enrolment_id" uuid,
  "record_payload" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "regulatory_record_snapshot_idx"
  ON "regulatory_record" ("tenant_id", "collection_snapshot_id");

ALTER TABLE "regulatory_record" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "regulatory_record" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "regulatory_record"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "regulatory_field_lineage" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "regulatory_record_id" uuid NOT NULL REFERENCES "regulatory_record"("id"),
  "field_code" text NOT NULL,
  "source_entity_type" text NOT NULL,
  "source_entity_id" uuid NOT NULL,
  "source_version_id" uuid,
  "transform_code" text
);

CREATE INDEX "regulatory_field_lineage_record_idx"
  ON "regulatory_field_lineage" ("tenant_id", "regulatory_record_id");

ALTER TABLE "regulatory_field_lineage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "regulatory_field_lineage" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "regulatory_field_lineage"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "regulatory_validation_issue" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "regulatory_collection_id" uuid NOT NULL REFERENCES "regulatory_collection"("id"),
  "regulatory_record_id" uuid REFERENCES "regulatory_record"("id"),
  "severity_code" text NOT NULL,
  "field_code" text,
  "message" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "regulatory_validation_issue_collection_idx"
  ON "regulatory_validation_issue" ("tenant_id", "regulatory_collection_id");

ALTER TABLE "regulatory_validation_issue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "regulatory_validation_issue" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "regulatory_validation_issue"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "regulatory_signoff" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "regulatory_collection_id" uuid NOT NULL REFERENCES "regulatory_collection"("id"),
  "signed_off_by" text NOT NULL,
  "signed_off_at" timestamptz NOT NULL DEFAULT now(),
  "commentary" text
);

CREATE INDEX "regulatory_signoff_collection_idx"
  ON "regulatory_signoff" ("tenant_id", "regulatory_collection_id");

ALTER TABLE "regulatory_signoff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "regulatory_signoff" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "regulatory_signoff"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "regulatory_submission" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "regulatory_collection_id" uuid NOT NULL REFERENCES "regulatory_collection"("id"),
  "collection_snapshot_id" uuid NOT NULL REFERENCES "collection_snapshot"("id"),
  "distribution_item_id" uuid,
  "submitted_at" timestamptz NOT NULL DEFAULT now(),
  "submitted_by" text NOT NULL,
  "submission_reference" text
);

CREATE INDEX "regulatory_submission_collection_idx"
  ON "regulatory_submission" ("tenant_id", "regulatory_collection_id");

ALTER TABLE "regulatory_submission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "regulatory_submission" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "regulatory_submission"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "hesa_student_return" ADD COLUMN "regulatory_collection_id" uuid;
ALTER TABLE "ofs_extract" ADD COLUMN "regulatory_collection_id" uuid;

-- ─────────────────────────────────────────────────────────────────────────────
-- Value sets

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('regulator-code', 'Regulator', 'srs-internal', 'The statutory body a regulatory collection is submitted to', true),
  ('regulatory-collection-type-code', 'Regulatory Collection Type', 'srs-internal', 'Type of regulatory collection within a regulator', true),
  ('regulatory-collection-status-code', 'Regulatory Collection Status', 'srs-internal', 'Lifecycle status of a regulatory collection', false),
  ('regulatory-validation-severity-code', 'Regulatory Validation Severity', 'srs-internal', 'Severity of a regulatory validation issue', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, member.code, member.label, member.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('regulator-code', 'HESA', 'Higher Education Statistics Agency', 10),
  ('regulator-code', 'OFS', 'Office for Students', 20),
  ('regulator-code', 'SFC', 'Scottish Funding Council', 30),
  ('regulator-code', 'MEDR', 'Medr (Wales)', 40),
  ('regulator-code', 'DFE-NI', 'Department for the Economy (Northern Ireland)', 50),

  ('regulatory-collection-status-code', 'draft', 'Draft', 10),
  ('regulatory-collection-status-code', 'validated', 'Validated', 20),
  ('regulatory-collection-status-code', 'signed-off', 'Signed off', 30),
  ('regulatory-collection-status-code', 'submitted', 'Submitted', 40),
  ('regulatory-collection-status-code', 'amended', 'Amended', 50),

  ('regulatory-validation-severity-code', 'blocking', 'Blocking', 10),
  ('regulatory-validation-severity-code', 'warning', 'Warning', 20)
) AS member(set_code, code, label, sort_order)
  ON member.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('regulatory_collection', 'regulator_code', 'regulator-code'),
  ('regulatory_collection', 'status_code', 'regulatory-collection-status-code'),
  ('regulatory_validation_issue', 'severity_code', 'regulatory-validation-severity-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;


-- ============================================================
-- Originally: 0051_identity_resolution.sql
-- ============================================================

-- Revelation SRS — Identity resolution & correction case (BPR-D17)
-- Migration: 0051_identity_resolution
--
-- Stage 7 of the business-process P0 backlog. identity_resolution_case and
-- data_correction_case extend the shared business_case primitive (0044) via
-- business_case_id rather than re-implementing case status/ownership.
-- Candidate generation only: no row here auto-creates a merge decision from
-- a match score, matching the migration plan's "do not auto-create merge
-- decisions from matching scores" rule.

CREATE TABLE "identity_resolution_case" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "business_case_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "identity_resolution_case_business_case_idx"
  ON "identity_resolution_case" ("tenant_id", "business_case_id");

ALTER TABLE "identity_resolution_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identity_resolution_case" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "identity_resolution_case"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "identity_resolution_candidate" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "identity_resolution_case_id" uuid NOT NULL REFERENCES "identity_resolution_case"("id"),
  "candidate_person_id" uuid NOT NULL REFERENCES "person"("id"),
  "match_score" numeric(5,4) NOT NULL,
  "match_reason_code" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "identity_resolution_candidate_case_idx"
  ON "identity_resolution_candidate" ("tenant_id", "identity_resolution_case_id");

ALTER TABLE "identity_resolution_candidate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identity_resolution_candidate" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "identity_resolution_candidate"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "identity_resolution_decision" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "identity_resolution_case_id" uuid NOT NULL REFERENCES "identity_resolution_case"("id"),
  "decision_type_code" text NOT NULL,
  "survivor_person_id" uuid REFERENCES "person"("id"),
  "decided_by" text NOT NULL,
  "decided_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "identity_resolution_decision_case_unique"
  ON "identity_resolution_decision" ("tenant_id", "identity_resolution_case_id");

ALTER TABLE "identity_resolution_decision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identity_resolution_decision" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "identity_resolution_decision"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "person_identity_link" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "source_person_id" uuid NOT NULL REFERENCES "person"("id"),
  "target_person_id" uuid NOT NULL REFERENCES "person"("id"),
  "link_type_code" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "person_identity_link_source_idx"
  ON "person_identity_link" ("tenant_id", "source_person_id");
CREATE INDEX "person_identity_link_target_idx"
  ON "person_identity_link" ("tenant_id", "target_person_id");

ALTER TABLE "person_identity_link" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "person_identity_link" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "person_identity_link"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "identity_redirect" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "old_person_id" uuid NOT NULL REFERENCES "person"("id"),
  "new_person_id" uuid NOT NULL REFERENCES "person"("id"),
  "effective_from" timestamptz NOT NULL DEFAULT now(),
  "propagated_at" timestamptz
);

CREATE UNIQUE INDEX "identity_redirect_old_person_unique"
  ON "identity_redirect" ("tenant_id", "old_person_id");

ALTER TABLE "identity_redirect" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identity_redirect" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "identity_redirect"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "data_correction_case" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "business_case_id" uuid NOT NULL,
  "person_id" uuid NOT NULL REFERENCES "person"("id"),
  "corrected_entity_type" text NOT NULL,
  "corrected_field_name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "data_correction_case_person_idx"
  ON "data_correction_case" ("tenant_id", "person_id");

ALTER TABLE "data_correction_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_correction_case" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "data_correction_case"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Value sets

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('identity-match-reason-code', 'Identity Match Reason', 'srs-internal', 'Basis on which an identity-resolution candidate was matched', true),
  ('identity-resolution-decision-type-code', 'Identity Resolution Decision Type', 'srs-internal', 'Type of decision reached on an identity-resolution case', false),
  ('person-identity-link-type-code', 'Person Identity Link Type', 'srs-internal', 'Nature of the link between two person records', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, member.code, member.label, member.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('identity-match-reason-code', 'name-dob', 'Name and date of birth', 10),
  ('identity-match-reason-code', 'email', 'Email address', 20),
  ('identity-match-reason-code', 'student-number', 'Student number', 30),
  ('identity-match-reason-code', 'manual-flag', 'Manually flagged', 40),

  ('identity-resolution-decision-type-code', 'merge', 'Merge', 10),
  ('identity-resolution-decision-type-code', 'reject', 'Reject', 20),
  ('identity-resolution-decision-type-code', 'link', 'Link (not merged)', 30),

  ('person-identity-link-type-code', 'merged-into', 'Merged into', 10),
  ('person-identity-link-type-code', 'duplicate-of', 'Duplicate of', 20),
  ('person-identity-link-type-code', 'related-record', 'Related record', 30)
) AS member(set_code, code, label, sort_order)
  ON member.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('identity_resolution_candidate', 'match_reason_code', 'identity-match-reason-code'),
  ('identity_resolution_decision', 'decision_type_code', 'identity-resolution-decision-type-code'),
  ('person_identity_link', 'link_type_code', 'person-identity-link-type-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;


-- ============================================================
-- Originally: 0052_rights_retention_disposal.sql
-- ============================================================

-- Revelation SRS — Individual rights, retention & disposal (BPR-D18)
-- Migration: 0052_rights_retention_disposal
--
-- Stage 8 of the business-process P0 backlog. individual_rights_request
-- extends the shared business_case primitive (0044). foi_request stays a
-- separate model — a DSAR is broader than FOI. This is new capability only:
-- the existing RetentionEnforcementService and person.retention_anonymised_at
-- are left untouched (no historical backfill of undocumented retention
-- decisions, per the migration plan's "do not fabricate evidence" rule);
-- new retention_schedule/assignment/hold/disposition rows apply prospectively.

CREATE TABLE "individual_rights_request" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "business_case_id" uuid NOT NULL,
  "person_id" uuid NOT NULL REFERENCES "person"("id"),
  "request_type_code" text NOT NULL,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "statutory_deadline_date" date NOT NULL
);

CREATE INDEX "individual_rights_request_person_idx"
  ON "individual_rights_request" ("tenant_id", "person_id");

ALTER TABLE "individual_rights_request" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "individual_rights_request" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "individual_rights_request"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "rights_request_scope" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "individual_rights_request_id" uuid NOT NULL REFERENCES "individual_rights_request"("id"),
  "scope_entity_type" text NOT NULL,
  "scope_description" text
);

CREATE INDEX "rights_request_scope_request_idx"
  ON "rights_request_scope" ("tenant_id", "individual_rights_request_id");

ALTER TABLE "rights_request_scope" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rights_request_scope" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "rights_request_scope"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "rights_search_manifest" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "individual_rights_request_id" uuid NOT NULL REFERENCES "individual_rights_request"("id"),
  "searched_system" text NOT NULL,
  "searched_at" timestamptz NOT NULL DEFAULT now(),
  "record_count" integer NOT NULL DEFAULT 0
);

CREATE INDEX "rights_search_manifest_request_idx"
  ON "rights_search_manifest" ("tenant_id", "individual_rights_request_id");

ALTER TABLE "rights_search_manifest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rights_search_manifest" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "rights_search_manifest"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "rights_decision" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "individual_rights_request_id" uuid NOT NULL REFERENCES "individual_rights_request"("id"),
  "decision_type_code" text NOT NULL,
  "legal_basis" text,
  "decided_by" text NOT NULL,
  "decided_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "rights_decision_request_idx"
  ON "rights_decision" ("tenant_id", "individual_rights_request_id");

ALTER TABLE "rights_decision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rights_decision" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "rights_decision"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "processing_restriction" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "person_id" uuid NOT NULL REFERENCES "person"("id"),
  "rights_decision_id" uuid REFERENCES "rights_decision"("id"),
  "restriction_type_code" text NOT NULL,
  "applied_by" text NOT NULL,
  "applied_at" timestamptz NOT NULL DEFAULT now(),
  "lifted_at" timestamptz
);

CREATE INDEX "processing_restriction_person_idx"
  ON "processing_restriction" ("tenant_id", "person_id");

ALTER TABLE "processing_restriction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "processing_restriction" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "processing_restriction"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "retention_schedule" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "entity_type" text NOT NULL,
  "retention_period_months" text NOT NULL,
  "trigger_event_code" text NOT NULL,
  "description" text
);

CREATE INDEX "retention_schedule_entity_idx"
  ON "retention_schedule" ("tenant_id", "entity_type");

ALTER TABLE "retention_schedule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "retention_schedule" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "retention_schedule"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "retention_assignment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "retention_schedule_id" uuid NOT NULL REFERENCES "retention_schedule"("id"),
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "assigned_at" timestamptz NOT NULL DEFAULT now(),
  "scheduled_disposal_date" date
);

CREATE INDEX "retention_assignment_entity_idx"
  ON "retention_assignment" ("tenant_id", "entity_type", "entity_id");
CREATE INDEX "retention_assignment_disposal_idx"
  ON "retention_assignment" ("tenant_id", "scheduled_disposal_date");

ALTER TABLE "retention_assignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "retention_assignment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "retention_assignment"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "record_hold" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "retention_assignment_id" uuid NOT NULL REFERENCES "retention_assignment"("id"),
  "hold_reason_code" text NOT NULL,
  "applied_by" text NOT NULL,
  "applied_at" timestamptz NOT NULL DEFAULT now(),
  "lifted_at" timestamptz
);

CREATE INDEX "record_hold_assignment_idx"
  ON "record_hold" ("tenant_id", "retention_assignment_id");

ALTER TABLE "record_hold" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "record_hold" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "record_hold"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "record_disposition" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "retention_assignment_id" uuid NOT NULL REFERENCES "retention_assignment"("id"),
  "disposition_type_code" text NOT NULL,
  "executed_at" timestamptz NOT NULL DEFAULT now(),
  "executed_by" text NOT NULL,
  "evidence_ref" text
);

CREATE UNIQUE INDEX "record_disposition_assignment_unique"
  ON "record_disposition" ("tenant_id", "retention_assignment_id");

ALTER TABLE "record_disposition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "record_disposition" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "record_disposition"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Value sets

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('rights-request-type-code', 'Individual Rights Request Type', 'srs-internal', 'Type of GDPR individual-rights request', false),
  ('rights-decision-type-code', 'Rights Decision Type', 'srs-internal', 'Outcome of an individual-rights request', false),
  ('processing-restriction-type-code', 'Processing Restriction Type', 'srs-internal', 'Type of processing restriction applied to a person', true),
  ('retention-trigger-event-code', 'Retention Trigger Event', 'srs-internal', 'Event that starts a retention schedule counting down', true),
  ('record-hold-reason-code', 'Record Hold Reason', 'srs-internal', 'Reason a scheduled disposal is being held', true),
  ('record-disposition-type-code', 'Record Disposition Type', 'srs-internal', 'How a record was ultimately disposed of', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, member.code, member.label, member.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('rights-request-type-code', 'access', 'Right of access', 10),
  ('rights-request-type-code', 'rectification', 'Right to rectification', 20),
  ('rights-request-type-code', 'erasure', 'Right to erasure', 30),
  ('rights-request-type-code', 'restriction', 'Right to restriction of processing', 40),
  ('rights-request-type-code', 'portability', 'Right to data portability', 50),
  ('rights-request-type-code', 'objection', 'Right to object', 60),

  ('rights-decision-type-code', 'granted', 'Granted', 10),
  ('rights-decision-type-code', 'partially-granted', 'Partially granted', 20),
  ('rights-decision-type-code', 'refused', 'Refused', 30),

  ('processing-restriction-type-code', 'no-marketing', 'No marketing communications', 10),
  ('processing-restriction-type-code', 'no-automated-decision', 'No automated decision-making', 20),
  ('processing-restriction-type-code', 'processing-paused', 'Processing paused', 30),

  ('retention-trigger-event-code', 'end-of-study', 'End of study', 10),
  ('retention-trigger-event-code', 'award-conferred', 'Award conferred', 20),
  ('retention-trigger-event-code', 'request-closed', 'Request closed', 30),

  ('record-hold-reason-code', 'litigation', 'Litigation', 10),
  ('record-hold-reason-code', 'foi-request', 'FOI request', 20),
  ('record-hold-reason-code', 'dsar-in-progress', 'DSAR in progress', 30),
  ('record-hold-reason-code', 'audit', 'Audit', 40),

  ('record-disposition-type-code', 'anonymised', 'Anonymised', 10),
  ('record-disposition-type-code', 'deleted', 'Deleted', 20),
  ('record-disposition-type-code', 'transferred', 'Transferred', 30)
) AS member(set_code, code, label, sort_order)
  ON member.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('individual_rights_request', 'request_type_code', 'rights-request-type-code'),
  ('rights_decision', 'decision_type_code', 'rights-decision-type-code'),
  ('processing_restriction', 'restriction_type_code', 'processing-restriction-type-code'),
  ('retention_schedule', 'trigger_event_code', 'retention-trigger-event-code'),
  ('record_hold', 'hold_reason_code', 'record-hold-reason-code'),
  ('record_disposition', 'disposition_type_code', 'record-disposition-type-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;


-- ============================================================
-- Originally: 0053_audit_hardening_review.sql
-- ============================================================

-- Revelation SRS — Audit hash-chaining & review (BPR-D19)
-- Migration: 0053_audit_hardening_review
--
-- Stage 9 (final stage this pass) of the business-process P0 backlog.
-- Adds a hash chain to audit_record itself (computed by AuditService.record,
-- the single choke point all 25+ call sites already go through — no call
-- site needs to change) plus partition-seal and review-case/finding tables.
-- Existing rows get previous_record_hash/record_hash = NULL and are treated
-- as a sealed legacy range; no retroactive tamper evidence is claimed for
-- pre-migration history.

ALTER TABLE "audit_record"
  ADD COLUMN "previous_record_hash" text,
  ADD COLUMN "record_hash" text;

CREATE INDEX "audit_record_tenant_occurred_idx"
  ON "audit_record" ("tenant_id", "occurred_at");

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "audit_partition_seal" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "range_start" timestamptz NOT NULL,
  "range_end" timestamptz NOT NULL,
  "seal_hash" text NOT NULL,
  "sealed_at" timestamptz NOT NULL DEFAULT now(),
  "sealed_by" text NOT NULL
);

CREATE INDEX "audit_partition_seal_tenant_range_idx"
  ON "audit_partition_seal" ("tenant_id", "range_start", "range_end");

ALTER TABLE "audit_partition_seal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_partition_seal" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_partition_seal"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "audit_review_case" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "business_case_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "audit_review_case_business_case_idx"
  ON "audit_review_case" ("tenant_id", "business_case_id");

ALTER TABLE "audit_review_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_review_case" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_review_case"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "audit_review_finding" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "audit_review_case_id" uuid NOT NULL REFERENCES "audit_review_case"("id"),
  "audit_record_id" uuid NOT NULL,
  "finding_type_code" text NOT NULL,
  "description" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "audit_review_finding_case_idx"
  ON "audit_review_finding" ("tenant_id", "audit_review_case_id");

ALTER TABLE "audit_review_finding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_review_finding" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_review_finding"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Value sets

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('audit-review-finding-type-code', 'Audit Review Finding Type', 'srs-internal', 'Outcome type of an individual audit-review finding', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, member.code, member.label, member.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('audit-review-finding-type-code', 'no-concern', 'No concern', 10),
  ('audit-review-finding-type-code', 'policy-breach', 'Policy breach', 20),
  ('audit-review-finding-type-code', 'tamper-suspected', 'Tamper suspected', 30),
  ('audit-review-finding-type-code', 'investigation-required', 'Investigation required', 40)
) AS member(set_code, code, label, sort_order)
  ON member.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('audit_review_finding', 'finding_type_code', 'audit-review-finding-type-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;

