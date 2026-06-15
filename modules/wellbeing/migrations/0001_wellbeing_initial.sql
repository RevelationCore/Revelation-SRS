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
