-- 0009 — Reassessment plans, award recommendation and conferment (BPR-D14; BP-06-002, BP-06-003)
--
-- reassessment_plan: the next attempt an authorised (ratified) progression
--   decision creates: resit without attendance, referral, repeat module,
--   repeat stage, deferral or an exceptional additional attempt, with its
--   attempt number and any mark cap. Tracked to completion or expiry
--   without overwriting earlier attempts.
-- award_recommendation: the board's recommendation (BP-06-003 step 4),
--   bound to the calculated classification; any difference is recorded as
--   authorised discretion with a reason.
-- award_conferment: the immutable conferment by a delegated authority who is
--   not the recommender (step 5), which creates the award (step 6). Rows
--   cannot be updated or deleted: a correction is a new, separate record
--   (E2).

CREATE TABLE IF NOT EXISTS "reassessment_plan" (
  "id"                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                uuid        NOT NULL REFERENCES "tenant" ("id"),
  "enrolment_id"             uuid        NOT NULL,
  "progression_decision_id"  uuid        NOT NULL,   -- the authorised decision it follows
  "plan_type_code"           text        NOT NULL,   -- value set reassessment-plan-type-code
  "module_registration_id"   uuid,                   -- module-level plans
  "assessment_component_id"  uuid,
  "academic_period_id"       uuid,
  "attempt_number"           smallint    NOT NULL CHECK ("attempt_number" >= 2),
  "mark_cap"                 smallint    CHECK ("mark_cap" BETWEEN 0 AND 100),
  "due_date"                 date,
  -- planned | completed | expired | cancelled
  "status_code"              text        NOT NULL DEFAULT 'planned',
  "outcome_note"             text,
  "created_by"               text        NOT NULL,
  "created_at"               timestamptz NOT NULL DEFAULT now(),
  "closed_by"                text,
  "closed_at"                timestamptz,
  CONSTRAINT "reassessment_plan_status_check" CHECK ("status_code" IN ('planned', 'completed', 'expired', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS "reassessment_plan_enrolment_idx" ON "reassessment_plan" ("tenant_id", "enrolment_id");

CREATE TABLE IF NOT EXISTS "award_recommendation" (
  "id"                           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                    uuid        NOT NULL REFERENCES "tenant" ("id"),
  "enrolment_id"                 uuid        NOT NULL,
  "person_id"                    uuid        NOT NULL,
  "exam_board_id"                uuid,
  "award_type_code"              text        NOT NULL,   -- value set award-type-code
  "qualification_code"           text        NOT NULL,
  "classification_code"          text        NOT NULL,
  "calculated_classification_code" text,
  "aggregate_mark"               numeric(6,2),
  "discretion_reason"            text,                   -- set when classification differs from the calculation
  "authority_ref"                text,                   -- policy authority for aegrotat/posthumous awards
  -- recommended | conferred | withdrawn
  "status_code"                  text        NOT NULL DEFAULT 'recommended',
  "recommended_by"               text        NOT NULL,
  "recommended_at"               timestamptz NOT NULL DEFAULT now(),
  "withdrawn_reason"             text,
  CONSTRAINT "award_recommendation_status_check" CHECK ("status_code" IN ('recommended', 'conferred', 'withdrawn')),
  CONSTRAINT "award_recommendation_discretion_check"
    CHECK ("calculated_classification_code" IS NULL OR "classification_code" = "calculated_classification_code" OR "discretion_reason" IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS "award_recommendation_one_open"
  ON "award_recommendation" ("tenant_id", "enrolment_id") WHERE "status_code" = 'recommended';

CREATE TABLE IF NOT EXISTS "award_conferment" (
  "id"                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"          uuid        NOT NULL REFERENCES "tenant" ("id"),
  "recommendation_id"  uuid        NOT NULL UNIQUE REFERENCES "award_recommendation" ("id"),
  "award_id"           uuid        NOT NULL,
  "conferment_date"    date        NOT NULL,
  "authority_ref"      text        NOT NULL,   -- the delegated authority, e.g. Senate minute
  "conferred_by"       text        NOT NULL,
  "conferred_at"       timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION award_conferment_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'award conferment is append-only; record a correction or revocation instead';
END;
$$;

CREATE TRIGGER award_conferment_immutable_guard
  BEFORE UPDATE OR DELETE ON "award_conferment"
  FOR EACH ROW EXECUTE FUNCTION award_conferment_immutable();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['reassessment_plan', 'award_recommendation', 'award_conferment'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)', t);
  END LOOP;
END $$;

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('reassessment-plan-type-code', 'Reassessment Plan Type', 'srs-internal', NULL, 'Kind of further attempt an authorised progression decision creates', true),
  ('award-type-code', 'Award Type', 'srs-internal', NULL, 'Basis of an award recommendation', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z'
FROM "value_set" vs,
(VALUES
  ('reassessment-plan-type-code', 'resit-without-attendance', 'Resit without attendance',       10),
  ('reassessment-plan-type-code', 'referral',                 'Referral',                       20),
  ('reassessment-plan-type-code', 'repeat-module',            'Repeat module with attendance',  30),
  ('reassessment-plan-type-code', 'repeat-stage',             'Repeat stage',                   40),
  ('reassessment-plan-type-code', 'deferral',                 'Deferral (first attempt treatment)', 50),
  ('reassessment-plan-type-code', 'additional-attempt',       'Exceptional additional attempt', 60),
  ('award-type-code', 'standard',   'Standard award', 10),
  ('award-type-code', 'exit',       'Exit award',     20),
  ('award-type-code', 'aegrotat',   'Aegrotat award', 30),
  ('award-type-code', 'posthumous', 'Posthumous award', 40)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('reassessment_plan', 'plan_type_code', 'reassessment-plan-type-code', NULL),
  ('award_recommendation', 'award_type_code', 'award-type-code', NULL)
ON CONFLICT DO NOTHING;
