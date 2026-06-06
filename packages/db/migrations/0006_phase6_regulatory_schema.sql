-- Revelation SRS — Phase 6 Regulatory Compliance Schema
-- Migration: 0006_phase6_regulatory_schema
-- Applied by: packages/db/src/migrate.ts
--
-- Creates regulatory exchange, statutory return, FOI, regulatory profile, and
-- exam entry foundation tables. Tenant-owned tables have RLS. Bitemporal tables
-- get standard temporal checks and current-version indexes.

-- Phase 6 drains the Phase 4 downstream trigger queue. Extend the existing
-- terminal statuses so services can mark a trigger processed after writing the
-- integration exchange ledger row.
ALTER TABLE "enrolment_downstream_trigger"
  DROP CONSTRAINT IF EXISTS "enrolment_downstream_trigger_status_code_check";
ALTER TABLE "enrolment_downstream_trigger"
  ADD CONSTRAINT "enrolment_downstream_trigger_status_code_check"
    CHECK ("status_code" IN ('pending','sent','processed','acknowledged','failed','cancelled'));

-- ── UCAS Application (Bitemporal) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ucas_application" (
  "version_id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                  uuid        NOT NULL,
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant"("id"),
  "ucas_personal_id"    text        NOT NULL,
  "cycle"               text        NOT NULL,
  "status_code"         text        NOT NULL,
  "linked_enrolment_id" uuid,
  "raw_payload"         jsonb       NOT NULL DEFAULT '{}',
  "received_at"         timestamptz NOT NULL DEFAULT now(),
  "valid_from"          timestamptz NOT NULL,
  "valid_to"            timestamptz,
  "recorded_at"         timestamptz NOT NULL DEFAULT now(),
  "recorded_until"      timestamptz,
  CONSTRAINT "ucas_application_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "ucas_application_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "ucas_application_unique_logical_transaction"
  ON "ucas_application" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "ucas_application_current_version_unique"
  ON "ucas_application" ("tenant_id", "id")
  WHERE recorded_until IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "ucas_application_applicant_cycle_current_unique"
  ON "ucas_application" ("tenant_id", "ucas_personal_id", "cycle")
  WHERE recorded_until IS NULL;

ALTER TABLE "ucas_application" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ucas_application" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ucas_application";
CREATE POLICY tenant_isolation ON "ucas_application"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── HESA Student Return ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "hesa_student_return" (
  "id"                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"            uuid        NOT NULL REFERENCES "tenant"("id"),
  "academic_year"        text        NOT NULL,
  "status_code"          text        NOT NULL DEFAULT 'draft',
  "submitted_at"         timestamptz,
  "validated_at"         timestamptz,
  "submission_reference" text,
  "amendment_of_id"      uuid        REFERENCES "hesa_student_return"("id"),
  "generated_by"         text        NOT NULL,
  "generated_at"         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "hesa_student_return_year_idx"
  ON "hesa_student_return" ("tenant_id", "academic_year");

ALTER TABLE "hesa_student_return" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hesa_student_return" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "hesa_student_return";
CREATE POLICY tenant_isolation ON "hesa_student_return"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS "hesa_student_return_record" (
  "id"                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "hesa_student_return_id" uuid        NOT NULL REFERENCES "hesa_student_return"("id"),
  "enrolment_id"           uuid        NOT NULL,
  "hesa_id"                text,
  "record_payload"         jsonb       NOT NULL DEFAULT '{}',
  "created_at"             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "hesa_student_return_record_return_idx"
  ON "hesa_student_return_record" ("hesa_student_return_id");

ALTER TABLE "hesa_student_return_record" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hesa_student_return_record" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "hesa_student_return_record";
CREATE POLICY tenant_isolation ON "hesa_student_return_record"
  USING (
    EXISTS (
      SELECT 1
      FROM "hesa_student_return" hsr
      WHERE hsr."id" = "hesa_student_return_record"."hesa_student_return_id"
        AND hsr."tenant_id" = current_setting('app.current_tenant_id', true)::uuid
    )
  );

CREATE TABLE IF NOT EXISTS "hesa_submission" (
  "id"                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "hesa_student_return_id" uuid        NOT NULL REFERENCES "hesa_student_return"("id"),
  "integration_exchange_id" uuid       NOT NULL REFERENCES "integration_exchange"("id"),
  "payload_hash"           text        NOT NULL,
  "payload_summary"        jsonb       NOT NULL DEFAULT '{}',
  "generated_at"           timestamptz NOT NULL DEFAULT now(),
  "generated_by"           text        NOT NULL,
  "submitted_at"           timestamptz,
  "submission_reference"   text
);

ALTER TABLE "hesa_submission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hesa_submission" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "hesa_submission";
CREATE POLICY tenant_isolation ON "hesa_submission"
  USING (
    EXISTS (
      SELECT 1
      FROM "hesa_student_return" hsr
      WHERE hsr."id" = "hesa_submission"."hesa_student_return_id"
        AND hsr."tenant_id" = current_setting('app.current_tenant_id', true)::uuid
    )
  );

CREATE TABLE IF NOT EXISTS "hesa_validation_report" (
  "id"                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "hesa_student_return_id" uuid        NOT NULL REFERENCES "hesa_student_return"("id"),
  "integration_exchange_id" uuid       REFERENCES "integration_exchange"("id"),
  "received_at"            timestamptz NOT NULL DEFAULT now(),
  "received_by"            text        NOT NULL,
  "raw_payload"            jsonb       NOT NULL DEFAULT '{}',
  "blocking_error_count"   integer     NOT NULL DEFAULT 0,
  "warning_count"          integer     NOT NULL DEFAULT 0
);

ALTER TABLE "hesa_validation_report" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hesa_validation_report" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "hesa_validation_report";
CREATE POLICY tenant_isolation ON "hesa_validation_report"
  USING (
    EXISTS (
      SELECT 1
      FROM "hesa_student_return" hsr
      WHERE hsr."id" = "hesa_validation_report"."hesa_student_return_id"
        AND hsr."tenant_id" = current_setting('app.current_tenant_id', true)::uuid
    )
  );

CREATE TABLE IF NOT EXISTS "hesa_validation_issue" (
  "id"                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "hesa_validation_report_id"     uuid        NOT NULL REFERENCES "hesa_validation_report"("id"),
  "hesa_student_return_record_id" uuid        REFERENCES "hesa_student_return_record"("id"),
  "enrolment_id"                  uuid,
  "field_code"                    text        NOT NULL,
  "severity_code"                 text        NOT NULL,
  "message"                       text        NOT NULL,
  "external_reference"            text,
  "created_at"                    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "hesa_validation_issue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hesa_validation_issue" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "hesa_validation_issue";
CREATE POLICY tenant_isolation ON "hesa_validation_issue"
  USING (
    EXISTS (
      SELECT 1
      FROM "hesa_validation_report" hvr
      JOIN "hesa_student_return" hsr ON hsr."id" = hvr."hesa_student_return_id"
      WHERE hvr."id" = "hesa_validation_issue"."hesa_validation_report_id"
        AND hsr."tenant_id" = current_setting('app.current_tenant_id', true)::uuid
    )
  );

CREATE TABLE IF NOT EXISTS "hesa_identifier_assignment" (
  "id"                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "hesa_student_return_id"        uuid        NOT NULL REFERENCES "hesa_student_return"("id"),
  "hesa_student_return_record_id" uuid        NOT NULL REFERENCES "hesa_student_return_record"("id"),
  "person_id"                     uuid        NOT NULL REFERENCES "person"("id"),
  "enrolment_id"                  uuid        NOT NULL,
  "hesa_id"                       text        NOT NULL,
  "assigned_at"                   timestamptz NOT NULL DEFAULT now(),
  "assigned_by"                   text        NOT NULL
);

ALTER TABLE "hesa_identifier_assignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hesa_identifier_assignment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "hesa_identifier_assignment";
CREATE POLICY tenant_isolation ON "hesa_identifier_assignment"
  USING (
    EXISTS (
      SELECT 1
      FROM "hesa_student_return" hsr
      WHERE hsr."id" = "hesa_identifier_assignment"."hesa_student_return_id"
        AND hsr."tenant_id" = current_setting('app.current_tenant_id', true)::uuid
    )
  );

-- ── SLC ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "slc_notification" (
  "id"                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"              uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"           uuid        NOT NULL,
  "notification_type_code" text        NOT NULL,
  "effective_date"         date        NOT NULL,
  "amount"                 numeric(12,2),
  "raw_payload"            jsonb       NOT NULL DEFAULT '{}',
  "received_at"            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "slc_notification_enrolment_idx"
  ON "slc_notification" ("tenant_id", "enrolment_id");

ALTER TABLE "slc_notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "slc_notification" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "slc_notification";
CREATE POLICY tenant_isolation ON "slc_notification"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── UKVI ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ukvi_cas_request" (
  "version_id"     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"             uuid        NOT NULL,
  "tenant_id"      uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"   uuid        NOT NULL,
  "cas_reference"  text,
  "status_code"    text        NOT NULL,
  "requested_at"   timestamptz NOT NULL DEFAULT now(),
  "valid_from"     timestamptz NOT NULL,
  "valid_to"       timestamptz,
  "recorded_at"    timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz,
  CONSTRAINT "ukvi_cas_request_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "ukvi_cas_request_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "ukvi_cas_request_unique_logical_transaction"
  ON "ukvi_cas_request" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "ukvi_cas_request_current_version_unique"
  ON "ukvi_cas_request" ("tenant_id", "id")
  WHERE recorded_until IS NULL;
CREATE INDEX IF NOT EXISTS "ukvi_cas_request_enrolment_idx"
  ON "ukvi_cas_request" ("tenant_id", "enrolment_id")
  WHERE recorded_until IS NULL;

ALTER TABLE "ukvi_cas_request" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ukvi_cas_request" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ukvi_cas_request";
CREATE POLICY tenant_isolation ON "ukvi_cas_request"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS "ukvi_attendance_report" (
  "id"                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"          uuid        NOT NULL REFERENCES "tenant"("id"),
  "academic_period_id" uuid        NOT NULL REFERENCES "academic_period"("id"),
  "submitted_at"       timestamptz NOT NULL DEFAULT now(),
  "report_payload"     jsonb       NOT NULL DEFAULT '{}',
  "submitted_by"       text        NOT NULL
);

ALTER TABLE "ukvi_attendance_report" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ukvi_attendance_report" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ukvi_attendance_report";
CREATE POLICY tenant_isolation ON "ukvi_attendance_report"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS "ukvi_visa_status" (
  "version_id"     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"             uuid        NOT NULL,
  "tenant_id"      uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"   uuid        NOT NULL,
  "cas_reference"  text        NOT NULL,
  "status_code"    text        NOT NULL,
  "effective_date" date        NOT NULL,
  "raw_payload"    jsonb       NOT NULL DEFAULT '{}',
  "valid_from"     timestamptz NOT NULL,
  "valid_to"       timestamptz,
  "recorded_at"    timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz,
  CONSTRAINT "ukvi_visa_status_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "ukvi_visa_status_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "ukvi_visa_status_unique_logical_transaction"
  ON "ukvi_visa_status" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "ukvi_visa_status_current_version_unique"
  ON "ukvi_visa_status" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

ALTER TABLE "ukvi_visa_status" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ukvi_visa_status" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ukvi_visa_status";
CREATE POLICY tenant_isolation ON "ukvi_visa_status"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS "ukvi_compliance_alert" (
  "id"              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"       uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"    uuid        NOT NULL,
  "cas_reference"   text,
  "alert_type_code" text        NOT NULL,
  "triggered_at"    timestamptz NOT NULL DEFAULT now(),
  "resolved_at"     timestamptz,
  "resolved_by"     text
);

ALTER TABLE "ukvi_compliance_alert" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ukvi_compliance_alert" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ukvi_compliance_alert";
CREATE POLICY tenant_isolation ON "ukvi_compliance_alert"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── OfS and FOI ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ofs_extract" (
  "id"                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid        NOT NULL REFERENCES "tenant"("id"),
  "extract_type_code" text        NOT NULL,
  "academic_year"     text        NOT NULL,
  "generated_at"      timestamptz NOT NULL DEFAULT now(),
  "generated_by"      text        NOT NULL,
  "record_count"      integer     NOT NULL DEFAULT 0,
  "extract_payload"   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  "status_code"       text        NOT NULL DEFAULT 'generated'
);

ALTER TABLE "ofs_extract" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ofs_extract" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ofs_extract";
CREATE POLICY tenant_isolation ON "ofs_extract"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS "foi_request" (
  "version_id"              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                      uuid        NOT NULL,
  "tenant_id"               uuid        NOT NULL REFERENCES "tenant"("id"),
  "request_reference"       text        NOT NULL,
  "received_date"           date        NOT NULL,
  "statutory_deadline_date" date        NOT NULL,
  "description"             text        NOT NULL,
  "status_code"             text        NOT NULL,
  "legal_basis"             text,
  "closed_at"               timestamptz,
  "valid_from"              timestamptz NOT NULL,
  "valid_to"                timestamptz,
  "recorded_at"             timestamptz NOT NULL DEFAULT now(),
  "recorded_until"          timestamptz,
  CONSTRAINT "foi_request_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "foi_request_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "foi_request_unique_logical_transaction"
  ON "foi_request" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "foi_request_current_version_unique"
  ON "foi_request" ("tenant_id", "id")
  WHERE recorded_until IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "foi_request_reference_current_unique"
  ON "foi_request" ("tenant_id", "request_reference")
  WHERE recorded_until IS NULL;

ALTER TABLE "foi_request" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "foi_request" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "foi_request";
CREATE POLICY tenant_isolation ON "foi_request"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS "foi_extract" (
  "id"             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      uuid        NOT NULL REFERENCES "tenant"("id"),
  "foi_request_id" uuid        NOT NULL,
  "generated_at"   timestamptz NOT NULL DEFAULT now(),
  "generated_by"   text        NOT NULL,
  "query_summary"  text        NOT NULL,
  "record_count"   integer     NOT NULL DEFAULT 0,
  "extract_payload" jsonb      NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE "foi_extract" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "foi_extract" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "foi_extract";
CREATE POLICY tenant_isolation ON "foi_extract"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Student Regulatory Profile (Bitemporal) ────────────────────────────────
CREATE TABLE IF NOT EXISTS "student_regulatory_profile" (
  "version_id"                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                        uuid        NOT NULL,
  "tenant_id"                 uuid        NOT NULL REFERENCES "tenant"("id"),
  "person_id"                 uuid        NOT NULL REFERENCES "person"("id"),
  "enrolment_id"              uuid,
  "ukvi_sponsorship_required" boolean     NOT NULL DEFAULT false,
  "polar4_quintile"           integer     CHECK ("polar4_quintile" IS NULL OR "polar4_quintile" BETWEEN 1 AND 5),
  "imd_decile"                integer     CHECK ("imd_decile" IS NULL OR "imd_decile" BETWEEN 1 AND 10),
  "care_experienced"          boolean,
  "source_system"             text        NOT NULL,
  "actor_id"                  text        NOT NULL,
  "valid_from"                timestamptz NOT NULL,
  "valid_to"                  timestamptz,
  "recorded_at"               timestamptz NOT NULL DEFAULT now(),
  "recorded_until"            timestamptz,
  CONSTRAINT "student_regulatory_profile_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "student_regulatory_profile_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "student_regulatory_profile_unique_logical_transaction"
  ON "student_regulatory_profile" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "student_regulatory_profile_current_version_unique"
  ON "student_regulatory_profile" ("tenant_id", "id")
  WHERE recorded_until IS NULL;
CREATE INDEX IF NOT EXISTS "student_regulatory_profile_person_idx"
  ON "student_regulatory_profile" ("tenant_id", "person_id")
  WHERE recorded_until IS NULL;

ALTER TABLE "student_regulatory_profile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "student_regulatory_profile" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "student_regulatory_profile";
CREATE POLICY tenant_isolation ON "student_regulatory_profile"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Exam Entry and Timetable Receipt ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "exam_entry" (
  "version_id"             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                     uuid        NOT NULL,
  "tenant_id"              uuid        NOT NULL REFERENCES "tenant"("id"),
  "module_registration_id" uuid        NOT NULL,
  "exam_board_id"          uuid        NOT NULL REFERENCES "exam_board"("id"),
  "candidate_number"       text,
  "scheduled_date"         date,
  "room_reference"         text,
  "status_code"            text        NOT NULL,
  "accommodations"         jsonb       NOT NULL DEFAULT '{}',
  "valid_from"             timestamptz NOT NULL,
  "valid_to"               timestamptz,
  "recorded_at"            timestamptz NOT NULL DEFAULT now(),
  "recorded_until"         timestamptz,
  CONSTRAINT "exam_entry_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "exam_entry_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "exam_entry_unique_logical_transaction"
  ON "exam_entry" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "exam_entry_current_version_unique"
  ON "exam_entry" ("tenant_id", "id")
  WHERE recorded_until IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "exam_entry_registration_board_current_unique"
  ON "exam_entry" ("tenant_id", "module_registration_id", "exam_board_id")
  WHERE recorded_until IS NULL;

ALTER TABLE "exam_entry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exam_entry" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "exam_entry";
CREATE POLICY tenant_isolation ON "exam_entry"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS "exam_timetable_receipt" (
  "id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"     uuid        NOT NULL REFERENCES "tenant"("id"),
  "exam_board_id" uuid        NOT NULL REFERENCES "exam_board"("id"),
  "received_at"   timestamptz NOT NULL DEFAULT now(),
  "received_by"   text        NOT NULL,
  "payload"       jsonb       NOT NULL DEFAULT '{}'
);

ALTER TABLE "exam_timetable_receipt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exam_timetable_receipt" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "exam_timetable_receipt";
CREATE POLICY tenant_isolation ON "exam_timetable_receipt"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Regulatory Integration Contracts ────────────────────────────────────────
INSERT INTO "integration_contract" ("contract_id", "display_name", "owner_module_code", "direction_code", "pattern_type", "current_contract_version", "data_classification_code")
VALUES
  ('ucas-admissions-exchange.{cycle}', 'UCAS Admissions Exchange', 'regulatory', 'bidirectional', 'file-and-api', '1.0.0', 'personal'),
  ('hesa-student-return.{year}',       'HESA Student Return',      'regulatory', 'bidirectional', 'file',         '1.0.0', 'regulatory'),
  ('slc-enrolment-exchange.v1',        'SLC Enrolment Exchange',   'regulatory', 'bidirectional', 'file-and-api', '1.0.0', 'sensitive'),
  ('ukvi-sponsor-compliance.v1',       'UKVI Sponsor Compliance',  'regulatory', 'bidirectional', 'api-and-file', '1.0.0', 'sensitive'),
  ('exam-scheduling.v1',               'Exam Scheduling Exchange', 'governance', 'bidirectional', 'api-and-file', '1.0.0', 'standard')
ON CONFLICT ("contract_id") DO NOTHING;
