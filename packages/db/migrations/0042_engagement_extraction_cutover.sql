-- Revelation SRS — Attendance/Engagement extraction cutover
-- Migration: 0042_engagement_extraction_cutover
--
-- Completes the Stage 1 extraction of attendance/engagement capture into the
-- standalone `modules/attendance` module, which recreates these 9 tables in
-- a separate "attendance" Postgres schema on the same physical database
-- instance (see modules/attendance/migrations/0001_attendance_initial.sql).
--
-- Every copy below uses an explicit, named column list on both sides —
-- required because idempotency_key was appended to four tables via
-- ALTER TABLE ADD COLUMN in migration 0039 (so it sits at the physical end
-- of the old public tables) while the module's schema places it in logical
-- column order instead; positional `SELECT *` would silently misalign
-- columns for those tables.
--
-- DEPLOYMENT PRECONDITION: the attendance module's own migration (creating
-- the "attendance" schema and its tables) MUST be applied to this database
-- before this migration runs, or any existing engagement rows in `public`
-- will be dropped without being copied. The copy step below is defensive —
-- it no-ops (with a NOTICE) if the "attendance" schema is not yet present,
-- but it does NOT block the subsequent DROP. Operators upgrading a
-- deployment that already captured real engagement data must run the
-- module's migration first.

DO $$
BEGIN
  IF to_regclass('attendance.expected_engagement_event') IS NOT NULL THEN

    INSERT INTO attendance.engagement_policy_version (
      version_id, id, tenant_id, policy_code, version_number, display_name, status_code,
      applicability, evidence_window, alert_rules, review_deadline, approved_by, approved_at,
      actor_id, valid_from, valid_to, recorded_at, recorded_until
    )
    SELECT
      version_id, id, tenant_id, policy_code, version_number, display_name, status_code,
      applicability, evidence_window, alert_rules, review_deadline, approved_by, approved_at,
      actor_id, valid_from, valid_to, recorded_at, recorded_until
    FROM public.engagement_policy_version
    ON CONFLICT DO NOTHING;

    -- module_registration_id is new in the attendance schema; NULL for all
    -- copied rows (real linkage only exists for newly created events).
    INSERT INTO attendance.expected_engagement_event (
      version_id, id, tenant_id, person_id, enrolment_id, module_registration_id,
      activity_type_code, activity_reference, event_mode_code, scheduled_from, scheduled_to,
      location_reference, source_system_code, source_event_id, source_version, status_code,
      actor_id, valid_from, valid_to, recorded_at, recorded_until
    )
    SELECT
      version_id, id, tenant_id, person_id, enrolment_id, NULL,
      activity_type_code, activity_reference, event_mode_code, scheduled_from, scheduled_to,
      location_reference, source_system_code, source_event_id, source_version, status_code,
      actor_id, valid_from, valid_to, recorded_at, recorded_until
    FROM public.expected_engagement_event
    ON CONFLICT DO NOTHING;

    INSERT INTO attendance.engagement_observation (
      version_id, id, tenant_id, expected_event_id, person_id, enrolment_id, source_system_code,
      source_event_id, source_version, idempotency_key, capture_method_code, outcome_code,
      data_quality_code, event_time, received_at, device_reference, operational_reference,
      actor_id, valid_from, valid_to, recorded_at, recorded_until
    )
    SELECT
      version_id, id, tenant_id, expected_event_id, person_id, enrolment_id, source_system_code,
      source_event_id, source_version, idempotency_key, capture_method_code, outcome_code,
      data_quality_code, event_time, received_at, device_reference, operational_reference,
      actor_id, valid_from, valid_to, recorded_at, recorded_until
    FROM public.engagement_observation
    ON CONFLICT DO NOTHING;

    INSERT INTO attendance.engagement_observation_revision (
      id, tenant_id, observation_id, superseded_version_id, replacement_version_id,
      correction_reason_code, correction_reason, disputed, authorised_by, recorded_at, correlation_id
    )
    SELECT
      id, tenant_id, observation_id, superseded_version_id, replacement_version_id,
      correction_reason_code, correction_reason, disputed, authorised_by, recorded_at, correlation_id
    FROM public.engagement_observation_revision
    ON CONFLICT DO NOTHING;

    INSERT INTO attendance.engagement_alert (
      version_id, id, tenant_id, person_id, enrolment_id, policy_version_id, evidence_window_from,
      evidence_window_to, evidence_snapshot, evidence_hash, explanation, severity_code, status_code,
      reevaluation_required, actor_id, valid_from, valid_to, recorded_at, recorded_until
    )
    SELECT
      version_id, id, tenant_id, person_id, enrolment_id, policy_version_id, evidence_window_from,
      evidence_window_to, evidence_snapshot, evidence_hash, explanation, severity_code, status_code,
      reevaluation_required, actor_id, valid_from, valid_to, recorded_at, recorded_until
    FROM public.engagement_alert
    ON CONFLICT DO NOTHING;

    -- idempotency_key was appended via ALTER TABLE (migration 0039) on the
    -- following four tables — named columns on both sides, not SELECT *.
    INSERT INTO attendance.engagement_intervention_case (
      version_id, id, tenant_id, alert_id, person_id, enrolment_id, status_code, outcome_code,
      assigned_role_code, assigned_actor_id, workflow_instance_id, correlation_id, opened_at,
      review_at, due_at, closed_at, actor_id, idempotency_key, valid_from, valid_to, recorded_at, recorded_until
    )
    SELECT
      version_id, id, tenant_id, alert_id, person_id, enrolment_id, status_code, outcome_code,
      assigned_role_code, assigned_actor_id, workflow_instance_id, correlation_id, opened_at,
      review_at, due_at, closed_at, actor_id, idempotency_key, valid_from, valid_to, recorded_at, recorded_until
    FROM public.engagement_intervention_case
    ON CONFLICT DO NOTHING;

    INSERT INTO attendance.engagement_contact_attempt (
      id, tenant_id, intervention_case_id, channel_code, attempted_at, outcome_code,
      communication_locale, operational_note, data_classification, actor_id, idempotency_key, created_at
    )
    SELECT
      id, tenant_id, intervention_case_id, channel_code, attempted_at, outcome_code,
      communication_locale, operational_note, data_classification, actor_id, idempotency_key, created_at
    FROM public.engagement_contact_attempt
    ON CONFLICT DO NOTHING;

    INSERT INTO attendance.engagement_action (
      id, tenant_id, intervention_case_id, action_type_code, operational_instruction, owner_role_code,
      owner_actor_id, due_at, completed_at, completed_by, created_by, idempotency_key, created_at
    )
    SELECT
      id, tenant_id, intervention_case_id, action_type_code, operational_instruction, owner_role_code,
      owner_actor_id, due_at, completed_at, completed_by, created_by, idempotency_key, created_at
    FROM public.engagement_action
    ON CONFLICT DO NOTHING;

    INSERT INTO attendance.engagement_referral (
      id, tenant_id, intervention_case_id, target_service_code, referral_type_code, status_code,
      external_reference, integration_exchange_id, correlation_id, referred_by, referred_at,
      acknowledged_at, idempotency_key
    )
    SELECT
      id, tenant_id, intervention_case_id, target_service_code, referral_type_code, status_code,
      external_reference, integration_exchange_id, correlation_id, referred_by, referred_at,
      acknowledged_at, idempotency_key
    FROM public.engagement_referral
    ON CONFLICT DO NOTHING;

  ELSE
    RAISE NOTICE 'attendance schema not found — skipping engagement data copy; run modules/attendance migrate first if this database holds real engagement data';
  END IF;
END $$;

-- Retire the core copies. Core no longer owns attendance/engagement capture;
-- apps/api/src/platform/engagement/* and apps/api/src/routes/engagement*.ts
-- have been removed, and core only retains the `engagement_outcome` table
-- (migration 0041) as the authoritative record of the operational outcome
-- handed off by the attendance module.
DROP TABLE IF EXISTS "engagement_observation_revision";
DROP TABLE IF EXISTS "engagement_contact_attempt";
DROP TABLE IF EXISTS "engagement_action";
DROP TABLE IF EXISTS "engagement_referral";
DROP TABLE IF EXISTS "engagement_intervention_case";
DROP TABLE IF EXISTS "engagement_alert";
DROP TABLE IF EXISTS "engagement_observation";
DROP TABLE IF EXISTS "expected_engagement_event";
DROP TABLE IF EXISTS "engagement_policy_version";

DROP FUNCTION IF EXISTS engagement_protect_observation_history() CASCADE;
DROP FUNCTION IF EXISTS engagement_protect_revision_history() CASCADE;

-- These value sets now belong to the attendance module's own configuration
-- surface, not core's. Field-value-set bindings referenced the dropped
-- tables and must go with them; the value sets themselves are left in place
-- (harmless, and any institution-added extensions are preserved) but no
-- longer bound to any core entity.
DELETE FROM "field_value_set" WHERE "entity_name" IN (
  'expected_engagement_event', 'engagement_observation', 'engagement_alert', 'engagement_intervention_case'
);
