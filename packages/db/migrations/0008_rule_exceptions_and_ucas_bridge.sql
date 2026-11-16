-- Rule exceptions and recognised credit applied by the rules engine (BPR-D05),
-- and the UCAS adapter feeding the channel-neutral application (BPR-D01).

-- Originally 0008_exception_values_and_credit_years.sql
-- 0008 — Rule exception values and recognised-credit years (BPR-D05 wiring)
--
-- rule_exception.variation_value: what an approved variation replaces the
--   programme rule's value with, in that rule's own shape (e.g.
--   {"maxCredits": 140} for max-credits-per-period). A waiver has none.
-- recognised_credit.academic_year: the academic year whose progression the
--   credit counts towards; null means it counts only towards the award.

ALTER TABLE "rule_exception" ADD COLUMN IF NOT EXISTS "variation_value" jsonb;
ALTER TABLE "rule_exception" DROP CONSTRAINT IF EXISTS "rule_exception_variation_value_check";
ALTER TABLE "rule_exception" ADD CONSTRAINT "rule_exception_variation_value_check"
  CHECK (("exception_type_code" = 'variation') = ("variation_value" IS NOT NULL));

ALTER TABLE "recognised_credit" ADD COLUMN IF NOT EXISTS "academic_year" text;
CREATE INDEX IF NOT EXISTS "recognised_credit_year_idx" ON "recognised_credit" ("tenant_id", "enrolment_id", "academic_year");

-- Originally 0009_ucas_application_bridge.sql
-- 0009 — The UCAS adapter feeds the channel-neutral application (BPR-D01)
--
-- A channel can send an application before it names a recognised programme,
-- intake or mode of study. Such an application is still received and kept,
-- on the incomplete worklist, instead of being refused: the route facts are
-- nullable, but only while the application is incomplete.

ALTER TABLE "student_application" ALTER COLUMN "programme_id" DROP NOT NULL;
ALTER TABLE "student_application" ALTER COLUMN "intake_code" DROP NOT NULL;
ALTER TABLE "student_application" ALTER COLUMN "mode_of_study_code" DROP NOT NULL;

ALTER TABLE "student_application" DROP CONSTRAINT IF EXISTS "student_application_route_facts_check";
ALTER TABLE "student_application" ADD CONSTRAINT "student_application_route_facts_check"
  CHECK ("status_code" = 'incomplete'
    OR ("programme_id" IS NOT NULL AND "intake_code" IS NOT NULL AND "mode_of_study_code" IS NOT NULL));

CREATE INDEX IF NOT EXISTS "student_application_ucas_idx"
  ON "student_application" ("tenant_id", "ucas_application_id") WHERE "ucas_application_id" IS NOT NULL;
