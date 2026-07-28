-- Revelation SRS — Engagement Outcome (Stage 1 attendance-module extraction)
-- Migration: 0041_engagement_outcome
--
-- Core-owned, bitemporal record of the operational outcome produced by the
-- attendance module's evidence, policy evaluation, and intervention casework.
-- The attendance module never writes to SRS tables directly; it calls
-- POST /api/v1/students/:personId/engagement-outcomes, and this table is the
-- authoritative record of that handoff, mirroring the existing
-- reasonable_adjustment / F063 pattern.

CREATE TABLE "engagement_outcome" (
  "version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "person_id" uuid NOT NULL,
  "enrolment_id" uuid NOT NULL,
  "module_registration_id" uuid,
  "outcome_code" text NOT NULL,
  "severity_code" text,
  "source_alert_id" text,
  "source_module" text NOT NULL DEFAULT 'attendance',
  "actor_id" text NOT NULL,
  "valid_from" timestamptz NOT NULL,
  "valid_to" timestamptz,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz,
  CONSTRAINT "engagement_outcome_temporal_check_valid" CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "engagement_outcome_temporal_check_recorded" CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX "engagement_outcome_unique_logical_transaction"
  ON "engagement_outcome" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX "engagement_outcome_current_version_unique"
  ON "engagement_outcome" ("tenant_id", "id") WHERE "recorded_until" IS NULL;
CREATE INDEX "engagement_outcome_person_idx"
  ON "engagement_outcome" ("tenant_id", "person_id");
CREATE INDEX "engagement_outcome_module_registration_idx"
  ON "engagement_outcome" ("tenant_id", "module_registration_id");

-- Idempotency for the F063-style handoff: sourceAlertId + outcomeCode
-- identifies a single logical submission from the attendance module so the
-- X-Idempotency-Key check can detect a repeat delivery cheaply.
CREATE UNIQUE INDEX "engagement_outcome_source_alert_unique"
  ON "engagement_outcome" ("tenant_id", "source_alert_id", "outcome_code")
  WHERE "source_alert_id" IS NOT NULL AND "recorded_until" IS NULL;

ALTER TABLE "engagement_outcome" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "engagement_outcome" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "engagement_outcome"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('engagement-outcome-code', 'Engagement Outcome', 'srs-internal', 'Recorded operational outcome of attendance-module casework', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, member.code, member.label, member.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('engagement-outcome-code', 'at-risk', 'At risk', 10),
  ('engagement-outcome-code', 'non-engagement', 'Non-engagement', 20),
  ('engagement-outcome-code', 'engagement-restored', 'Engagement restored', 30),
  ('engagement-outcome-code', 'no-concern', 'No concern', 40),
  ('engagement-outcome-code', 'support-continuing', 'Support continuing', 50),
  ('engagement-outcome-code', 'referred-wellbeing', 'Referred to wellbeing', 60),
  ('engagement-outcome-code', 'referred-safeguarding', 'Referred to safeguarding', 70),
  ('engagement-outcome-code', 'referred-academic-status', 'Referred for academic-status review', 80),
  ('engagement-outcome-code', 'referred-sponsor-compliance', 'Referred for sponsor-compliance review', 90),
  ('engagement-outcome-code', 'data-corrected', 'Data corrected', 100),
  ('engagement-outcome-code', 'no-response', 'No response', 110)
) AS member(set_code, code, label, sort_order)
  ON member.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('engagement_outcome', 'outcome_code', 'engagement-outcome-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;
