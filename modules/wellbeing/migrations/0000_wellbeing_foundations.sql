-- ============================================================
-- Originally: 0001_wellbeing_initial.sql
-- ============================================================

-- Revelation SRS — Phase 8 Wellbeing Module Schema
-- Migration: 0001_wellbeing_initial
-- Applied by: modules/wellbeing/src/db/migrate.ts
--
-- All tables live in the "wellbeing" PostgreSQL schema, isolating them from
-- the core SRS schema.  The core tenant table (public.tenant) must already
-- exist before this migration runs (applied by packages/db).

-- ── Schema ───────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS wellbeing;

-- ── Wellbeing Case ───────────────────────────────────────────────────────────
-- Top-level case: one per student engagement with the service.

CREATE TABLE IF NOT EXISTS wellbeing."wellbeing_case" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL REFERENCES "tenant" ("id"),
  "person_id"             uuid        NOT NULL,
  "case_ref"              text        NOT NULL,
  "status_code"           text        NOT NULL DEFAULT 'active',
  "opened_at"             timestamptz NOT NULL DEFAULT now(),
  "closed_at"             timestamptz,
  "assigned_advisor_id"   text,
  "notes"                 text,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "updated_at"            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "wellbeing_case_ref_unique" UNIQUE ("tenant_id", "case_ref")
);

CREATE INDEX "wellbeing_case_tenant_person_idx"
  ON wellbeing."wellbeing_case" ("tenant_id", "person_id");

ALTER TABLE wellbeing."wellbeing_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE wellbeing."wellbeing_case" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON wellbeing."wellbeing_case";
CREATE POLICY tenant_isolation ON wellbeing."wellbeing_case"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── SRS Context Projection ───────────────────────────────────────────────────
-- Mutable read-model maintained from SRS events.

CREATE TABLE IF NOT EXISTS wellbeing."srs_context_projection" (
  "id"                           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                    uuid        NOT NULL REFERENCES "tenant" ("id"),
  "person_id"                    uuid        NOT NULL,
  "person_data"                  jsonb       NOT NULL DEFAULT '{}',
  "active_enrolment_ids"         jsonb       NOT NULL DEFAULT '[]',
  "active_module_codes"          jsonb       NOT NULL DEFAULT '[]',
  "disability_declaration_status" text,
  "latest_marks"                 jsonb       NOT NULL DEFAULT '{}',
  "enrolment_status"             text,
  "last_event_offset"            text,
  "last_updated_at"              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "srs_context_projection_unique" UNIQUE ("tenant_id", "person_id")
);

CREATE INDEX "srs_context_projection_tenant_idx"
  ON wellbeing."srs_context_projection" ("tenant_id");

ALTER TABLE wellbeing."srs_context_projection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE wellbeing."srs_context_projection" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON wellbeing."srs_context_projection";
CREATE POLICY tenant_isolation ON wellbeing."srs_context_projection"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Early Warning Alert ───────────────────────────────────────────────────────
-- Append-only inbound alert signal log.

CREATE TABLE IF NOT EXISTS wellbeing."early_warning_alert" (
  "id"                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"            uuid        NOT NULL REFERENCES "tenant" ("id"),
  "person_id"            uuid        NOT NULL,
  "alert_type_code"      text        NOT NULL,
  "alert_source_code"    text        NOT NULL,
  "source_event_subject" text,
  "source_event_id"      text,
  "triage_status_code"   text        NOT NULL DEFAULT 'pending',
  "assigned_case_id"     uuid,
  "alert_payload"        jsonb       NOT NULL DEFAULT '{}',
  "received_at"          timestamptz NOT NULL DEFAULT now(),
  "triaged_by"           text,
  "triaged_at"           timestamptz,
  "created_at"           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "early_warning_alert_tenant_person_idx"
  ON wellbeing."early_warning_alert" ("tenant_id", "person_id");
CREATE INDEX "early_warning_alert_triage_status_idx"
  ON wellbeing."early_warning_alert" ("tenant_id", "triage_status_code");

ALTER TABLE wellbeing."early_warning_alert" ENABLE ROW LEVEL SECURITY;
ALTER TABLE wellbeing."early_warning_alert" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON wellbeing."early_warning_alert";
CREATE POLICY tenant_isolation ON wellbeing."early_warning_alert"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Disability Support Case (bitemporal) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS wellbeing."disability_support_case" (
  "version_id"              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                      uuid        NOT NULL,
  "tenant_id"               uuid        NOT NULL REFERENCES "tenant" ("id"),
  "wellbeing_case_id"       uuid        NOT NULL,
  "person_id"               uuid        NOT NULL,
  "support_type_code"       text        NOT NULL,
  "status_code"             text        NOT NULL,
  "support_plan_status_code" text       NOT NULL DEFAULT 'none',
  "dsa_award_ref"           text,
  "actor_id"                text        NOT NULL,
  "valid_from"              timestamptz NOT NULL,
  "valid_to"                timestamptz,
  "recorded_at"             timestamptz NOT NULL DEFAULT now(),
  "recorded_until"          timestamptz
);

ALTER TABLE wellbeing."disability_support_case"
  ADD CONSTRAINT "disability_support_case_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  ADD CONSTRAINT "disability_support_case_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at);

CREATE UNIQUE INDEX IF NOT EXISTS "disability_support_case_unique_logical_tx"
  ON wellbeing."disability_support_case" (tenant_id, id, recorded_at);

CREATE UNIQUE INDEX IF NOT EXISTS "disability_support_case_current_version"
  ON wellbeing."disability_support_case" (tenant_id, id)
  WHERE recorded_until IS NULL;

CREATE INDEX "disability_support_case_tenant_person_idx"
  ON wellbeing."disability_support_case" ("tenant_id", "person_id");

ALTER TABLE wellbeing."disability_support_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE wellbeing."disability_support_case" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON wellbeing."disability_support_case";
CREATE POLICY tenant_isolation ON wellbeing."disability_support_case"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── DSA Entitlement (bitemporal) ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wellbeing."dsa_entitlement" (
  "version_id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                          uuid        NOT NULL,
  "tenant_id"                   uuid        NOT NULL REFERENCES "tenant" ("id"),
  "disability_support_case_id"  uuid        NOT NULL,
  "person_id"                   uuid        NOT NULL,
  "entitlement_type_code"       text        NOT NULL,
  "provider_ref"                text,
  "effective_from"              timestamptz NOT NULL,
  "effective_to"                timestamptz,
  "approved_by"                 text        NOT NULL,
  "actor_id"                    text        NOT NULL,
  "valid_from"                  timestamptz NOT NULL,
  "valid_to"                    timestamptz,
  "recorded_at"                 timestamptz NOT NULL DEFAULT now(),
  "recorded_until"              timestamptz
);

ALTER TABLE wellbeing."dsa_entitlement"
  ADD CONSTRAINT "dsa_entitlement_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  ADD CONSTRAINT "dsa_entitlement_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at);

CREATE UNIQUE INDEX IF NOT EXISTS "dsa_entitlement_unique_logical_tx"
  ON wellbeing."dsa_entitlement" (tenant_id, id, recorded_at);

CREATE UNIQUE INDEX IF NOT EXISTS "dsa_entitlement_current_version"
  ON wellbeing."dsa_entitlement" (tenant_id, id)
  WHERE recorded_until IS NULL;

CREATE INDEX "dsa_entitlement_tenant_case_idx"
  ON wellbeing."dsa_entitlement" ("tenant_id", "disability_support_case_id");

ALTER TABLE wellbeing."dsa_entitlement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE wellbeing."dsa_entitlement" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON wellbeing."dsa_entitlement";
CREATE POLICY tenant_isolation ON wellbeing."dsa_entitlement"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Evidence Reference ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wellbeing."evidence_reference" (
  "id"                         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                  uuid        NOT NULL REFERENCES "tenant" ("id"),
  "disability_support_case_id" uuid        NOT NULL,
  "evidence_type_code"         text        NOT NULL,
  "edrms_document_ref"         text,
  "edrms_document_url"         text,
  "status_code"                text        NOT NULL DEFAULT 'pending',
  "received_at"                timestamptz,
  "uploaded_by"                text        NOT NULL,
  "created_at"                 timestamptz NOT NULL DEFAULT now(),
  "updated_at"                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "evidence_reference_case_idx"
  ON wellbeing."evidence_reference" ("tenant_id", "disability_support_case_id");

ALTER TABLE wellbeing."evidence_reference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE wellbeing."evidence_reference" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON wellbeing."evidence_reference";
CREATE POLICY tenant_isolation ON wellbeing."evidence_reference"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Adjustment Case (bitemporal) ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wellbeing."adjustment_case" (
  "version_id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                          uuid        NOT NULL,
  "tenant_id"                   uuid        NOT NULL REFERENCES "tenant" ("id"),
  "wellbeing_case_id"           uuid        NOT NULL,
  "disability_support_case_id"  uuid        NOT NULL,
  "person_id"                   uuid        NOT NULL,
  "adjustment_type_code"        text        NOT NULL,
  "status_code"                 text        NOT NULL,
  "recommended_adjustment"      text,
  "rationale"                   text,
  "dsa_entitlement_id"          uuid,
  "srs_application_ref"         text,
  "actor_id"                    text        NOT NULL,
  "valid_from"                  timestamptz NOT NULL,
  "valid_to"                    timestamptz,
  "recorded_at"                 timestamptz NOT NULL DEFAULT now(),
  "recorded_until"              timestamptz
);

ALTER TABLE wellbeing."adjustment_case"
  ADD CONSTRAINT "adjustment_case_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  ADD CONSTRAINT "adjustment_case_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at);

CREATE UNIQUE INDEX IF NOT EXISTS "adjustment_case_unique_logical_tx"
  ON wellbeing."adjustment_case" (tenant_id, id, recorded_at);

CREATE UNIQUE INDEX IF NOT EXISTS "adjustment_case_current_version"
  ON wellbeing."adjustment_case" (tenant_id, id)
  WHERE recorded_until IS NULL;

CREATE INDEX "adjustment_case_tenant_person_idx"
  ON wellbeing."adjustment_case" ("tenant_id", "person_id");

ALTER TABLE wellbeing."adjustment_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE wellbeing."adjustment_case" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON wellbeing."adjustment_case";
CREATE POLICY tenant_isolation ON wellbeing."adjustment_case"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Adjustment Assessment ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wellbeing."adjustment_assessment" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL REFERENCES "tenant" ("id"),
  "adjustment_case_id"    uuid        NOT NULL,
  "assessor_id"           text        NOT NULL,
  "assessed_at"           timestamptz NOT NULL,
  "outcome_code"          text,
  "findings"              text,
  "recommended_action"    text,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "updated_at"            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "adjustment_assessment_case_idx"
  ON wellbeing."adjustment_assessment" ("tenant_id", "adjustment_case_id");

ALTER TABLE wellbeing."adjustment_assessment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE wellbeing."adjustment_assessment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON wellbeing."adjustment_assessment";
CREATE POLICY tenant_isolation ON wellbeing."adjustment_assessment"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Adjustment Panel Decision ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wellbeing."adjustment_panel_decision" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL REFERENCES "tenant" ("id"),
  "adjustment_case_id"    uuid        NOT NULL,
  "panel_chair_id"        text        NOT NULL,
  "panel_date"            timestamptz NOT NULL,
  "decision_code"         text        NOT NULL,
  "decision_rationale"    text,
  "distributed_to_srs"    boolean     NOT NULL DEFAULT false,
  "distributed_at"        timestamptz,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "updated_at"            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "adjustment_panel_decision_case_idx"
  ON wellbeing."adjustment_panel_decision" ("tenant_id", "adjustment_case_id");

ALTER TABLE wellbeing."adjustment_panel_decision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE wellbeing."adjustment_panel_decision" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON wellbeing."adjustment_panel_decision";
CREATE POLICY tenant_isolation ON wellbeing."adjustment_panel_decision"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── EC Claim (bitemporal) ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wellbeing."ec_claim" (
  "version_id"                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                        uuid        NOT NULL,
  "tenant_id"                 uuid        NOT NULL REFERENCES "tenant" ("id"),
  "wellbeing_case_id"         uuid        NOT NULL,
  "person_id"                 uuid        NOT NULL,
  "enrolment_id"              uuid        NOT NULL,
  "assessment_period_ref"     text        NOT NULL,
  "affected_module_codes"     jsonb       NOT NULL DEFAULT '[]',
  "status_code"               text        NOT NULL,
  "circumstances_narrative"   text,
  "submitted_at"              timestamptz NOT NULL,
  "evidence_deadline"         timestamptz,
  "actor_id"                  text        NOT NULL,
  "valid_from"                timestamptz NOT NULL,
  "valid_to"                  timestamptz,
  "recorded_at"               timestamptz NOT NULL DEFAULT now(),
  "recorded_until"            timestamptz
);

ALTER TABLE wellbeing."ec_claim"
  ADD CONSTRAINT "ec_claim_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  ADD CONSTRAINT "ec_claim_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at);

CREATE UNIQUE INDEX IF NOT EXISTS "ec_claim_unique_logical_tx"
  ON wellbeing."ec_claim" (tenant_id, id, recorded_at);

CREATE UNIQUE INDEX IF NOT EXISTS "ec_claim_current_version"
  ON wellbeing."ec_claim" (tenant_id, id)
  WHERE recorded_until IS NULL;

CREATE INDEX "ec_claim_tenant_person_idx"
  ON wellbeing."ec_claim" ("tenant_id", "person_id");
CREATE INDEX "ec_claim_tenant_enrolment_idx"
  ON wellbeing."ec_claim" ("tenant_id", "enrolment_id");

ALTER TABLE wellbeing."ec_claim" ENABLE ROW LEVEL SECURITY;
ALTER TABLE wellbeing."ec_claim" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON wellbeing."ec_claim";
CREATE POLICY tenant_isolation ON wellbeing."ec_claim"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── EC Evidence Review ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wellbeing."ec_evidence_review" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL REFERENCES "tenant" ("id"),
  "ec_claim_id"           uuid        NOT NULL,
  "reviewer_id"           text        NOT NULL,
  "reviewed_at"           timestamptz NOT NULL,
  "evidence_status_code"  text        NOT NULL,
  "review_notes"          text,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "updated_at"            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "ec_evidence_review_claim_idx"
  ON wellbeing."ec_evidence_review" ("tenant_id", "ec_claim_id");

ALTER TABLE wellbeing."ec_evidence_review" ENABLE ROW LEVEL SECURITY;
ALTER TABLE wellbeing."ec_evidence_review" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON wellbeing."ec_evidence_review";
CREATE POLICY tenant_isolation ON wellbeing."ec_evidence_review"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── EC Determination ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wellbeing."ec_determination" (
  "id"                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                uuid        NOT NULL REFERENCES "tenant" ("id"),
  "ec_claim_id"              uuid        NOT NULL,
  "authorised_by_id"         text        NOT NULL,
  "determination_code"       text        NOT NULL,
  "determination_rationale"  text,
  "module_outcomes"          jsonb       NOT NULL DEFAULT '[]',
  "determined_at"            timestamptz NOT NULL,
  "created_at"               timestamptz NOT NULL DEFAULT now(),
  "updated_at"               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "ec_determination_claim_idx"
  ON wellbeing."ec_determination" ("tenant_id", "ec_claim_id");

ALTER TABLE wellbeing."ec_determination" ENABLE ROW LEVEL SECURITY;
ALTER TABLE wellbeing."ec_determination" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON wellbeing."ec_determination";
CREATE POLICY tenant_isolation ON wellbeing."ec_determination"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Mental Health Case (bitemporal) ──────────────────────────────────────────
-- Special-category health data — restricted to wellbeing-mental-health-advisor.

CREATE TABLE IF NOT EXISTS wellbeing."mental_health_case" (
  "version_id"              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                      uuid        NOT NULL,
  "tenant_id"               uuid        NOT NULL REFERENCES "tenant" ("id"),
  "wellbeing_case_id"       uuid        NOT NULL,
  "person_id"               uuid        NOT NULL,
  "presenting_concern_code" text        NOT NULL,
  "status_code"             text        NOT NULL,
  "risk_level_code"         text        NOT NULL DEFAULT 'low',
  "consent_given"           boolean     NOT NULL DEFAULT false,
  "consent_date"            timestamptz,
  "actor_id"                text        NOT NULL,
  "valid_from"              timestamptz NOT NULL,
  "valid_to"                timestamptz,
  "recorded_at"             timestamptz NOT NULL DEFAULT now(),
  "recorded_until"          timestamptz
);

ALTER TABLE wellbeing."mental_health_case"
  ADD CONSTRAINT "mental_health_case_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  ADD CONSTRAINT "mental_health_case_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at);

CREATE UNIQUE INDEX IF NOT EXISTS "mental_health_case_unique_logical_tx"
  ON wellbeing."mental_health_case" (tenant_id, id, recorded_at);

CREATE UNIQUE INDEX IF NOT EXISTS "mental_health_case_current_version"
  ON wellbeing."mental_health_case" (tenant_id, id)
  WHERE recorded_until IS NULL;

CREATE INDEX "mental_health_case_tenant_person_idx"
  ON wellbeing."mental_health_case" ("tenant_id", "person_id");

ALTER TABLE wellbeing."mental_health_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE wellbeing."mental_health_case" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON wellbeing."mental_health_case";
CREATE POLICY tenant_isolation ON wellbeing."mental_health_case"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Intervention Plan (bitemporal) ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wellbeing."intervention_plan" (
  "version_id"                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                        uuid        NOT NULL,
  "tenant_id"                 uuid        NOT NULL REFERENCES "tenant" ("id"),
  "mental_health_case_id"     uuid        NOT NULL,
  "person_id"                 uuid        NOT NULL,
  "plan_type_code"            text        NOT NULL,
  "status_code"               text        NOT NULL,
  "practitioner_id"           text        NOT NULL,
  "session_frequency_code"    text,
  "planned_session_count"     text,
  "goals"                     jsonb       NOT NULL DEFAULT '[]',
  "external_referral"         boolean     NOT NULL DEFAULT false,
  "external_referral_details" text,
  "review_date"               timestamptz,
  "actor_id"                  text        NOT NULL,
  "valid_from"                timestamptz NOT NULL,
  "valid_to"                  timestamptz,
  "recorded_at"               timestamptz NOT NULL DEFAULT now(),
  "recorded_until"            timestamptz
);

ALTER TABLE wellbeing."intervention_plan"
  ADD CONSTRAINT "intervention_plan_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  ADD CONSTRAINT "intervention_plan_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at);

CREATE UNIQUE INDEX IF NOT EXISTS "intervention_plan_unique_logical_tx"
  ON wellbeing."intervention_plan" (tenant_id, id, recorded_at);

CREATE UNIQUE INDEX IF NOT EXISTS "intervention_plan_current_version"
  ON wellbeing."intervention_plan" (tenant_id, id)
  WHERE recorded_until IS NULL;

CREATE INDEX "intervention_plan_case_idx"
  ON wellbeing."intervention_plan" ("tenant_id", "mental_health_case_id");

ALTER TABLE wellbeing."intervention_plan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE wellbeing."intervention_plan" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON wellbeing."intervention_plan";
CREATE POLICY tenant_isolation ON wellbeing."intervention_plan"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);


-- ============================================================
-- Originally: 0002_wellbeing_event_log.sql
-- ============================================================

-- Revelation SRS — Phase 8 Wellbeing Module Event Tracking Tables
-- Migration: 0002_wellbeing_event_log
-- Applied by: modules/wellbeing/src/db/migrate.ts
--
-- Three infrastructure tables for Stage 2 SRS context ingestion:
--   event_log             — idempotency: one row per processed event per consumer group
--   enrolment_person_map  — fast lookup: enrolment_id → person_id
--   module_reg_person_map — fast lookup: module_registration_id → person_id

-- ── Event Log ─────────────────────────────────────────────────────────────────
-- Append-only. Never updated. Used to detect replay and suppress duplicates.

CREATE TABLE IF NOT EXISTS wellbeing."event_log" (
  "id"              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id"        text        NOT NULL,
  "subject"         text        NOT NULL,
  "tenant_id"       uuid        NOT NULL REFERENCES "tenant" ("id"),
  "stream_seq"      bigint,
  "consumer_group"  text        NOT NULL,
  "event_hash"      text        NOT NULL,
  "processed_at"    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "event_log_event_unique" UNIQUE ("event_id", "consumer_group")
);

CREATE INDEX "event_log_tenant_subject_idx"
  ON wellbeing."event_log" ("tenant_id", "subject");

CREATE INDEX "event_log_consumer_seq_idx"
  ON wellbeing."event_log" ("consumer_group", "stream_seq");

ALTER TABLE wellbeing."event_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE wellbeing."event_log" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON wellbeing."event_log";
CREATE POLICY tenant_isolation ON wellbeing."event_log"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Enrolment → Person Map ────────────────────────────────────────────────────
-- Built from srs.student.enrolled events. One row per enrolment.

CREATE TABLE IF NOT EXISTS wellbeing."enrolment_person_map" (
  "tenant_id"    uuid NOT NULL REFERENCES "tenant" ("id"),
  "enrolment_id" uuid NOT NULL,
  "person_id"    uuid NOT NULL,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("tenant_id", "enrolment_id")
);

ALTER TABLE wellbeing."enrolment_person_map" ENABLE ROW LEVEL SECURITY;
ALTER TABLE wellbeing."enrolment_person_map" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON wellbeing."enrolment_person_map";
CREATE POLICY tenant_isolation ON wellbeing."enrolment_person_map"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Module Registration → Person Map ─────────────────────────────────────────
-- Built from srs.enrolment.module-registered events.

CREATE TABLE IF NOT EXISTS wellbeing."module_reg_person_map" (
  "tenant_id"              uuid NOT NULL REFERENCES "tenant" ("id"),
  "module_registration_id" uuid NOT NULL,
  "enrolment_id"           uuid NOT NULL,
  "person_id"              uuid NOT NULL,
  "module_id"              text NOT NULL,
  "created_at"             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("tenant_id", "module_registration_id")
);

ALTER TABLE wellbeing."module_reg_person_map" ENABLE ROW LEVEL SECURITY;
ALTER TABLE wellbeing."module_reg_person_map" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON wellbeing."module_reg_person_map";
CREATE POLICY tenant_isolation ON wellbeing."module_reg_person_map"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);


-- ============================================================
-- Originally: 0003_wellbeing_audit_log.sql
-- ============================================================

-- Stage 3: Audit log for special-category data access
--
-- Append-only record of every read, write, and export operation on special-
-- category wellbeing data (disability cases, DSA entitlements, evidence).
-- Required for Equality Act compliance and data-protection audit obligations.

CREATE TABLE wellbeing.audit_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL,
  actor_id      text        NOT NULL,
  action_code   text        NOT NULL,   -- read | write | export
  resource_type text        NOT NULL,   -- disability-case | dsa-entitlement | evidence
  resource_id   uuid        NOT NULL,
  person_id     uuid        NOT NULL,
  context       jsonb       NOT NULL DEFAULT '{}',
  recorded_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE wellbeing.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE wellbeing.audit_log FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON wellbeing.audit_log
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX audit_log_tenant_person ON wellbeing.audit_log (tenant_id, person_id);
CREATE INDEX audit_log_resource      ON wellbeing.audit_log (tenant_id, resource_type, resource_id);


-- ============================================================
-- Originally: 0004_wellbeing_adjustment_workflow.sql
-- ============================================================

-- Stage 4: Transactional outbox for SRS adjustment handoff
--
-- Records a pending delivery to SRS for every approved adjustment case.
-- The idempotency_key uniqueness constraint ensures that even if the approve
-- action is called multiple times, only one SRS submission is ever attempted.
-- The background processor reads 'pending' rows and delivers to F063; on
-- success it marks 'sent', on failure 'failed' so the next retry picks it up.

CREATE TABLE wellbeing.srs_handoff_outbox (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  adjustment_case_id uuid       NOT NULL,
  person_id         uuid        NOT NULL,
  idempotency_key   text        NOT NULL,
  payload           jsonb       NOT NULL DEFAULT '{}',
  status_code       text        NOT NULL DEFAULT 'pending',  -- pending | sent | failed
  attempt_count     int         NOT NULL DEFAULT 0,
  last_attempted_at timestamptz,
  sent_at           timestamptz,
  srs_response      jsonb,
  error_detail      text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT srs_handoff_outbox_idempotency UNIQUE (idempotency_key)
);

CREATE INDEX srs_handoff_outbox_pending ON wellbeing.srs_handoff_outbox (tenant_id, status_code)
  WHERE status_code = 'pending';

-- No RLS on the outbox — accessed by the background handoff processor
-- which runs as a service account without tenant context.


-- ============================================================
-- Originally: 0005_wellbeing_ec_workflow.sql
-- ============================================================

-- Stage 5: Transactional outbox for SRS exceptional-circumstances handoff (F066)
--
-- Written atomically with an 'upheld' or 'partially_upheld' determination.
-- Only upheld claims are transmitted to SRS; not_upheld / withdrawn claims
-- remain entirely within Wellbeing and never appear in SRS board preparation.
--
-- UNIQUE(idempotency_key) is the exactly-once delivery guarantee.

CREATE TABLE wellbeing.srs_ec_handoff_outbox (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  ec_claim_id       uuid        NOT NULL,
  person_id         uuid        NOT NULL,
  idempotency_key   text        NOT NULL,
  payload           jsonb       NOT NULL DEFAULT '{}',
  status_code       text        NOT NULL DEFAULT 'pending',   -- pending | sent | failed
  attempt_count     int         NOT NULL DEFAULT 0,
  last_attempted_at timestamptz,
  sent_at           timestamptz,
  srs_response      jsonb,
  error_detail      text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT srs_ec_handoff_outbox_idempotency UNIQUE (idempotency_key)
);

CREATE INDEX srs_ec_handoff_outbox_pending ON wellbeing.srs_ec_handoff_outbox (tenant_id, status_code)
  WHERE status_code = 'pending';


-- ============================================================
-- Originally: 0006_wellbeing_mh_session_notes.sql
-- ============================================================

-- Stage 6: Mental Health session notes (local-only, never published to SRS events)
--
-- Append-only table. Session content is special-category health data (Equality Act 2010,
-- UK GDPR Art. 9). It must never appear in NATS events, SRS APIs, or aggregate reports.
-- Access is restricted to wellbeing-mental-health-advisor role (enforced at route layer).
-- RLS tenant-scopes rows identically to all other wellbeing tables.

CREATE TABLE IF NOT EXISTS wellbeing."mh_session_note" (
  "id"                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"            uuid        NOT NULL REFERENCES "tenant" ("id"),
  "mental_health_case_id" uuid       NOT NULL,
  "person_id"            uuid        NOT NULL,
  "practitioner_id"      text        NOT NULL,
  "session_date"         timestamptz NOT NULL,
  "session_type_code"    text        NOT NULL,  -- individual | group | telephone | crisis | assessment
  "content"              text        NOT NULL,  -- clinical note — local only, never serialised to events
  "actor_id"             text        NOT NULL,
  "created_at"           timestamptz NOT NULL DEFAULT now()
);

-- No UPDATE or DELETE — append-only for audit integrity
CREATE INDEX "mh_session_note_case_idx"
  ON wellbeing."mh_session_note" ("tenant_id", "mental_health_case_id");

CREATE INDEX "mh_session_note_person_idx"
  ON wellbeing."mh_session_note" ("tenant_id", "person_id");

ALTER TABLE wellbeing."mh_session_note" ENABLE ROW LEVEL SECURITY;
ALTER TABLE wellbeing."mh_session_note" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON wellbeing."mh_session_note";
CREATE POLICY tenant_isolation ON wellbeing."mh_session_note"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);


-- ============================================================
-- Originally: 0007_wellbeing_retention_sar.sql
-- ============================================================

-- Migration 0007: retention metadata + SAR export audit log
-- Adds data governance columns to wellbeing_case and a log table for GDPR SAR exports.

ALTER TABLE wellbeing.wellbeing_case
  ADD COLUMN IF NOT EXISTS lawful_basis_code       TEXT NOT NULL DEFAULT 'gdpr-art6-e',
  ADD COLUMN IF NOT EXISTS data_classification_code TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS retention_due_date       TIMESTAMPTZ;

-- SAR export log — one row per Subject Access Request export run.
-- Immutable: no UPDATE/DELETE.
CREATE TABLE IF NOT EXISTS wellbeing.sar_export_log (
  "id"                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"              UUID        NOT NULL REFERENCES "tenant" ("id"),
  "exported_for_person_id" UUID        NOT NULL,
  "requested_by_actor_id"  TEXT        NOT NULL,
  "exported_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
  "record_counts"          JSONB       NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS sar_export_log_tenant_person
  ON wellbeing.sar_export_log (tenant_id, exported_for_person_id);

ALTER TABLE wellbeing.sar_export_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY sar_export_log_tenant_isolation
  ON wellbeing.sar_export_log
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

