-- Revelation SRS — Phase 5 Assessment, Progression, and Awards Schema
-- Migration: 0004_phase5_assessment_schema
-- Applied by: packages/db/src/migrate.ts
--
-- Creates: assessment structure, marks, module results, reasonable adjustments,
--          exceptional circumstances, misconduct, exam board governance,
--          progression decisions, awards, post-ratification governance.
-- All tenant-scoped tables have RLS.
-- Bitemporal tables get temporal check constraints and current-version unique indexes.

-- ── Assessment Component ─────────────────────────────────────────────────────
-- Structural configuration per module offering. Immutable once marks ingested.
CREATE TABLE IF NOT EXISTS "assessment_component" (
  "id"                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"            uuid        NOT NULL REFERENCES "tenant"("id"),
  "module_offering_id"   uuid        NOT NULL,
  "component_type_code"  text        NOT NULL,
  "title"                text        NOT NULL,
  "weighting"            integer     NOT NULL CHECK ("weighting" BETWEEN 1 AND 100),
  "pass_mark_override"   numeric(5,2),
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  "updated_at"           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "assessment_component_offering_idx"
  ON "assessment_component" ("tenant_id", "module_offering_id");

ALTER TABLE "assessment_component" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_component" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "assessment_component";
CREATE POLICY tenant_isolation ON "assessment_component"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Assessment Submission ────────────────────────────────────────────────────
-- Append-only intake record from source systems. Links to mark via mark.assessment_submission_id.
CREATE TABLE IF NOT EXISTS "assessment_submission" (
  "id"                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"               uuid        NOT NULL REFERENCES "tenant"("id"),
  "assessment_component_id" uuid        NOT NULL REFERENCES "assessment_component"("id"),
  "module_registration_id"  uuid        NOT NULL,
  "source_system"           text        NOT NULL,
  "source_reference"        text,
  "submitted_at"            timestamptz NOT NULL DEFAULT now(),
  "superseded_at"           timestamptz,
  "raw_payload"             jsonb
);

CREATE INDEX IF NOT EXISTS "assessment_submission_registration_idx"
  ON "assessment_submission" ("tenant_id", "module_registration_id");

ALTER TABLE "assessment_submission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_submission" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "assessment_submission";
CREATE POLICY tenant_isolation ON "assessment_submission"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Mark (Bitemporal) ────────────────────────────────────────────────────────
-- Authoritative assessment mark per component/registration.
-- locked = true after board ratification; mutations require upheld post-ratification case.
CREATE TABLE IF NOT EXISTS "mark" (
  "version_id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                       uuid        NOT NULL,
  "tenant_id"                uuid        NOT NULL REFERENCES "tenant"("id"),
  "module_registration_id"   uuid        NOT NULL,
  "assessment_component_id"  uuid        NOT NULL REFERENCES "assessment_component"("id"),
  "assessment_submission_id" uuid        REFERENCES "assessment_submission"("id"),
  "attempt_number"           integer     NOT NULL DEFAULT 1,
  "raw_mark"                 numeric(5,2) NOT NULL,
  "adjusted_mark"            numeric(5,2) NOT NULL,
  "penalty_applied"          boolean     NOT NULL DEFAULT false,
  "penalty_percent"          numeric(5,2),
  "locked"                   boolean     NOT NULL DEFAULT false,
  "source_system"            text,
  "actor_id"                 text        NOT NULL,
  "valid_from"               timestamptz NOT NULL,
  "valid_to"                 timestamptz,
  "recorded_at"              timestamptz NOT NULL DEFAULT now(),
  "recorded_until"           timestamptz,
  CONSTRAINT "mark_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "mark_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "mark_unique_logical_transaction"
  ON "mark" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "mark_current_version_unique"
  ON "mark" ("tenant_id", "id")
  WHERE recorded_until IS NULL;
CREATE INDEX IF NOT EXISTS "mark_registration_idx"
  ON "mark" ("tenant_id", "module_registration_id")
  WHERE recorded_until IS NULL;

ALTER TABLE "mark" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mark" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mark";
CREATE POLICY tenant_isolation ON "mark"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Module Result (Bitemporal) ───────────────────────────────────────────────
-- Aggregate outcome per module registration. Derived from marks; never written directly by routes.
-- locked = true after board ratification.
CREATE TABLE IF NOT EXISTS "module_result" (
  "version_id"             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                     uuid        NOT NULL,
  "tenant_id"              uuid        NOT NULL REFERENCES "tenant"("id"),
  "module_registration_id" uuid        NOT NULL,
  "aggregate_mark"         numeric(5,2) NOT NULL,
  "result_code"            text        NOT NULL
                             CHECK ("result_code" IN ('pass','fail','compensated','condoned','deferred','resit-required')),
  "locked"                 boolean     NOT NULL DEFAULT false,
  "calculated_at"          timestamptz NOT NULL DEFAULT now(),
  "valid_from"             timestamptz NOT NULL,
  "valid_to"               timestamptz,
  "recorded_at"            timestamptz NOT NULL DEFAULT now(),
  "recorded_until"         timestamptz,
  CONSTRAINT "module_result_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "module_result_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "module_result_unique_logical_transaction"
  ON "module_result" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "module_result_current_version_unique"
  ON "module_result" ("tenant_id", "id")
  WHERE recorded_until IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "module_result_registration_current_unique"
  ON "module_result" ("tenant_id", "module_registration_id")
  WHERE recorded_until IS NULL;

ALTER TABLE "module_result" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "module_result" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "module_result";
CREATE POLICY tenant_isolation ON "module_result"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Reasonable Adjustment (Bitemporal) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "reasonable_adjustment" (
  "version_id"           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                   uuid        NOT NULL,
  "tenant_id"            uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"         uuid        NOT NULL,
  "person_id"            uuid        NOT NULL,
  "adjustment_type_code" text        NOT NULL,
  "scope_code"           text        NOT NULL,
  "notes"                text,
  "actor_id"             text        NOT NULL,
  "valid_from"           timestamptz NOT NULL,
  "valid_to"             timestamptz,
  "recorded_at"          timestamptz NOT NULL DEFAULT now(),
  "recorded_until"       timestamptz,
  CONSTRAINT "reasonable_adjustment_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "reasonable_adjustment_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "reasonable_adjustment_unique_logical_transaction"
  ON "reasonable_adjustment" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "reasonable_adjustment_current_version_unique"
  ON "reasonable_adjustment" ("tenant_id", "id")
  WHERE recorded_until IS NULL;
CREATE INDEX IF NOT EXISTS "reasonable_adjustment_enrolment_idx"
  ON "reasonable_adjustment" ("tenant_id", "enrolment_id")
  WHERE recorded_until IS NULL;

ALTER TABLE "reasonable_adjustment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reasonable_adjustment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "reasonable_adjustment";
CREATE POLICY tenant_isolation ON "reasonable_adjustment"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Adjustment Distribution ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "adjustment_distribution" (
  "id"              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"       uuid        NOT NULL REFERENCES "tenant"("id"),
  "adjustment_id"   uuid        NOT NULL,
  "target_system"   text        NOT NULL,
  "status_code"     text        NOT NULL DEFAULT 'pending'
                      CHECK ("status_code" IN ('pending','distributed','failed','superseded')),
  "distributed_at"  timestamptz,
  "failure_reason"  text,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "adjustment_distribution_adjustment_idx"
  ON "adjustment_distribution" ("adjustment_id");

ALTER TABLE "adjustment_distribution" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "adjustment_distribution" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "adjustment_distribution";
CREATE POLICY tenant_isolation ON "adjustment_distribution"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Exceptional Circumstances (Bitemporal) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "exceptional_circumstances" (
  "version_id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                  uuid        NOT NULL,
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"        uuid        NOT NULL,
  "person_id"           uuid        NOT NULL,
  "module_offering_id"  uuid,
  "outcome_code"        text        NOT NULL,
  "determination_date"  date        NOT NULL,
  "notes"               text,
  "actor_id"            text        NOT NULL,
  "valid_from"          timestamptz NOT NULL,
  "valid_to"            timestamptz,
  "recorded_at"         timestamptz NOT NULL DEFAULT now(),
  "recorded_until"      timestamptz,
  CONSTRAINT "exceptional_circumstances_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "exceptional_circumstances_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "exceptional_circumstances_unique_logical_transaction"
  ON "exceptional_circumstances" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "exceptional_circumstances_current_version_unique"
  ON "exceptional_circumstances" ("tenant_id", "id")
  WHERE recorded_until IS NULL;
CREATE INDEX IF NOT EXISTS "exceptional_circumstances_enrolment_idx"
  ON "exceptional_circumstances" ("tenant_id", "enrolment_id")
  WHERE recorded_until IS NULL;

ALTER TABLE "exceptional_circumstances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exceptional_circumstances" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "exceptional_circumstances";
CREATE POLICY tenant_isolation ON "exceptional_circumstances"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── EC Board Visibility ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "exceptional_circumstances_board_visibility" (
  "id"                           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                    uuid        NOT NULL REFERENCES "tenant"("id"),
  "exceptional_circumstances_id" uuid        NOT NULL,
  "exam_board_data_pack_id"      uuid        NOT NULL,
  "added_at"                     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "exceptional_circumstances_board_visibility" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exceptional_circumstances_board_visibility" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "exceptional_circumstances_board_visibility";
CREATE POLICY tenant_isolation ON "exceptional_circumstances_board_visibility"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Misconduct Case Reference (Bitemporal) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "misconduct_case_reference" (
  "version_id"       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"               uuid        NOT NULL,
  "tenant_id"        uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"     uuid        NOT NULL,
  "person_id"        uuid        NOT NULL,
  "case_reference"   text        NOT NULL,
  "case_status_code" text        NOT NULL,
  "actor_id"         text        NOT NULL,
  "valid_from"       timestamptz NOT NULL,
  "valid_to"         timestamptz,
  "recorded_at"      timestamptz NOT NULL DEFAULT now(),
  "recorded_until"   timestamptz,
  CONSTRAINT "misconduct_case_reference_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "misconduct_case_reference_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "misconduct_case_reference_unique_logical_transaction"
  ON "misconduct_case_reference" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "misconduct_case_reference_current_version_unique"
  ON "misconduct_case_reference" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

ALTER TABLE "misconduct_case_reference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "misconduct_case_reference" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "misconduct_case_reference";
CREATE POLICY tenant_isolation ON "misconduct_case_reference"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Misconduct Outcome (Bitemporal) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "misconduct_outcome" (
  "version_id"       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"               uuid        NOT NULL,
  "tenant_id"        uuid        NOT NULL REFERENCES "tenant"("id"),
  "misconduct_case_id" uuid      NOT NULL,
  "enrolment_id"     uuid        NOT NULL,
  "penalty_code"     text        NOT NULL
                       CHECK ("penalty_code" IN ('mark-reduction','mark-cap','module-fail','progression-block','exclusion')),
  "effective_date"   date        NOT NULL,
  "actor_id"         text        NOT NULL,
  "valid_from"       timestamptz NOT NULL,
  "valid_to"         timestamptz,
  "recorded_at"      timestamptz NOT NULL DEFAULT now(),
  "recorded_until"   timestamptz,
  CONSTRAINT "misconduct_outcome_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "misconduct_outcome_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "misconduct_outcome_unique_logical_transaction"
  ON "misconduct_outcome" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "misconduct_outcome_current_version_unique"
  ON "misconduct_outcome" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

ALTER TABLE "misconduct_outcome" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "misconduct_outcome" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "misconduct_outcome";
CREATE POLICY tenant_isolation ON "misconduct_outcome"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Misconduct Penalty Effect (Bitemporal) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "misconduct_penalty_effect" (
  "version_id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                  uuid        NOT NULL,
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant"("id"),
  "misconduct_outcome_id" uuid      NOT NULL,
  "target_entity_type"  text        NOT NULL,
  "target_entity_id"    uuid        NOT NULL,
  "penalty_detail"      text,
  "valid_from"          timestamptz NOT NULL,
  "valid_to"            timestamptz,
  "recorded_at"         timestamptz NOT NULL DEFAULT now(),
  "recorded_until"      timestamptz,
  CONSTRAINT "misconduct_penalty_effect_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "misconduct_penalty_effect_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "misconduct_penalty_effect_unique_logical_transaction"
  ON "misconduct_penalty_effect" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "misconduct_penalty_effect_current_version_unique"
  ON "misconduct_penalty_effect" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

ALTER TABLE "misconduct_penalty_effect" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "misconduct_penalty_effect" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "misconduct_penalty_effect";
CREATE POLICY tenant_isolation ON "misconduct_penalty_effect"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Exam Board ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "exam_board" (
  "id"                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid        NOT NULL REFERENCES "tenant"("id"),
  "board_type_code"   text        NOT NULL CHECK ("board_type_code" IN ('module','award')),
  "academic_year"     text        NOT NULL,
  "academic_period_id" uuid,
  "meeting_date"      text,
  "ratified_at"       timestamptz,
  "actor_id"          text        NOT NULL,
  "created_at"        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "exam_board_tenant_year_idx"
  ON "exam_board" ("tenant_id", "academic_year");

ALTER TABLE "exam_board" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exam_board" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "exam_board";
CREATE POLICY tenant_isolation ON "exam_board"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Exam Board Data Pack ─────────────────────────────────────────────────────
-- Snapshot payload is immutable once created. superseded_by_id is the only
-- mutable metadata field and is set when a newer pack is generated.
CREATE TABLE IF NOT EXISTS "exam_board_data_pack" (
  "id"                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"               uuid        NOT NULL REFERENCES "tenant"("id"),
  "exam_board_id"           uuid        NOT NULL REFERENCES "exam_board"("id"),
  "pack_version"            integer     NOT NULL DEFAULT 1,
  "superseded_by_id"        uuid        REFERENCES "exam_board_data_pack"("id"),
  "source_transaction_time" timestamptz NOT NULL,
  "candidate_count"         integer     NOT NULL DEFAULT 0,
  "generated_at"            timestamptz NOT NULL DEFAULT now(),
  "generated_by"            text        NOT NULL
);

CREATE INDEX IF NOT EXISTS "exam_board_data_pack_board_idx"
  ON "exam_board_data_pack" ("exam_board_id");

ALTER TABLE "exam_board_data_pack" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exam_board_data_pack" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "exam_board_data_pack";
CREATE POLICY tenant_isolation ON "exam_board_data_pack"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Exam Board Candidate Profile ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "exam_board_candidate_profile" (
  "id"           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"    uuid        NOT NULL REFERENCES "tenant"("id"),
  "data_pack_id" uuid        NOT NULL REFERENCES "exam_board_data_pack"("id"),
  "enrolment_id" uuid        NOT NULL,
  "person_id"    uuid        NOT NULL,
  "profile_data" jsonb       NOT NULL,
  "created_at"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "exam_board_candidate_profile_pack_idx"
  ON "exam_board_candidate_profile" ("data_pack_id");
CREATE UNIQUE INDEX IF NOT EXISTS "exam_board_candidate_profile_pack_enrolment_unique"
  ON "exam_board_candidate_profile" ("data_pack_id", "enrolment_id");

ALTER TABLE "exam_board_candidate_profile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exam_board_candidate_profile" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "exam_board_candidate_profile";
CREATE POLICY tenant_isolation ON "exam_board_candidate_profile"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Exam Board Member Attendance ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "exam_board_member_attendance" (
  "id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"     uuid        NOT NULL REFERENCES "tenant"("id"),
  "exam_board_id" uuid        NOT NULL REFERENCES "exam_board"("id"),
  "actor_id"      text        NOT NULL,
  "role_code"     text        NOT NULL,
  "attended_at"   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "exam_board_member_attendance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exam_board_member_attendance" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "exam_board_member_attendance";
CREATE POLICY tenant_isolation ON "exam_board_member_attendance"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── External Examiner Sign-off ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "external_examiner_signoff" (
  "id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"     uuid        NOT NULL REFERENCES "tenant"("id"),
  "exam_board_id" uuid        NOT NULL REFERENCES "exam_board"("id"),
  "actor_id"      text        NOT NULL,
  "commentary"    text,
  "signed_off_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "external_examiner_signoff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "external_examiner_signoff" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "external_examiner_signoff";
CREATE POLICY tenant_isolation ON "external_examiner_signoff"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Progression Decision (Bitemporal) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "progression_decision" (
  "version_id"    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"            uuid        NOT NULL,
  "tenant_id"     uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"  uuid        NOT NULL,
  "academic_year" text        NOT NULL,
  "year_of_study" text        NOT NULL,
  "decision_code" text        NOT NULL
                    CHECK ("decision_code" IN ('progress','resit','repeat-year','withdraw')),
  "exam_board_id" uuid,
  "locked"        boolean     NOT NULL DEFAULT false,
  "actor_id"      text        NOT NULL,
  "valid_from"    timestamptz NOT NULL,
  "valid_to"      timestamptz,
  "recorded_at"   timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz,
  CONSTRAINT "progression_decision_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "progression_decision_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "progression_decision_unique_logical_transaction"
  ON "progression_decision" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "progression_decision_current_version_unique"
  ON "progression_decision" ("tenant_id", "id")
  WHERE recorded_until IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "progression_decision_enrolment_year_current_unique"
  ON "progression_decision" ("tenant_id", "enrolment_id", "academic_year")
  WHERE recorded_until IS NULL;

ALTER TABLE "progression_decision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "progression_decision" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "progression_decision";
CREATE POLICY tenant_isolation ON "progression_decision"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Award (Bitemporal) ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "award" (
  "version_id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                    uuid        NOT NULL,
  "tenant_id"             uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"          uuid        NOT NULL,
  "person_id"             uuid        NOT NULL,
  "exam_board_id"         uuid        NOT NULL REFERENCES "exam_board"("id"),
  "qualification_code"    text        NOT NULL,
  "classification_code"   text        NOT NULL,
  "award_date"            text        NOT NULL,
  "hear_generated_at"     timestamptz,
  "certificate_issued_at" timestamptz,
  "hear_document"         jsonb,
  "actor_id"              text        NOT NULL,
  "valid_from"            timestamptz NOT NULL,
  "valid_to"              timestamptz,
  "recorded_at"           timestamptz NOT NULL DEFAULT now(),
  "recorded_until"        timestamptz,
  CONSTRAINT "award_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "award_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "award_unique_logical_transaction"
  ON "award" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "award_current_version_unique"
  ON "award" ("tenant_id", "id")
  WHERE recorded_until IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "award_enrolment_current_unique"
  ON "award" ("tenant_id", "enrolment_id")
  WHERE recorded_until IS NULL;

ALTER TABLE "award" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "award" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "award";
CREATE POLICY tenant_isolation ON "award"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Post-Ratification Case (Bitemporal) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "post_ratification_case" (
  "version_id"    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"            uuid        NOT NULL,
  "tenant_id"     uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"  uuid        NOT NULL,
  "case_type_code" text       NOT NULL CHECK ("case_type_code" IN ('appeal','administrative-correction')),
  "status_code"   text        NOT NULL DEFAULT 'submitted'
                    CHECK ("status_code" IN ('submitted','under-review','upheld','dismissed','not-eligible')),
  "reference"     text,
  "actor_id"      text        NOT NULL,
  "valid_from"    timestamptz NOT NULL,
  "valid_to"      timestamptz,
  "recorded_at"   timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz,
  CONSTRAINT "post_ratification_case_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "post_ratification_case_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "post_ratification_case_unique_logical_transaction"
  ON "post_ratification_case" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "post_ratification_case_current_version_unique"
  ON "post_ratification_case" ("tenant_id", "id")
  WHERE recorded_until IS NULL;
CREATE INDEX IF NOT EXISTS "post_ratification_case_enrolment_idx"
  ON "post_ratification_case" ("tenant_id", "enrolment_id")
  WHERE recorded_until IS NULL;

ALTER TABLE "post_ratification_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "post_ratification_case" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "post_ratification_case";
CREATE POLICY tenant_isolation ON "post_ratification_case"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Post-Ratification Amendment ──────────────────────────────────────────────
-- Append-only; the only authorised path to amend a locked entity.
CREATE TABLE IF NOT EXISTS "post_ratification_amendment" (
  "id"              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"       uuid        NOT NULL REFERENCES "tenant"("id"),
  "case_id"         uuid        NOT NULL,
  "entity_type"     text        NOT NULL CHECK ("entity_type" IN ('mark','module_result','progression_decision')),
  "entity_id"       uuid        NOT NULL,
  "before_value"    jsonb       NOT NULL,
  "after_value"     jsonb       NOT NULL,
  "authorised_by"   text        NOT NULL,
  "amended_at"      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "post_ratification_amendment_case_idx"
  ON "post_ratification_amendment" ("case_id");

ALTER TABLE "post_ratification_amendment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "post_ratification_amendment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "post_ratification_amendment";
CREATE POLICY tenant_isolation ON "post_ratification_amendment"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
