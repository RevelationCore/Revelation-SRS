-- Revelation SRS — Phase 6 Remediation
-- Migration: 0008_phase6_remediation
--
-- 1. Add source_code discriminator to hesa_validation_report so internal pre-submission
--    validation runs are distinguished from official HESA authority reports.
-- 2. Add unique partial index on ukvi_compliance_alert to prevent duplicate open alerts
--    under concurrent evaluateComplianceAlerts calls.
-- 3. Add amendment_diff JSONB column to hesa_student_return_record to support HES-005
--    delta tracking when an amendment return is generated.

-- ── 1. hesa_validation_report.source_code ───────────────────────────────────

ALTER TABLE "hesa_validation_report"
  ADD COLUMN IF NOT EXISTS "source_code" text NOT NULL DEFAULT 'internal';

COMMENT ON COLUMN "hesa_validation_report"."source_code" IS
  'Discriminator: ''internal'' for pre-submission validation runs; ''hesa-authority'' for official HESA validation reports.';

-- Back-fill: rows with a non-null integration_exchange_id are authority reports.
UPDATE "hesa_validation_report"
  SET "source_code" = 'hesa-authority'
  WHERE "integration_exchange_id" IS NOT NULL;

-- ── 2. ukvi_compliance_alert unique partial index ────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "ukvi_compliance_alert_open_unique"
  ON "ukvi_compliance_alert" ("tenant_id", "enrolment_id", "alert_type_code")
  WHERE "resolved_at" IS NULL;

-- ── 3. hesa_student_return_record.amendment_diff ────────────────────────────

ALTER TABLE "hesa_student_return_record"
  ADD COLUMN IF NOT EXISTS "amendment_diff" jsonb;

COMMENT ON COLUMN "hesa_student_return_record"."amendment_diff" IS
  'Null on original returns. On amendment returns, contains a field-level diff against the corresponding record in the original return (amendmentOfId). Keyed by HESA field code; each value is {previous, current}.';
