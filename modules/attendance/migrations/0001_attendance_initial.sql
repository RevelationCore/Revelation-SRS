-- Revelation SRS — Attendance Module (Stage 1 extraction)
-- Migration: 0001_attendance_initial
-- Applied by: modules/attendance/src/db/migrate.ts
--
-- All tables live in the "attendance" PostgreSQL schema, isolating them from
-- the core SRS schema. The core tenant table (public.tenant) must already
-- exist before this migration runs (applied by packages/db).
--
-- Table shapes mirror packages/db/src/schema/engagement.ts (migrations
-- 0037-0040 in packages/db) column-for-column; this migration is the module's
-- own copy of that structure plus the module_registration_id hook and the
-- enrolment_person_map / module_registration_map projection tables that
-- replace the live core "enrolments" table join.

CREATE SCHEMA IF NOT EXISTS attendance;

-- ── Engagement Policy Version (bitemporal) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS attendance."engagement_policy_version" (
  "version_id"      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"              uuid        NOT NULL,
  "tenant_id"       uuid        NOT NULL REFERENCES "tenant" ("id"),
  "policy_code"     text        NOT NULL,
  "version_number"  integer     NOT NULL,
  "display_name"    text        NOT NULL,
  "status_code"     text        NOT NULL DEFAULT 'draft',
  "applicability"   jsonb       NOT NULL DEFAULT '{}',
  "evidence_window" jsonb       NOT NULL DEFAULT '{}',
  "alert_rules"     jsonb       NOT NULL DEFAULT '{}',
  "review_deadline" jsonb       NOT NULL DEFAULT '{}',
  "approved_by"     text,
  "approved_at"     timestamptz,
  "actor_id"        text        NOT NULL,
  "valid_from"      timestamptz NOT NULL,
  "valid_to"        timestamptz,
  "recorded_at"     timestamptz NOT NULL DEFAULT now(),
  "recorded_until"  timestamptz,
  CONSTRAINT "engagement_policy_version_temporal_check_valid" CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "engagement_policy_version_temporal_check_recorded" CHECK (recorded_until IS NULL OR recorded_until > recorded_at),
  CONSTRAINT "engagement_policy_version_number_positive" CHECK (version_number > 0),
  CONSTRAINT "engagement_policy_version_approval_consistent" CHECK (
    (status_code = 'approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    OR status_code <> 'approved'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "engagement_policy_version_unique_logical_tx"
  ON attendance."engagement_policy_version" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "engagement_policy_version_current_version"
  ON attendance."engagement_policy_version" ("tenant_id", "id") WHERE "recorded_until" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "engagement_policy_version_code_number_unique"
  ON attendance."engagement_policy_version" ("tenant_id", "policy_code", "version_number");

ALTER TABLE attendance."engagement_policy_version" ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance."engagement_policy_version" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON attendance."engagement_policy_version";
CREATE POLICY tenant_isolation ON attendance."engagement_policy_version"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Expected Engagement Event (bitemporal) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS attendance."expected_engagement_event" (
  "version_id"             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                     uuid        NOT NULL,
  "tenant_id"              uuid        NOT NULL REFERENCES "tenant" ("id"),
  "person_id"              uuid        NOT NULL,
  "enrolment_id"           uuid        NOT NULL,
  "module_registration_id" uuid,
  "activity_type_code"     text        NOT NULL,
  "activity_reference"     text,
  "event_mode_code"        text        NOT NULL,
  "scheduled_from"         timestamptz NOT NULL,
  "scheduled_to"           timestamptz,
  "location_reference"     text,
  "source_system_code"     text        NOT NULL,
  "source_event_id"        text        NOT NULL,
  "source_version"         text        NOT NULL,
  "status_code"            text        NOT NULL DEFAULT 'expected',
  "actor_id"               text        NOT NULL DEFAULT 'system',
  "valid_from"             timestamptz NOT NULL,
  "valid_to"               timestamptz,
  "recorded_at"            timestamptz NOT NULL DEFAULT now(),
  "recorded_until"         timestamptz,
  CONSTRAINT "expected_engagement_event_temporal_check_valid" CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "expected_engagement_event_temporal_check_recorded" CHECK (recorded_until IS NULL OR recorded_until > recorded_at),
  CONSTRAINT "expected_engagement_event_schedule_check" CHECK (scheduled_to IS NULL OR scheduled_to > scheduled_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS "expected_engagement_event_unique_logical_tx"
  ON attendance."expected_engagement_event" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "expected_engagement_event_current_version"
  ON attendance."expected_engagement_event" ("tenant_id", "id") WHERE "recorded_until" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "expected_engagement_event_source_version_unique"
  ON attendance."expected_engagement_event" ("tenant_id", "source_system_code", "source_event_id", "source_version");
CREATE INDEX IF NOT EXISTS "expected_engagement_event_worklist_idx"
  ON attendance."expected_engagement_event" ("tenant_id", "scheduled_from", "status_code");
CREATE INDEX IF NOT EXISTS "expected_engagement_event_module_reg_idx"
  ON attendance."expected_engagement_event" ("tenant_id", "module_registration_id");

ALTER TABLE attendance."expected_engagement_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance."expected_engagement_event" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON attendance."expected_engagement_event";
CREATE POLICY tenant_isolation ON attendance."expected_engagement_event"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Engagement Observation (bitemporal, append-only history) ────────────────

CREATE TABLE IF NOT EXISTS attendance."engagement_observation" (
  "version_id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                    uuid        NOT NULL,
  "tenant_id"             uuid        NOT NULL REFERENCES "tenant" ("id"),
  "expected_event_id"     uuid,
  "person_id"             uuid        NOT NULL,
  "enrolment_id"          uuid        NOT NULL,
  "source_system_code"    text        NOT NULL,
  "source_event_id"       text        NOT NULL,
  "source_version"        text        NOT NULL,
  "idempotency_key"       text        NOT NULL,
  "capture_method_code"   text        NOT NULL,
  "outcome_code"          text        NOT NULL,
  "data_quality_code"     text        NOT NULL DEFAULT 'valid',
  "event_time"            timestamptz NOT NULL,
  "received_at"           timestamptz NOT NULL DEFAULT now(),
  "device_reference"      text,
  "operational_reference" text,
  "actor_id"              text        NOT NULL,
  "valid_from"            timestamptz NOT NULL,
  "valid_to"              timestamptz,
  "recorded_at"           timestamptz NOT NULL DEFAULT now(),
  "recorded_until"        timestamptz,
  CONSTRAINT "engagement_observation_temporal_check_valid" CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "engagement_observation_temporal_check_recorded" CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "engagement_observation_unique_logical_tx"
  ON attendance."engagement_observation" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "engagement_observation_current_version"
  ON attendance."engagement_observation" ("tenant_id", "id") WHERE "recorded_until" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "engagement_observation_idempotency_unique"
  ON attendance."engagement_observation" ("tenant_id", "source_system_code", "idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "engagement_observation_source_version_unique"
  ON attendance."engagement_observation" ("tenant_id", "source_system_code", "source_event_id", "source_version");
CREATE INDEX IF NOT EXISTS "engagement_observation_timeline_idx"
  ON attendance."engagement_observation" ("tenant_id", "person_id", "event_time");

ALTER TABLE attendance."engagement_observation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance."engagement_observation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON attendance."engagement_observation";
CREATE POLICY tenant_isolation ON attendance."engagement_observation"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Engagement Observation Revision (append-only) ────────────────────────────

CREATE TABLE IF NOT EXISTS attendance."engagement_observation_revision" (
  "id"                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"              uuid        NOT NULL REFERENCES "tenant" ("id"),
  "observation_id"         uuid        NOT NULL,
  "superseded_version_id"  uuid        NOT NULL REFERENCES attendance."engagement_observation" ("version_id"),
  "replacement_version_id" uuid        NOT NULL REFERENCES attendance."engagement_observation" ("version_id"),
  "correction_reason_code" text        NOT NULL,
  "correction_reason"      text,
  "disputed"               boolean     NOT NULL DEFAULT false,
  "authorised_by"          text        NOT NULL,
  "recorded_at"            timestamptz NOT NULL DEFAULT now(),
  "correlation_id"         uuid,
  CONSTRAINT "engagement_observation_revision_distinct_versions" CHECK (superseded_version_id <> replacement_version_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS "engagement_observation_revision_replacement_unique"
  ON attendance."engagement_observation_revision" ("tenant_id", "replacement_version_id");

ALTER TABLE attendance."engagement_observation_revision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance."engagement_observation_revision" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON attendance."engagement_observation_revision";
CREATE POLICY tenant_isolation ON attendance."engagement_observation_revision"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Engagement Alert (bitemporal) ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS attendance."engagement_alert" (
  "version_id"             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                     uuid        NOT NULL,
  "tenant_id"              uuid        NOT NULL REFERENCES "tenant" ("id"),
  "person_id"              uuid        NOT NULL,
  "enrolment_id"           uuid        NOT NULL,
  "policy_version_id"      uuid        NOT NULL REFERENCES attendance."engagement_policy_version" ("version_id"),
  "evidence_window_from"   timestamptz NOT NULL,
  "evidence_window_to"     timestamptz NOT NULL,
  "evidence_snapshot"      jsonb       NOT NULL DEFAULT '{}',
  "evidence_hash"          text        NOT NULL,
  "explanation"            jsonb       NOT NULL DEFAULT '{}',
  "severity_code"          text        NOT NULL,
  "status_code"            text        NOT NULL DEFAULT 'open',
  "reevaluation_required"  boolean     NOT NULL DEFAULT false,
  "actor_id"               text        NOT NULL DEFAULT 'system',
  "valid_from"             timestamptz NOT NULL,
  "valid_to"               timestamptz,
  "recorded_at"            timestamptz NOT NULL DEFAULT now(),
  "recorded_until"         timestamptz,
  CONSTRAINT "engagement_alert_temporal_check_valid" CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "engagement_alert_temporal_check_recorded" CHECK (recorded_until IS NULL OR recorded_until > recorded_at),
  CONSTRAINT "engagement_alert_window_check" CHECK (evidence_window_to > evidence_window_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS "engagement_alert_unique_logical_tx"
  ON attendance."engagement_alert" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "engagement_alert_current_version"
  ON attendance."engagement_alert" ("tenant_id", "id") WHERE "recorded_until" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "engagement_alert_evaluation_unique"
  ON attendance."engagement_alert" ("tenant_id", "person_id", "policy_version_id", "evidence_window_from", "evidence_window_to", "evidence_hash")
  WHERE "recorded_until" IS NULL;
CREATE INDEX IF NOT EXISTS "engagement_alert_queue_idx"
  ON attendance."engagement_alert" ("tenant_id", "status_code", "severity_code", "evidence_window_to");

ALTER TABLE attendance."engagement_alert" ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance."engagement_alert" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON attendance."engagement_alert";
CREATE POLICY tenant_isolation ON attendance."engagement_alert"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Engagement Intervention Case (bitemporal) + related tables ──────────────

CREATE TABLE IF NOT EXISTS attendance."engagement_intervention_case" (
  "version_id"           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                   uuid        NOT NULL,
  "tenant_id"            uuid        NOT NULL REFERENCES "tenant" ("id"),
  "alert_id"             uuid        NOT NULL,
  "person_id"            uuid        NOT NULL,
  "enrolment_id"         uuid        NOT NULL,
  "status_code"          text        NOT NULL DEFAULT 'open',
  "outcome_code"         text,
  "assigned_role_code"   text,
  "assigned_actor_id"    text,
  "workflow_instance_id" uuid,
  "correlation_id"       uuid        NOT NULL,
  "opened_at"            timestamptz NOT NULL DEFAULT now(),
  "review_at"            timestamptz,
  "due_at"               timestamptz,
  "closed_at"            timestamptz,
  "actor_id"             text        NOT NULL,
  "idempotency_key"      text,
  "valid_from"           timestamptz NOT NULL,
  "valid_to"             timestamptz,
  "recorded_at"          timestamptz NOT NULL DEFAULT now(),
  "recorded_until"       timestamptz,
  CONSTRAINT "engagement_intervention_case_temporal_check_valid" CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "engagement_intervention_case_temporal_check_recorded" CHECK (recorded_until IS NULL OR recorded_until > recorded_at),
  CONSTRAINT "engagement_intervention_case_closure_check" CHECK (
    (status_code = 'closed' AND outcome_code IS NOT NULL AND closed_at IS NOT NULL)
    OR status_code <> 'closed'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "engagement_intervention_case_unique_logical_tx"
  ON attendance."engagement_intervention_case" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "engagement_intervention_case_current_version"
  ON attendance."engagement_intervention_case" ("tenant_id", "id") WHERE "recorded_until" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "engagement_intervention_case_open_alert_unique"
  ON attendance."engagement_intervention_case" ("tenant_id", "alert_id")
  WHERE "recorded_until" IS NULL AND "status_code" <> 'closed';
CREATE INDEX IF NOT EXISTS "engagement_intervention_case_worklist_idx"
  ON attendance."engagement_intervention_case" ("tenant_id", "status_code", "assigned_actor_id", "due_at");

ALTER TABLE attendance."engagement_intervention_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance."engagement_intervention_case" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON attendance."engagement_intervention_case";
CREATE POLICY tenant_isolation ON attendance."engagement_intervention_case"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS attendance."engagement_contact_attempt" (
  "id"                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"            uuid        NOT NULL REFERENCES "tenant" ("id"),
  "intervention_case_id" uuid        NOT NULL,
  "channel_code"         text        NOT NULL,
  "attempted_at"         timestamptz NOT NULL,
  "outcome_code"         text        NOT NULL,
  "communication_locale" text,
  "operational_note"     text,
  "data_classification"  text        NOT NULL DEFAULT 'sensitive-personal',
  "actor_id"             text        NOT NULL,
  "idempotency_key"      text        NOT NULL,
  "created_at"           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "engagement_contact_attempt_case_idx"
  ON attendance."engagement_contact_attempt" ("tenant_id", "intervention_case_id", "attempted_at");

ALTER TABLE attendance."engagement_contact_attempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance."engagement_contact_attempt" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON attendance."engagement_contact_attempt";
CREATE POLICY tenant_isolation ON attendance."engagement_contact_attempt"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS attendance."engagement_action" (
  "id"                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"               uuid        NOT NULL REFERENCES "tenant" ("id"),
  "intervention_case_id"    uuid        NOT NULL,
  "action_type_code"        text        NOT NULL,
  "operational_instruction" text,
  "owner_role_code"         text,
  "owner_actor_id"          text,
  "due_at"                  timestamptz,
  "completed_at"            timestamptz,
  "completed_by"            text,
  "created_by"              text        NOT NULL,
  "idempotency_key"         text        NOT NULL,
  "created_at"              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "engagement_action_completion_check" CHECK (
    (completed_at IS NULL AND completed_by IS NULL)
    OR (completed_at IS NOT NULL AND completed_by IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS "engagement_action_case_idx"
  ON attendance."engagement_action" ("tenant_id", "intervention_case_id", "due_at");

ALTER TABLE attendance."engagement_action" ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance."engagement_action" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON attendance."engagement_action";
CREATE POLICY tenant_isolation ON attendance."engagement_action"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS attendance."engagement_referral" (
  "id"                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"               uuid        NOT NULL REFERENCES "tenant" ("id"),
  "intervention_case_id"    uuid        NOT NULL,
  "target_service_code"     text        NOT NULL,
  "referral_type_code"      text        NOT NULL,
  "status_code"             text        NOT NULL DEFAULT 'pending',
  "external_reference"      text,
  "integration_exchange_id" uuid,
  "correlation_id"          uuid        NOT NULL,
  "referred_by"             text        NOT NULL,
  "referred_at"             timestamptz NOT NULL DEFAULT now(),
  "acknowledged_at"         timestamptz,
  "idempotency_key"         text        NOT NULL
);

CREATE INDEX IF NOT EXISTS "engagement_referral_case_idx"
  ON attendance."engagement_referral" ("tenant_id", "intervention_case_id", "status_code");

ALTER TABLE attendance."engagement_referral" ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance."engagement_referral" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON attendance."engagement_referral";
CREATE POLICY tenant_isolation ON attendance."engagement_referral"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Observation history is correction-only: a current version may be closed by
-- the bitemporal update transaction, but closed versions cannot be changed and
-- neither observations nor their revision ledger can be deleted.
CREATE OR REPLACE FUNCTION attendance.engagement_protect_observation_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'engagement observation history is append-only';
  END IF;
  IF OLD.recorded_until IS NOT NULL THEN
    RAISE EXCEPTION 'closed engagement observation versions are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS engagement_observation_history_guard ON attendance."engagement_observation";
CREATE TRIGGER engagement_observation_history_guard
  BEFORE UPDATE OR DELETE ON attendance."engagement_observation"
  FOR EACH ROW EXECUTE FUNCTION attendance.engagement_protect_observation_history();

CREATE OR REPLACE FUNCTION attendance.engagement_protect_revision_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'engagement observation revisions are append-only';
END;
$$;

DROP TRIGGER IF EXISTS engagement_observation_revision_history_guard ON attendance."engagement_observation_revision";
CREATE TRIGGER engagement_observation_revision_history_guard
  BEFORE UPDATE OR DELETE ON attendance."engagement_observation_revision"
  FOR EACH ROW EXECUTE FUNCTION attendance.engagement_protect_revision_history();

-- ── Event log (consumer idempotency) ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS attendance."event_log" (
  "id"             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id"       text        NOT NULL,
  "subject"        text        NOT NULL,
  "tenant_id"      uuid        NOT NULL,
  "stream_seq"     bigint,
  "consumer_group" text        NOT NULL,
  "event_hash"     text        NOT NULL,
  "processed_at"   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "event_log_unique" UNIQUE ("event_id", "consumer_group")
);

CREATE INDEX IF NOT EXISTS "event_log_tenant_seq_idx"
  ON attendance."event_log" ("tenant_id", "consumer_group", "stream_seq");

ALTER TABLE attendance."event_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance."event_log" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON attendance."event_log";
CREATE POLICY tenant_isolation ON attendance."event_log"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── SRS context projection (enrolment / module-registration lookup maps) ────

CREATE TABLE IF NOT EXISTS attendance."enrolment_person_map" (
  "tenant_id"    uuid        NOT NULL REFERENCES "tenant" ("id"),
  "enrolment_id" uuid        NOT NULL,
  "person_id"    uuid        NOT NULL,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("tenant_id", "enrolment_id")
);

ALTER TABLE attendance."enrolment_person_map" ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance."enrolment_person_map" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON attendance."enrolment_person_map";
CREATE POLICY tenant_isolation ON attendance."enrolment_person_map"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS attendance."module_registration_map" (
  "tenant_id"              uuid        NOT NULL REFERENCES "tenant" ("id"),
  "module_registration_id" uuid        NOT NULL,
  "enrolment_id"           uuid        NOT NULL,
  "person_id"              uuid        NOT NULL,
  "module_id"              text        NOT NULL,
  "status_code"            text        NOT NULL DEFAULT 'registered',
  "created_at"             timestamptz NOT NULL DEFAULT now(),
  "updated_at"             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("tenant_id", "module_registration_id")
);

CREATE INDEX IF NOT EXISTS "module_registration_map_enrolment_idx"
  ON attendance."module_registration_map" ("tenant_id", "enrolment_id");

ALTER TABLE attendance."module_registration_map" ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance."module_registration_map" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON attendance."module_registration_map";
CREATE POLICY tenant_isolation ON attendance."module_registration_map"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
