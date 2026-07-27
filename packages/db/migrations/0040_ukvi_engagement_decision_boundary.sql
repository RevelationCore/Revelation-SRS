-- Increment G: governed engagement evidence and Student sponsor decision boundary.

CREATE TABLE "ukvi_engagement_evidence_snapshot" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id" uuid NOT NULL,
  "engagement_alert_id" uuid NOT NULL,
  "policy_version_id" uuid NOT NULL,
  "evidence_window_from" timestamptz NOT NULL,
  "evidence_window_to" timestamptz NOT NULL,
  "evidence_summary" jsonb NOT NULL,
  "evidence_hash" text NOT NULL,
  "evidence_quality_code" text NOT NULL,
  "source_recorded_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" text NOT NULL,
  CONSTRAINT "ukvi_engagement_snapshot_window_check" CHECK ("evidence_window_to" > "evidence_window_from"),
  CONSTRAINT "ukvi_engagement_snapshot_quality_check" CHECK (
    "evidence_quality_code" IN ('verified', 'reconciliation-required')
  ),
  UNIQUE ("tenant_id", "engagement_alert_id", "evidence_hash")
);

CREATE TABLE "ukvi_sponsor_decision" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id" uuid NOT NULL,
  "evidence_snapshot_id" uuid NOT NULL REFERENCES "ukvi_engagement_evidence_snapshot"("id"),
  "outcome_code" text NOT NULL,
  "rationale_code" text NOT NULL,
  "guidance_version" text NOT NULL,
  "status_code" text NOT NULL DEFAULT 'pending-authorisation',
  "decided_at" timestamptz NOT NULL DEFAULT now(),
  "decided_by" text NOT NULL,
  "authorised_at" timestamptz,
  "authorised_by" text,
  "external_report_id" uuid REFERENCES "ukvi_attendance_report"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ukvi_sponsor_decision_outcome_check" CHECK (
    "outcome_code" IN ('report', 'no-report', 'further-review')
  ),
  CONSTRAINT "ukvi_sponsor_decision_status_check" CHECK (
    "status_code" IN ('pending-authorisation', 'authorised')
  ),
  CONSTRAINT "ukvi_sponsor_decision_authorisation_check" CHECK (
    ("status_code" = 'pending-authorisation' AND "authorised_at" IS NULL AND "authorised_by" IS NULL)
    OR
    ("status_code" = 'authorised' AND "authorised_at" IS NOT NULL AND "authorised_by" IS NOT NULL
      AND "authorised_by" <> "decided_by")
  ),
  UNIQUE ("tenant_id", "evidence_snapshot_id")
);

ALTER TABLE "ukvi_engagement_evidence_snapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ukvi_sponsor_decision" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ukvi_engagement_snapshot_tenant_isolation" ON "ukvi_engagement_evidence_snapshot"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY "ukvi_sponsor_decision_tenant_isolation" ON "ukvi_sponsor_decision"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

CREATE FUNCTION ukvi_protect_governed_evidence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'UKVI governed evidence and decisions are append-only';
END;
$$;
CREATE TRIGGER ukvi_engagement_snapshot_history_guard
  BEFORE UPDATE OR DELETE ON "ukvi_engagement_evidence_snapshot"
  FOR EACH ROW EXECUTE FUNCTION ukvi_protect_governed_evidence();
CREATE TRIGGER ukvi_sponsor_decision_delete_guard
  BEFORE DELETE ON "ukvi_sponsor_decision"
  FOR EACH ROW EXECUTE FUNCTION ukvi_protect_governed_evidence();

CREATE FUNCTION ukvi_protect_sponsor_decision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status_code <> 'pending-authorisation'
     OR NEW.status_code <> 'authorised'
     OR NEW.outcome_code <> OLD.outcome_code
     OR NEW.rationale_code <> OLD.rationale_code
     OR NEW.guidance_version <> OLD.guidance_version
     OR NEW.evidence_snapshot_id <> OLD.evidence_snapshot_id
     OR NEW.decided_by <> OLD.decided_by
     OR NEW.decided_at <> OLD.decided_at THEN
    RAISE EXCEPTION 'UKVI sponsor decision content is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ukvi_sponsor_decision_update_guard
  BEFORE UPDATE ON "ukvi_sponsor_decision"
  FOR EACH ROW EXECUTE FUNCTION ukvi_protect_sponsor_decision();

