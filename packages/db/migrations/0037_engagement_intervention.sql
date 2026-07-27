-- Revelation SRS — Attendance and Academic Engagement Aggregate
-- Migration: 0037_engagement_intervention
-- Implements the generic Increment B storage baseline for BP-027/BP-028.

CREATE TABLE "engagement_policy_version" (
  "version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "policy_code" text NOT NULL,
  "version_number" integer NOT NULL,
  "display_name" text NOT NULL,
  "status_code" text NOT NULL DEFAULT 'draft',
  "applicability" jsonb NOT NULL DEFAULT '{}',
  "evidence_window" jsonb NOT NULL DEFAULT '{}',
  "alert_rules" jsonb NOT NULL DEFAULT '{}',
  "review_deadline" jsonb NOT NULL DEFAULT '{}',
  "approved_by" text,
  "approved_at" timestamptz,
  "actor_id" text NOT NULL,
  "valid_from" timestamptz NOT NULL,
  "valid_to" timestamptz,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz,
  CONSTRAINT "engagement_policy_version_temporal_check_valid" CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "engagement_policy_version_temporal_check_recorded" CHECK (recorded_until IS NULL OR recorded_until > recorded_at),
  CONSTRAINT "engagement_policy_version_number_positive" CHECK (version_number > 0),
  CONSTRAINT "engagement_policy_version_approval_consistent" CHECK (
    (status_code = 'approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    OR status_code <> 'approved'
  )
);

CREATE TABLE "expected_engagement_event" (
  "version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "person_id" uuid NOT NULL,
  "enrolment_id" uuid NOT NULL,
  "activity_type_code" text NOT NULL,
  "activity_reference" text,
  "event_mode_code" text NOT NULL,
  "scheduled_from" timestamptz NOT NULL,
  "scheduled_to" timestamptz,
  "location_reference" text,
  "source_system_code" text NOT NULL,
  "source_event_id" text NOT NULL,
  "source_version" text NOT NULL,
  "status_code" text NOT NULL DEFAULT 'expected',
  "actor_id" text NOT NULL DEFAULT 'system',
  "valid_from" timestamptz NOT NULL,
  "valid_to" timestamptz,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz,
  CONSTRAINT "expected_engagement_event_temporal_check_valid" CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "expected_engagement_event_temporal_check_recorded" CHECK (recorded_until IS NULL OR recorded_until > recorded_at),
  CONSTRAINT "expected_engagement_event_schedule_check" CHECK (scheduled_to IS NULL OR scheduled_to > scheduled_from)
);

CREATE TABLE "engagement_observation" (
  "version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "expected_event_id" uuid,
  "person_id" uuid NOT NULL,
  "enrolment_id" uuid NOT NULL,
  "source_system_code" text NOT NULL,
  "source_event_id" text NOT NULL,
  "source_version" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "capture_method_code" text NOT NULL,
  "outcome_code" text NOT NULL,
  "data_quality_code" text NOT NULL DEFAULT 'valid',
  "event_time" timestamptz NOT NULL,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "device_reference" text,
  "operational_reference" text,
  "actor_id" text NOT NULL,
  "valid_from" timestamptz NOT NULL,
  "valid_to" timestamptz,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz,
  CONSTRAINT "engagement_observation_temporal_check_valid" CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "engagement_observation_temporal_check_recorded" CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE TABLE "engagement_observation_revision" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "observation_id" uuid NOT NULL,
  "superseded_version_id" uuid NOT NULL REFERENCES "engagement_observation"("version_id"),
  "replacement_version_id" uuid NOT NULL REFERENCES "engagement_observation"("version_id"),
  "correction_reason_code" text NOT NULL,
  "correction_reason" text,
  "disputed" boolean NOT NULL DEFAULT false,
  "authorised_by" text NOT NULL,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "correlation_id" uuid,
  CONSTRAINT "engagement_observation_revision_distinct_versions" CHECK (superseded_version_id <> replacement_version_id)
);

CREATE TABLE "engagement_alert" (
  "version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "person_id" uuid NOT NULL,
  "enrolment_id" uuid NOT NULL,
  "policy_version_id" uuid NOT NULL REFERENCES "engagement_policy_version"("version_id"),
  "evidence_window_from" timestamptz NOT NULL,
  "evidence_window_to" timestamptz NOT NULL,
  "evidence_snapshot" jsonb NOT NULL DEFAULT '{}',
  "evidence_hash" text NOT NULL,
  "explanation" jsonb NOT NULL DEFAULT '{}',
  "severity_code" text NOT NULL,
  "status_code" text NOT NULL DEFAULT 'open',
  "reevaluation_required" boolean NOT NULL DEFAULT false,
  "actor_id" text NOT NULL DEFAULT 'system',
  "valid_from" timestamptz NOT NULL,
  "valid_to" timestamptz,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz,
  CONSTRAINT "engagement_alert_temporal_check_valid" CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "engagement_alert_temporal_check_recorded" CHECK (recorded_until IS NULL OR recorded_until > recorded_at),
  CONSTRAINT "engagement_alert_window_check" CHECK (evidence_window_to > evidence_window_from)
);

CREATE TABLE "engagement_intervention_case" (
  "version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "alert_id" uuid NOT NULL,
  "person_id" uuid NOT NULL,
  "enrolment_id" uuid NOT NULL,
  "status_code" text NOT NULL DEFAULT 'open',
  "outcome_code" text,
  "assigned_role_code" text,
  "assigned_actor_id" text,
  "workflow_instance_id" uuid,
  "correlation_id" uuid NOT NULL,
  "opened_at" timestamptz NOT NULL DEFAULT now(),
  "review_at" timestamptz,
  "due_at" timestamptz,
  "closed_at" timestamptz,
  "actor_id" text NOT NULL,
  "valid_from" timestamptz NOT NULL,
  "valid_to" timestamptz,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz,
  CONSTRAINT "engagement_intervention_case_temporal_check_valid" CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "engagement_intervention_case_temporal_check_recorded" CHECK (recorded_until IS NULL OR recorded_until > recorded_at),
  CONSTRAINT "engagement_intervention_case_closure_check" CHECK (
    (status_code = 'closed' AND outcome_code IS NOT NULL AND closed_at IS NOT NULL)
    OR status_code <> 'closed'
  )
);

CREATE TABLE "engagement_contact_attempt" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "intervention_case_id" uuid NOT NULL,
  "channel_code" text NOT NULL,
  "attempted_at" timestamptz NOT NULL,
  "outcome_code" text NOT NULL,
  "communication_locale" text,
  "operational_note" text,
  "data_classification" text NOT NULL DEFAULT 'sensitive-personal',
  "actor_id" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "engagement_action" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "intervention_case_id" uuid NOT NULL,
  "action_type_code" text NOT NULL,
  "operational_instruction" text,
  "owner_role_code" text,
  "owner_actor_id" text,
  "due_at" timestamptz,
  "completed_at" timestamptz,
  "completed_by" text,
  "created_by" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "engagement_action_completion_check" CHECK (
    (completed_at IS NULL AND completed_by IS NULL)
    OR (completed_at IS NOT NULL AND completed_by IS NOT NULL)
  )
);

CREATE TABLE "engagement_referral" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "intervention_case_id" uuid NOT NULL,
  "target_service_code" text NOT NULL,
  "referral_type_code" text NOT NULL,
  "status_code" text NOT NULL DEFAULT 'pending',
  "external_reference" text,
  "integration_exchange_id" uuid,
  "correlation_id" uuid NOT NULL,
  "referred_by" text NOT NULL,
  "referred_at" timestamptz NOT NULL DEFAULT now(),
  "acknowledged_at" timestamptz
);

-- Bitemporal uniqueness and source/idempotency invariants.
CREATE UNIQUE INDEX "engagement_policy_version_unique_logical_transaction"
  ON "engagement_policy_version" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX "engagement_policy_version_current_version_unique"
  ON "engagement_policy_version" ("tenant_id", "id") WHERE "recorded_until" IS NULL;
CREATE UNIQUE INDEX "engagement_policy_version_code_number_unique"
  ON "engagement_policy_version" ("tenant_id", "policy_code", "version_number");

CREATE UNIQUE INDEX "expected_engagement_event_unique_logical_transaction"
  ON "expected_engagement_event" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX "expected_engagement_event_current_version_unique"
  ON "expected_engagement_event" ("tenant_id", "id") WHERE "recorded_until" IS NULL;
CREATE UNIQUE INDEX "expected_engagement_event_source_version_unique"
  ON "expected_engagement_event" ("tenant_id", "source_system_code", "source_event_id", "source_version");
CREATE INDEX "expected_engagement_event_worklist_idx"
  ON "expected_engagement_event" ("tenant_id", "scheduled_from", "status_code");

CREATE UNIQUE INDEX "engagement_observation_unique_logical_transaction"
  ON "engagement_observation" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX "engagement_observation_current_version_unique"
  ON "engagement_observation" ("tenant_id", "id") WHERE "recorded_until" IS NULL;
CREATE UNIQUE INDEX "engagement_observation_idempotency_unique"
  ON "engagement_observation" ("tenant_id", "source_system_code", "idempotency_key");
CREATE UNIQUE INDEX "engagement_observation_source_version_unique"
  ON "engagement_observation" ("tenant_id", "source_system_code", "source_event_id", "source_version");
CREATE INDEX "engagement_observation_timeline_idx"
  ON "engagement_observation" ("tenant_id", "person_id", "event_time");

CREATE UNIQUE INDEX "engagement_observation_revision_replacement_unique"
  ON "engagement_observation_revision" ("tenant_id", "replacement_version_id");

CREATE UNIQUE INDEX "engagement_alert_unique_logical_transaction"
  ON "engagement_alert" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX "engagement_alert_current_version_unique"
  ON "engagement_alert" ("tenant_id", "id") WHERE "recorded_until" IS NULL;
CREATE UNIQUE INDEX "engagement_alert_evaluation_unique"
  ON "engagement_alert" ("tenant_id", "person_id", "policy_version_id", "evidence_window_from", "evidence_window_to", "evidence_hash")
  WHERE "recorded_until" IS NULL;
CREATE INDEX "engagement_alert_queue_idx"
  ON "engagement_alert" ("tenant_id", "status_code", "severity_code", "evidence_window_to");

CREATE UNIQUE INDEX "engagement_intervention_case_unique_logical_transaction"
  ON "engagement_intervention_case" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX "engagement_intervention_case_current_version_unique"
  ON "engagement_intervention_case" ("tenant_id", "id") WHERE "recorded_until" IS NULL;
CREATE UNIQUE INDEX "engagement_intervention_case_open_alert_unique"
  ON "engagement_intervention_case" ("tenant_id", "alert_id")
  WHERE "recorded_until" IS NULL AND "status_code" <> 'closed';
CREATE INDEX "engagement_intervention_case_worklist_idx"
  ON "engagement_intervention_case" ("tenant_id", "status_code", "assigned_actor_id", "due_at");

CREATE INDEX "engagement_contact_attempt_case_idx"
  ON "engagement_contact_attempt" ("tenant_id", "intervention_case_id", "attempted_at");
CREATE INDEX "engagement_action_case_idx"
  ON "engagement_action" ("tenant_id", "intervention_case_id", "due_at");
CREATE INDEX "engagement_referral_case_idx"
  ON "engagement_referral" ("tenant_id", "intervention_case_id", "status_code");

-- Observation history is correction-only: a current version may be closed by
-- the bitemporal update transaction, but closed versions cannot be changed and
-- neither observations nor their revision ledger can be deleted.
CREATE FUNCTION engagement_protect_observation_history() RETURNS trigger
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

CREATE TRIGGER engagement_observation_history_guard
  BEFORE UPDATE OR DELETE ON "engagement_observation"
  FOR EACH ROW EXECUTE FUNCTION engagement_protect_observation_history();

CREATE FUNCTION engagement_protect_revision_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'engagement observation revisions are append-only';
END;
$$;

CREATE TRIGGER engagement_observation_revision_history_guard
  BEFORE UPDATE OR DELETE ON "engagement_observation_revision"
  FOR EACH ROW EXECUTE FUNCTION engagement_protect_revision_history();

-- Every engagement table is tenant-owned and protected at the database boundary.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'engagement_policy_version',
    'expected_engagement_event',
    'engagement_observation',
    'engagement_observation_revision',
    'engagement_alert',
    'engagement_intervention_case',
    'engagement_contact_attempt',
    'engagement_action',
    'engagement_referral'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)', table_name);
  END LOOP;
END $$;

-- Generic product value sets. Tenant extensibility is deliberately limited to
-- activity, mode and capture method; lifecycle/control semantics are stable.
INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('engagement-activity-type-code', 'Engagement Activity Type', 'srs-internal', 'Expected or recognised academic activity', true),
  ('engagement-event-mode-code', 'Engagement Event Mode', 'srs-internal', 'Mode in which an engagement event occurs', true),
  ('engagement-observation-outcome-code', 'Engagement Observation Outcome', 'srs-internal', 'Normalised source observation outcome', false),
  ('engagement-capture-method-code', 'Engagement Capture Method', 'srs-internal', 'Method used to capture an observation', true),
  ('engagement-data-quality-code', 'Engagement Data Quality', 'srs-internal', 'Quality and reconciliation state of an observation', false),
  ('engagement-alert-status-code', 'Engagement Alert Status', 'srs-internal', 'Lifecycle of an explainable non-engagement alert', false),
  ('engagement-case-status-code', 'Engagement Case Status', 'srs-internal', 'Lifecycle of an intervention case', false),
  ('engagement-case-outcome-code', 'Engagement Case Outcome', 'srs-internal', 'Authorised intervention case outcome', false),
  ('engagement-referral-status-code', 'Engagement Referral Status', 'srs-internal', 'Delivery and reconciliation state of a referral', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, member.code, member.label, member.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('engagement-activity-type-code', 'lecture', 'Lecture', 10),
  ('engagement-activity-type-code', 'seminar-tutorial', 'Seminar or tutorial', 20),
  ('engagement-activity-type-code', 'laboratory-practical', 'Laboratory or practical', 30),
  ('engagement-activity-type-code', 'assessment', 'Assessment', 40),
  ('engagement-activity-type-code', 'research-supervision', 'Research supervision', 50),
  ('engagement-activity-type-code', 'research-fieldwork', 'Research fieldwork', 60),
  ('engagement-activity-type-code', 'placement', 'Placement', 70),
  ('engagement-activity-type-code', 'online-activity', 'Online activity', 80),
  ('engagement-activity-type-code', 'other-recognised', 'Other recognised activity', 90),
  ('engagement-event-mode-code', 'in-person', 'In person', 10),
  ('engagement-event-mode-code', 'remote-live', 'Remote live', 20),
  ('engagement-event-mode-code', 'asynchronous', 'Asynchronous', 30),
  ('engagement-event-mode-code', 'hybrid', 'Hybrid', 40),
  ('engagement-event-mode-code', 'off-campus', 'Off campus', 50),
  ('engagement-observation-outcome-code', 'attended', 'Attended', 10),
  ('engagement-observation-outcome-code', 'absent', 'Absent', 20),
  ('engagement-observation-outcome-code', 'authorised-absence', 'Authorised absence', 30),
  ('engagement-observation-outcome-code', 'partial', 'Partial engagement', 40),
  ('engagement-observation-outcome-code', 'alternative-engagement', 'Alternative engagement', 50),
  ('engagement-observation-outcome-code', 'cancelled', 'Cancelled', 60),
  ('engagement-observation-outcome-code', 'not-captured', 'Not captured', 70),
  ('engagement-capture-method-code', 'staff-entry', 'Staff entry', 10),
  ('engagement-capture-method-code', 'student-check-in', 'Student check-in', 20),
  ('engagement-capture-method-code', 'device-scan', 'Device scan', 30),
  ('engagement-capture-method-code', 'vle-activity', 'VLE activity', 40),
  ('engagement-capture-method-code', 'assessment-submission', 'Assessment submission', 50),
  ('engagement-capture-method-code', 'source-import', 'Source import', 60),
  ('engagement-capture-method-code', 'specialist-confirmation', 'Specialist confirmation', 70),
  ('engagement-data-quality-code', 'valid', 'Valid', 10),
  ('engagement-data-quality-code', 'missing', 'Missing', 20),
  ('engagement-data-quality-code', 'duplicate', 'Duplicate', 30),
  ('engagement-data-quality-code', 'disputed', 'Disputed', 40),
  ('engagement-data-quality-code', 'conflicting', 'Conflicting', 50),
  ('engagement-data-quality-code', 'quarantined', 'Quarantined', 60),
  ('engagement-data-quality-code', 'corrected', 'Corrected', 70),
  ('engagement-alert-status-code', 'open', 'Open', 10),
  ('engagement-alert-status-code', 'suspended-reconciliation', 'Suspended for reconciliation', 20),
  ('engagement-alert-status-code', 'triaged-no-action', 'Triaged — no action', 30),
  ('engagement-alert-status-code', 'intervention-opened', 'Intervention opened', 40),
  ('engagement-alert-status-code', 'superseded', 'Superseded', 50),
  ('engagement-alert-status-code', 'closed', 'Closed', 60),
  ('engagement-case-status-code', 'open', 'Open', 10),
  ('engagement-case-status-code', 'contact-in-progress', 'Contact in progress', 20),
  ('engagement-case-status-code', 'review-due', 'Review due', 30),
  ('engagement-case-status-code', 'referred', 'Referred', 40),
  ('engagement-case-status-code', 'closed', 'Closed', 50),
  ('engagement-case-outcome-code', 'data-corrected', 'Data corrected', 10),
  ('engagement-case-outcome-code', 'no-concern', 'No concern', 20),
  ('engagement-case-outcome-code', 'engagement-restored', 'Engagement restored', 30),
  ('engagement-case-outcome-code', 'support-continuing', 'Support continuing', 40),
  ('engagement-case-outcome-code', 'no-response', 'No response', 50),
  ('engagement-case-outcome-code', 'referred-wellbeing', 'Referred to wellbeing', 60),
  ('engagement-case-outcome-code', 'referred-safeguarding', 'Referred to safeguarding', 70),
  ('engagement-case-outcome-code', 'referred-academic-status', 'Referred for academic-status review', 80),
  ('engagement-case-outcome-code', 'referred-sponsor-compliance', 'Referred for sponsor-compliance review', 90),
  ('engagement-referral-status-code', 'pending', 'Pending', 10),
  ('engagement-referral-status-code', 'acknowledged', 'Acknowledged', 20),
  ('engagement-referral-status-code', 'rejected', 'Rejected', 30),
  ('engagement-referral-status-code', 'reconciled', 'Reconciled', 40),
  ('engagement-referral-status-code', 'cancelled', 'Cancelled', 50)
) AS member(set_code, code, label, sort_order)
  ON member.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('expected_engagement_event', 'activity_type_code', 'engagement-activity-type-code'),
  ('expected_engagement_event', 'event_mode_code', 'engagement-event-mode-code'),
  ('engagement_observation', 'capture_method_code', 'engagement-capture-method-code'),
  ('engagement_observation', 'outcome_code', 'engagement-observation-outcome-code'),
  ('engagement_observation', 'data_quality_code', 'engagement-data-quality-code'),
  ('engagement_alert', 'status_code', 'engagement-alert-status-code'),
  ('engagement_intervention_case', 'status_code', 'engagement-case-status-code'),
  ('engagement_intervention_case', 'outcome_code', 'engagement-case-outcome-code'),
  ('engagement_referral', 'status_code', 'engagement-referral-status-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;
