-- Revelation SRS — Phase 4 Domain Schema
-- Migration: 0002_phase4_domain_schema
-- Applied by: packages/db/src/migrate.ts
--
-- Creates: student identity tables, enrolment tables,
--          programme/module catalogue, academic calendar, module registration.
-- All tenant-scoped tables have RLS.
-- Bitemporal tables get temporal check constraints and current-version unique indexes.

-- ── Student number sequence ───────────────────────────────────────────────────
-- Platform-wide sequence; student numbers are formatted by the application.
CREATE SEQUENCE IF NOT EXISTS student_number_seq START WITH 1000001;

-- ── Person (student root record) ─────────────────────────────────────────────
-- Non-bitemporal: personal data changes are in person_identity.
CREATE TABLE IF NOT EXISTS "person" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant"("id"),
  "student_number"      text        NOT NULL,
  "hesa_id"             text,
  "person_status_code"  text        NOT NULL DEFAULT 'prospective'
                          CHECK ("person_status_code" IN ('prospective','student','alumnus','deceased','merged')),
  "source_system"       text,
  "source_reference"    text,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "person_tenant_student_number_unique" UNIQUE ("tenant_id", "student_number")
);

CREATE INDEX IF NOT EXISTS "person_tenant_idx" ON "person" ("tenant_id");
CREATE INDEX IF NOT EXISTS "person_tenant_status_idx" ON "person" ("tenant_id", "person_status_code");

ALTER TABLE "person" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "person" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "person";
CREATE POLICY tenant_isolation ON "person"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Person Identity (Bitemporal) ─────────────────────────────────────────────
-- Legal name, demographics, contact details.  Includes special-category fields.
CREATE TABLE IF NOT EXISTS "person_identity" (
  "version_id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                  uuid        NOT NULL,
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant"("id"),
  "person_id"           uuid        NOT NULL REFERENCES "person"("id"),
  "legal_first_name"    text        NOT NULL,
  "legal_family_name"   text        NOT NULL,
  "preferred_name"      text,
  "date_of_birth"       date,
  "gender_code"         text,
  "nationality_code"    text,
  "domicile_code"       text,
  "ethnicity_code"      text,
  "email_institutional" text,
  "email_personal"      text,
  "phone_mobile"        text,
  "valid_from"          timestamptz NOT NULL,
  "valid_to"            timestamptz,
  "recorded_at"         timestamptz NOT NULL DEFAULT now(),
  "recorded_until"      timestamptz,
  CONSTRAINT "person_identity_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "person_identity_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "person_identity_unique_logical_transaction"
  ON "person_identity" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "person_identity_current_version_unique"
  ON "person_identity" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

CREATE INDEX IF NOT EXISTS "person_identity_person_idx" ON "person_identity" ("tenant_id", "person_id");

ALTER TABLE "person_identity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "person_identity" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "person_identity";
CREATE POLICY tenant_isolation ON "person_identity"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Student Address (Bitemporal) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "student_address" (
  "version_id"       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"               uuid        NOT NULL,
  "tenant_id"        uuid        NOT NULL REFERENCES "tenant"("id"),
  "person_id"        uuid        NOT NULL REFERENCES "person"("id"),
  "address_type_code" text       NOT NULL
                       CHECK ("address_type_code" IN ('home','term','correspondence')),
  "line1"            text        NOT NULL,
  "line2"            text,
  "city"             text,
  "postcode"         text,
  "country_code"     text,
  "valid_from"       timestamptz NOT NULL,
  "valid_to"         timestamptz,
  "recorded_at"      timestamptz NOT NULL DEFAULT now(),
  "recorded_until"   timestamptz,
  CONSTRAINT "student_address_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "student_address_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "student_address_unique_logical_transaction"
  ON "student_address" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "student_address_current_version_unique"
  ON "student_address" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

ALTER TABLE "student_address" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "student_address" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "student_address";
CREATE POLICY tenant_isolation ON "student_address"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Student Contact Method (Bitemporal) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "student_contact_method" (
  "version_id"        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                uuid        NOT NULL,
  "tenant_id"         uuid        NOT NULL REFERENCES "tenant"("id"),
  "person_id"         uuid        NOT NULL REFERENCES "person"("id"),
  "contact_type_code" text        NOT NULL,
  "contact_value"     text        NOT NULL,
  "is_primary"        boolean     NOT NULL DEFAULT false,
  "verified_at"       timestamptz,
  "valid_from"        timestamptz NOT NULL,
  "valid_to"          timestamptz,
  "recorded_at"       timestamptz NOT NULL DEFAULT now(),
  "recorded_until"    timestamptz,
  CONSTRAINT "student_contact_method_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "student_contact_method_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "student_contact_method_unique_logical_transaction"
  ON "student_contact_method" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "student_contact_method_current_version_unique"
  ON "student_contact_method" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

ALTER TABLE "student_contact_method" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "student_contact_method" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "student_contact_method";
CREATE POLICY tenant_isolation ON "student_contact_method"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Disability Declaration (Bitemporal) ──────────────────────────────────────
-- Special-category data; read audit mandatory.
CREATE TABLE IF NOT EXISTS "disability_declaration" (
  "version_id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                       uuid        NOT NULL,
  "tenant_id"                uuid        NOT NULL REFERENCES "tenant"("id"),
  "person_id"                uuid        NOT NULL REFERENCES "person"("id"),
  "disability_category_code" text        NOT NULL,
  "declaration_status_code"  text        NOT NULL DEFAULT 'declared'
                               CHECK ("declaration_status_code" IN ('declared','withdrawn','updated')),
  "declared_at"              timestamptz NOT NULL DEFAULT now(),
  "valid_from"               timestamptz NOT NULL,
  "valid_to"                 timestamptz,
  "recorded_at"              timestamptz NOT NULL DEFAULT now(),
  "recorded_until"           timestamptz,
  CONSTRAINT "disability_declaration_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "disability_declaration_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "disability_declaration_unique_logical_transaction"
  ON "disability_declaration" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "disability_declaration_current_version_unique"
  ON "disability_declaration" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

ALTER TABLE "disability_declaration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "disability_declaration" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "disability_declaration";
CREATE POLICY tenant_isolation ON "disability_declaration"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Identity Verification Check (Bitemporal) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS "identity_verification_check" (
  "version_id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                  uuid        NOT NULL,
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant"("id"),
  "person_id"           uuid        NOT NULL REFERENCES "person"("id"),
  "status_code"         text        NOT NULL
                          CHECK ("status_code" IN ('requested','verified','failed','fraud-flagged')),
  "confidence_score"    smallint,
  "fraud_flag"          boolean     NOT NULL DEFAULT false,
  "provider_reference"  text,
  "requested_at"        timestamptz NOT NULL DEFAULT now(),
  "completed_at"        timestamptz,
  "valid_from"          timestamptz NOT NULL,
  "valid_to"            timestamptz,
  "recorded_at"         timestamptz NOT NULL DEFAULT now(),
  "recorded_until"      timestamptz,
  CONSTRAINT "identity_verification_check_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "identity_verification_check_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "identity_verification_check_unique_logical_transaction"
  ON "identity_verification_check" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "identity_verification_check_current_version_unique"
  ON "identity_verification_check" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

ALTER TABLE "identity_verification_check" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identity_verification_check" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "identity_verification_check";
CREATE POLICY tenant_isolation ON "identity_verification_check"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Enrolment (Bitemporal) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "enrolment" (
  "version_id"           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                   uuid        NOT NULL,
  "tenant_id"            uuid        NOT NULL REFERENCES "tenant"("id"),
  "person_id"            uuid        NOT NULL REFERENCES "person"("id"),
  "programme_id"         uuid,
  "status_code"          text        NOT NULL DEFAULT 'enrolled'
                           CHECK ("status_code" IN ('enrolled','intermitting','withdrawn','suspended','graduated')),
  "mode_of_study_code"   text        NOT NULL
                           CHECK ("mode_of_study_code" IN ('full-time','part-time','distance','sandwich')),
  "attendance_type_code" text,
  "academic_year_of_entry" text      NOT NULL,
  "start_date"           date        NOT NULL,
  "expected_end_date"    date,
  "actual_end_date"      date,
  "fee_band_code"        text,
  "funding_source_code"  text
                           CHECK ("funding_source_code" IS NULL OR "funding_source_code" IN ('slc','self-funded','employer','international','bursary','research-council')),
  "slc_reference"        text,
  "ucas_personal_id"     text,
  "valid_from"           timestamptz NOT NULL,
  "valid_to"             timestamptz,
  "recorded_at"          timestamptz NOT NULL DEFAULT now(),
  "recorded_until"       timestamptz,
  CONSTRAINT "enrolment_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "enrolment_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "enrolment_unique_logical_transaction"
  ON "enrolment" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "enrolment_current_version_unique"
  ON "enrolment" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

CREATE INDEX IF NOT EXISTS "enrolment_person_idx" ON "enrolment" ("tenant_id", "person_id");
CREATE INDEX IF NOT EXISTS "enrolment_status_idx" ON "enrolment" ("tenant_id", "status_code") WHERE recorded_until IS NULL;

ALTER TABLE "enrolment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "enrolment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "enrolment";
CREATE POLICY tenant_isolation ON "enrolment"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Enrolment Status Transition Ledger ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS "enrolment_status_transition" (
  "id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"     uuid        NOT NULL,
  "from_status_code" text        NOT NULL,
  "to_status_code"   text        NOT NULL,
  "reason_code"      text,
  "reason_text"      text,
  "effective_at"     timestamptz NOT NULL,
  "actor_id"         text        NOT NULL,
  "created_at"       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "enrolment_status_transition_enrolment_idx"
  ON "enrolment_status_transition" ("tenant_id", "enrolment_id", "created_at");

ALTER TABLE "enrolment_status_transition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "enrolment_status_transition" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "enrolment_status_transition";
CREATE POLICY tenant_isolation ON "enrolment_status_transition"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Fee Liability Ledger (F009) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "fee_liability" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"        uuid        NOT NULL,
  "person_id"           uuid        NOT NULL REFERENCES "person"("id"),
  "academic_year"       text        NOT NULL,
  "fee_band_code"       text,
  "funding_source_code" text,
  "amount_pence"        integer,
  "status_code"         text        NOT NULL DEFAULT 'generated'
                           CHECK ("status_code" IN ('generated','superseded','cancelled')),
  "generated_at"        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "fee_liability_enrolment_idx"
  ON "fee_liability" ("tenant_id", "enrolment_id", "generated_at");

ALTER TABLE "fee_liability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fee_liability" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "fee_liability";
CREATE POLICY tenant_isolation ON "fee_liability"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Enrolment Downstream Trigger Ledger (F046/F049/F051) ────────────────────
CREATE TABLE IF NOT EXISTS "enrolment_downstream_trigger" (
  "id"                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"      uuid        NOT NULL,
  "trigger_type_code" text        NOT NULL
                          CHECK ("trigger_type_code" IN ('ucas-confirmation','slc-confirmation','ukvi-cas')),
  "status_code"       text        NOT NULL DEFAULT 'pending'
                          CHECK ("status_code" IN ('pending','sent','acknowledged','failed','cancelled')),
  "payload_summary"   jsonb,
  "correlation_id"    uuid,
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "sent_at"           timestamptz
);

CREATE INDEX IF NOT EXISTS "enrolment_downstream_trigger_enrolment_idx"
  ON "enrolment_downstream_trigger" ("tenant_id", "enrolment_id", "trigger_type_code");

ALTER TABLE "enrolment_downstream_trigger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "enrolment_downstream_trigger" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "enrolment_downstream_trigger";
CREATE POLICY tenant_isolation ON "enrolment_downstream_trigger"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Re-enrolment Period ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "reenrolment_period" (
  "id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"     uuid        NOT NULL REFERENCES "tenant"("id"),
  "academic_year" text        NOT NULL,
  "programme_id"  uuid,
  "opens_at"      timestamptz NOT NULL,
  "closes_at"     timestamptz NOT NULL,
  "reminder_at"   timestamptz,
  CONSTRAINT "reenrolment_period_closes_after_opens"
    CHECK ("closes_at" > "opens_at")
);

CREATE INDEX IF NOT EXISTS "reenrolment_period_tenant_idx" ON "reenrolment_period" ("tenant_id");

ALTER TABLE "reenrolment_period" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reenrolment_period" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "reenrolment_period";
CREATE POLICY tenant_isolation ON "reenrolment_period"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Re-enrolment Confirmation (Bitemporal) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "reenrolment_confirmation" (
  "version_id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                    uuid        NOT NULL,
  "tenant_id"             uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"          uuid        NOT NULL,
  "reenrolment_period_id" uuid        NOT NULL REFERENCES "reenrolment_period"("id"),
  "status_code"           text        NOT NULL DEFAULT 'pending'
                            CHECK ("status_code" IN ('pending','confirmed','lapsed')),
  "confirmed_at"          timestamptz,
  "valid_from"            timestamptz NOT NULL,
  "valid_to"              timestamptz,
  "recorded_at"           timestamptz NOT NULL DEFAULT now(),
  "recorded_until"        timestamptz,
  CONSTRAINT "reenrolment_confirmation_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "reenrolment_confirmation_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "reenrolment_confirmation_unique_logical_transaction"
  ON "reenrolment_confirmation" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "reenrolment_confirmation_current_version_unique"
  ON "reenrolment_confirmation" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

ALTER TABLE "reenrolment_confirmation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reenrolment_confirmation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "reenrolment_confirmation";
CREATE POLICY tenant_isolation ON "reenrolment_confirmation"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Awarding Body ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "awarding_body" (
  "id"        uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid    NOT NULL REFERENCES "tenant"("id"),
  "code"      text    NOT NULL,
  "name"      text    NOT NULL,
  "active"    boolean NOT NULL DEFAULT true,
  CONSTRAINT "awarding_body_tenant_code_unique" UNIQUE ("tenant_id", "code")
);

CREATE INDEX IF NOT EXISTS "awarding_body_tenant_idx" ON "awarding_body" ("tenant_id");

ALTER TABLE "awarding_body" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "awarding_body" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "awarding_body";
CREATE POLICY tenant_isolation ON "awarding_body"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Programme (Bitemporal) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "programme" (
  "version_id"              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                      uuid        NOT NULL,
  "tenant_id"               uuid        NOT NULL REFERENCES "tenant"("id"),
  "code"                    text        NOT NULL,
  "title"                   text        NOT NULL,
  "qualification_type_code" text,
  "awarding_body_id"        uuid,
  "owning_school"           text,
  "credit_framework_code"   text,
  "fheq_level"              smallint,
  "credit_total"            smallint,
  "duration_years"          smallint,
  "mode_of_study_code"      text,
  "source_system_reference" text,
  "valid_from"              timestamptz NOT NULL,
  "valid_to"                timestamptz,
  "recorded_at"             timestamptz NOT NULL DEFAULT now(),
  "recorded_until"          timestamptz,
  CONSTRAINT "programme_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "programme_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "programme_unique_logical_transaction"
  ON "programme" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "programme_current_version_unique"
  ON "programme" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

CREATE INDEX IF NOT EXISTS "programme_tenant_code_idx" ON "programme" ("tenant_id", "code") WHERE recorded_until IS NULL;

ALTER TABLE "programme" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "programme" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "programme";
CREATE POLICY tenant_isolation ON "programme"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Programme Route (Bitemporal) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "programme_route" (
  "version_id"  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"          uuid        NOT NULL,
  "tenant_id"   uuid        NOT NULL REFERENCES "tenant"("id"),
  "programme_id" uuid       NOT NULL,
  "route_code"  text        NOT NULL,
  "title"       text        NOT NULL,
  "valid_from"  timestamptz NOT NULL,
  "valid_to"    timestamptz,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz,
  CONSTRAINT "programme_route_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "programme_route_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "programme_route_unique_logical_transaction"
  ON "programme_route" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "programme_route_current_version_unique"
  ON "programme_route" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

ALTER TABLE "programme_route" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "programme_route" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "programme_route";
CREATE POLICY tenant_isolation ON "programme_route"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Programme Rule Set (Bitemporal) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "programme_rule_set" (
  "version_id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                  uuid        NOT NULL,
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant"("id"),
  "programme_id"        uuid        NOT NULL,
  "programme_route_id"  uuid,
  "entry_academic_year" text,
  "rule_set_code"       text        NOT NULL,
  "description"         text,
  "valid_from"          timestamptz NOT NULL,
  "valid_to"            timestamptz,
  "recorded_at"         timestamptz NOT NULL DEFAULT now(),
  "recorded_until"      timestamptz,
  CONSTRAINT "programme_rule_set_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "programme_rule_set_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "programme_rule_set_unique_logical_transaction"
  ON "programme_rule_set" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "programme_rule_set_current_version_unique"
  ON "programme_rule_set" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

ALTER TABLE "programme_rule_set" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "programme_rule_set" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "programme_rule_set";
CREATE POLICY tenant_isolation ON "programme_rule_set"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Module (Bitemporal) ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "module" (
  "version_id"              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                      uuid        NOT NULL,
  "tenant_id"               uuid        NOT NULL REFERENCES "tenant"("id"),
  "code"                    text        NOT NULL,
  "title"                   text        NOT NULL,
  "credit_value"            smallint,
  "fheq_level"              smallint,
  "source_system_reference" text,
  "valid_from"              timestamptz NOT NULL,
  "valid_to"                timestamptz,
  "recorded_at"             timestamptz NOT NULL DEFAULT now(),
  "recorded_until"          timestamptz,
  CONSTRAINT "module_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "module_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "module_unique_logical_transaction"
  ON "module" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "module_current_version_unique"
  ON "module" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

CREATE INDEX IF NOT EXISTS "module_tenant_code_idx" ON "module" ("tenant_id", "code") WHERE recorded_until IS NULL;

ALTER TABLE "module" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "module" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "module";
CREATE POLICY tenant_isolation ON "module"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Module Relationship (Bitemporal) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "module_relationship" (
  "version_id"             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                     uuid        NOT NULL,
  "tenant_id"              uuid        NOT NULL REFERENCES "tenant"("id"),
  "module_id"              uuid        NOT NULL,
  "related_module_id"      uuid        NOT NULL,
  "relationship_type_code" text        NOT NULL
                             CHECK ("relationship_type_code" IN ('prerequisite','co-requisite','exclusion')),
  "valid_from"             timestamptz NOT NULL,
  "valid_to"               timestamptz,
  "recorded_at"            timestamptz NOT NULL DEFAULT now(),
  "recorded_until"         timestamptz,
  CONSTRAINT "module_relationship_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "module_relationship_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "module_relationship_unique_logical_transaction"
  ON "module_relationship" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "module_relationship_current_version_unique"
  ON "module_relationship" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

ALTER TABLE "module_relationship" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "module_relationship" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "module_relationship";
CREATE POLICY tenant_isolation ON "module_relationship"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Assessment Pattern (Bitemporal) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "assessment_pattern" (
  "version_id"       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"               uuid        NOT NULL,
  "tenant_id"        uuid        NOT NULL REFERENCES "tenant"("id"),
  "module_id"        uuid        NOT NULL,
  "pattern_code"     text        NOT NULL,
  "description"      text,
  "component_schema" jsonb,
  "valid_from"       timestamptz NOT NULL,
  "valid_to"         timestamptz,
  "recorded_at"      timestamptz NOT NULL DEFAULT now(),
  "recorded_until"   timestamptz,
  CONSTRAINT "assessment_pattern_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "assessment_pattern_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "assessment_pattern_unique_logical_transaction"
  ON "assessment_pattern" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "assessment_pattern_current_version_unique"
  ON "assessment_pattern" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

ALTER TABLE "assessment_pattern" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_pattern" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "assessment_pattern";
CREATE POLICY tenant_isolation ON "assessment_pattern"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Learning Outcome (Bitemporal) ─────────────────────────────────────────────
-- Exactly one of programme_id or module_id must be non-null.
CREATE TABLE IF NOT EXISTS "learning_outcome" (
  "version_id"   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"           uuid        NOT NULL,
  "tenant_id"    uuid        NOT NULL REFERENCES "tenant"("id"),
  "programme_id" uuid,
  "module_id"    uuid,
  "outcome_code" text        NOT NULL,
  "description"  text        NOT NULL,
  "valid_from"   timestamptz NOT NULL,
  "valid_to"     timestamptz,
  "recorded_at"  timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz,
  CONSTRAINT "learning_outcome_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "learning_outcome_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at),
  CONSTRAINT "learning_outcome_exactly_one_parent"
    CHECK (("programme_id" IS NOT NULL)::int + ("module_id" IS NOT NULL)::int = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS "learning_outcome_unique_logical_transaction"
  ON "learning_outcome" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "learning_outcome_current_version_unique"
  ON "learning_outcome" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

ALTER TABLE "learning_outcome" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "learning_outcome" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "learning_outcome";
CREATE POLICY tenant_isolation ON "learning_outcome"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Academic Period ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "academic_period" (
  "id"              uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"       uuid  NOT NULL REFERENCES "tenant"("id"),
  "academic_year"   text  NOT NULL,
  "period_code"     text  NOT NULL,
  "period_type_code" text NOT NULL
                      CHECK ("period_type_code" IN ('semester','term','year')),
  "start_date"      date  NOT NULL,
  "end_date"        date  NOT NULL,
  CONSTRAINT "academic_period_tenant_year_code_unique"
    UNIQUE ("tenant_id", "academic_year", "period_code"),
  CONSTRAINT "academic_period_end_after_start"
    CHECK ("end_date" > "start_date")
);

CREATE INDEX IF NOT EXISTS "academic_period_tenant_year_idx" ON "academic_period" ("tenant_id", "academic_year");

ALTER TABLE "academic_period" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "academic_period" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "academic_period";
CREATE POLICY tenant_isolation ON "academic_period"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Module Offering ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "module_offering" (
  "id"                uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid     NOT NULL REFERENCES "tenant"("id"),
  "module_id"         uuid     NOT NULL,
  "academic_period_id" uuid    NOT NULL REFERENCES "academic_period"("id"),
  "delivery_mode_code" text,
  "capacity"          smallint
);

CREATE INDEX IF NOT EXISTS "module_offering_tenant_idx" ON "module_offering" ("tenant_id");
CREATE INDEX IF NOT EXISTS "module_offering_period_idx" ON "module_offering" ("tenant_id", "academic_period_id");

ALTER TABLE "module_offering" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "module_offering" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "module_offering";
CREATE POLICY tenant_isolation ON "module_offering"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Module Registration (Bitemporal) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "module_registration" (
  "version_id"         uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                 uuid  NOT NULL,
  "tenant_id"          uuid  NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"       uuid  NOT NULL,
  "module_offering_id" uuid  NOT NULL REFERENCES "module_offering"("id"),
  "status_code"        text  NOT NULL DEFAULT 'registered'
                         CHECK ("status_code" IN ('registered','withdrawn','completed')),
  "registration_date"  date  NOT NULL,
  "valid_from"         timestamptz NOT NULL,
  "valid_to"           timestamptz,
  "recorded_at"        timestamptz NOT NULL DEFAULT now(),
  "recorded_until"     timestamptz,
  CONSTRAINT "module_registration_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "module_registration_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "module_registration_unique_logical_transaction"
  ON "module_registration" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "module_registration_current_version_unique"
  ON "module_registration" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

CREATE INDEX IF NOT EXISTS "module_registration_enrolment_idx"
  ON "module_registration" ("tenant_id", "enrolment_id")
  WHERE recorded_until IS NULL;

ALTER TABLE "module_registration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "module_registration" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "module_registration";
CREATE POLICY tenant_isolation ON "module_registration"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
