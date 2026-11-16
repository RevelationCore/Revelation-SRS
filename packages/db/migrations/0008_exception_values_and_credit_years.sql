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
