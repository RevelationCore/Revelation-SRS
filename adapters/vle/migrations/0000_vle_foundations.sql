-- ============================================================
-- Originally: 0001_vle_connector_scaffold.sql
-- ============================================================

-- Phase 9 VLE Connector — Migration 0001
-- Creates the vle_connector schema and all connector-owned persistence tables.
--
-- The connector stores its own state separately from the SRS core schema.
-- No cross-schema joins to the SRS public schema are permitted at runtime.
-- tenant_id columns carry the SRS tenant identifier for multi-tenant operation
-- but there is no FK constraint, allowing the connector to run in its own DB.

CREATE SCHEMA IF NOT EXISTS vle_connector;

-- ── Event Ledger ─────────────────────────────────────────────────────────────
-- Idempotency log for every consumed NATS event.
-- status_code: processed | failed | skipped

CREATE TABLE IF NOT EXISTS vle_connector.vle_event_ledger (
  "id"           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"    uuid        NOT NULL,
  "event_id"     text        NOT NULL,
  "subject"      text        NOT NULL,
  "status_code"  text        NOT NULL DEFAULT 'processed',
  "error_detail" text,
  "processed_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tenant_id", "event_id")
);

CREATE INDEX IF NOT EXISTS vle_event_ledger_tenant_subject_idx
  ON vle_connector.vle_event_ledger ("tenant_id", "subject");

-- ── Course Map ───────────────────────────────────────────────────────────────
-- Maps SRS moduleId to the VLE course identifier.

CREATE TABLE IF NOT EXISTS vle_connector.vle_course_map (
  "id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"     uuid        NOT NULL,
  "module_id"     uuid        NOT NULL,
  "vle_course_id" text        NOT NULL,
  "title"         text,
  "code"          text,
  "synced_at"     timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tenant_id", "module_id")
);

-- ── Enrolment Map ────────────────────────────────────────────────────────────
-- Maps SRS moduleRegistrationId to the VLE enrolment record.
-- status_code mirrors VLE access state: active | suspended | withdrawn | completed

CREATE TABLE IF NOT EXISTS vle_connector.vle_enrolment_map (
  "id"                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"               uuid        NOT NULL,
  "module_registration_id"  uuid        NOT NULL,
  "module_id"               uuid        NOT NULL,
  "enrolment_id"            uuid        NOT NULL,
  "person_id"               uuid        NOT NULL,
  "vle_enrolment_id"        text,
  "status_code"             text        NOT NULL DEFAULT 'active',
  "synced_at"               timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tenant_id", "module_registration_id")
);

CREATE INDEX IF NOT EXISTS vle_enrolment_map_tenant_module_idx
  ON vle_connector.vle_enrolment_map ("tenant_id", "module_id");

CREATE INDEX IF NOT EXISTS vle_enrolment_map_tenant_person_idx
  ON vle_connector.vle_enrolment_map ("tenant_id", "person_id");

-- ── Adjustment Map ───────────────────────────────────────────────────────────
-- Tracks adjustment distributions received from SRS and their application state.
-- status_code: pending | applied | acknowledged | failed

CREATE TABLE IF NOT EXISTS vle_connector.vle_adjustment_map (
  "id"                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid        NOT NULL,
  "adjustment_id"     uuid        NOT NULL,
  "distribution_id"   uuid        NOT NULL,
  "person_id"         uuid        NOT NULL,
  "enrolment_id"      uuid        NOT NULL,
  "adjustment_type_code" text     NOT NULL,
  "scope_code"        text        NOT NULL,
  "valid_from"        timestamptz NOT NULL,
  "valid_to"          timestamptz,
  "status_code"       text        NOT NULL DEFAULT 'pending',
  "applied_at"        timestamptz,
  "acknowledged_at"   timestamptz,
  "error_detail"      text,
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tenant_id", "distribution_id")
);

CREATE INDEX IF NOT EXISTS vle_adjustment_map_tenant_person_idx
  ON vle_connector.vle_adjustment_map ("tenant_id", "person_id");

-- ── Mark Receipt ─────────────────────────────────────────────────────────────
-- Records each mark submission to SRS for idempotency and reconciliation.

CREATE TABLE IF NOT EXISTS vle_connector.vle_mark_receipt (
  "id"                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"               uuid        NOT NULL,
  "source_reference"        text        NOT NULL,
  "module_registration_id"  uuid        NOT NULL,
  "assessment_component_id" uuid        NOT NULL,
  "mark_id"                 uuid,
  "raw_mark"                numeric     NOT NULL,
  "submitted_at"            timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tenant_id", "module_registration_id", "assessment_component_id", "source_reference")
);

-- ── Reconciliation Run ───────────────────────────────────────────────────────
-- History of reconciliation jobs.
-- run_type: roster | adjustments | marks

CREATE TABLE IF NOT EXISTS vle_connector.vle_reconciliation_run (
  "id"             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      uuid        NOT NULL,
  "run_type"       text        NOT NULL,
  "started_at"     timestamptz NOT NULL DEFAULT now(),
  "completed_at"   timestamptz,
  "drift_count"    integer     NOT NULL DEFAULT 0,
  "repaired_count" integer     NOT NULL DEFAULT 0,
  "error_detail"   text
);

CREATE INDEX IF NOT EXISTS vle_reconciliation_run_tenant_type_idx
  ON vle_connector.vle_reconciliation_run ("tenant_id", "run_type", "started_at" DESC);


-- ============================================================
-- Originally: 0002_vle_event_ledger_v2.sql
-- ============================================================

-- Phase 9 Stage 3 — Event Consumer Foundation
-- Extends vle_event_ledger with columns needed for replay checkpointing,
-- payload hashing (observability), and per-attempt error tracking.
--
-- The unique constraint on (tenant_id, event_id) is intentionally dropped.
-- Idempotency is enforced at query time by filtering for status_code = 'processed'.
-- Keeping the constraint would prevent recording multiple failed attempts for
-- the same event, breaking retry observability.

ALTER TABLE vle_connector.vle_event_ledger
  ADD COLUMN IF NOT EXISTS "stream_seq"     bigint,
  ADD COLUMN IF NOT EXISTS "event_hash"     text,
  ADD COLUMN IF NOT EXISTS "attempt_count"  integer NOT NULL DEFAULT 1;

ALTER TABLE vle_connector.vle_event_ledger
  DROP CONSTRAINT IF EXISTS vle_event_ledger_tenant_id_event_id_key;

-- Idempotency lookup: (tenant_id, event_id, status_code)
CREATE INDEX IF NOT EXISTS vle_event_ledger_idempotency_idx
  ON vle_connector.vle_event_ledger ("tenant_id", "event_id", "status_code");

-- Replay checkpoint: highest stream_seq per tenant
CREATE INDEX IF NOT EXISTS vle_event_ledger_stream_seq_idx
  ON vle_connector.vle_event_ledger ("tenant_id", "stream_seq" DESC NULLS LAST);


-- ============================================================
-- Originally: 0003_vle_student_enrolment_map.sql
-- ============================================================

-- Phase 9 Stage 4 — Course Provisioning (F015)
-- Adds the student-enrolment lookup table.
--
-- srs.student.enrolled carries personId + enrolmentId.
-- srs.enrolment.module-registered carries enrolmentId but NOT personId.
-- This table bridges the gap so module-registered handlers can resolve the person.

CREATE TABLE IF NOT EXISTS vle_connector.vle_student_enrolment_map (
  "id"           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"    uuid        NOT NULL,
  "enrolment_id" uuid        NOT NULL,
  "person_id"    uuid        NOT NULL,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tenant_id", "enrolment_id")
);

CREATE INDEX IF NOT EXISTS vle_student_enrolment_map_tenant_person_idx
  ON vle_connector.vle_student_enrolment_map ("tenant_id", "person_id");

