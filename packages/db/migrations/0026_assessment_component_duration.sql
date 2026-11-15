-- 0026 — Assessment component duration (AJ-21 finding 2)
--
-- An approved extra-time adjustment is a percentage of an assessment's
-- duration (25% of a 120-minute exam = 30 minutes, 150 in total). Nothing
-- recorded how long an exam is, so no exam entry could state the time a
-- candidate is entitled to. Null for untimed components (most coursework).

ALTER TABLE "assessment_component"
  ADD COLUMN IF NOT EXISTS "duration_minutes" integer;

ALTER TABLE "assessment_component"
  DROP CONSTRAINT IF EXISTS "assessment_component_duration_positive_check";
ALTER TABLE "assessment_component"
  ADD CONSTRAINT "assessment_component_duration_positive_check"
  CHECK ("duration_minutes" IS NULL OR ("duration_minutes" > 0 AND "duration_minutes" <= 1440));
