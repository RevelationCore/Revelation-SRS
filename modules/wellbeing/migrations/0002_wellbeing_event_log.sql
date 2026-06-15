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
