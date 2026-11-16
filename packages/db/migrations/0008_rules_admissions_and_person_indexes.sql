-- Refinements after the business-process aggregates: rule exceptions applied by
-- the rules engine (BPR-D05), the UCAS adapter feeding the channel-neutral
-- application (BPR-D01), and indexes on every foreign key into person.

-- Originally 0008_rule_exceptions_and_ucas_bridge.sql
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

-- Originally 0009_person_foreign_key_indexes.sql
-- 0009 — Index every foreign key into person
--
-- Each column below references person(id) but had no index leading with it
-- (some had (tenant_id, person_id), which a foreign-key check cannot use).
-- Deleting a person then scanned every one of these tables in full: slow for
-- an erasure or identity merge, and over a minute for a demo reset of a
-- large scenario. Postgres does not index foreign-key columns itself.

CREATE INDEX IF NOT EXISTS data_correction_case_person_id_fk_idx ON data_correction_case (person_id);
CREATE INDEX IF NOT EXISTS disability_declaration_person_id_fk_idx ON disability_declaration (person_id);
CREATE INDEX IF NOT EXISTS enrolment_person_id_fk_idx ON enrolment (person_id);
CREATE INDEX IF NOT EXISTS examiner_appointment_person_id_fk_idx ON examiner_appointment (person_id);
CREATE INDEX IF NOT EXISTS fee_liability_person_id_fk_idx ON fee_liability (person_id);
CREATE INDEX IF NOT EXISTS hesa_identifier_assignment_person_id_fk_idx ON hesa_identifier_assignment (person_id);
CREATE INDEX IF NOT EXISTS identity_redirect_new_person_id_fk_idx ON identity_redirect (new_person_id);
CREATE INDEX IF NOT EXISTS identity_redirect_old_person_id_fk_idx ON identity_redirect (old_person_id);
CREATE INDEX IF NOT EXISTS identity_resolution_candidate_candidate_person_id_fk_idx ON identity_resolution_candidate (candidate_person_id);
CREATE INDEX IF NOT EXISTS identity_resolution_decision_survivor_person_id_fk_idx ON identity_resolution_decision (survivor_person_id);
CREATE INDEX IF NOT EXISTS identity_verification_check_person_id_fk_idx ON identity_verification_check (person_id);
CREATE INDEX IF NOT EXISTS individual_rights_request_person_id_fk_idx ON individual_rights_request (person_id);
CREATE INDEX IF NOT EXISTS person_identity_link_source_person_id_fk_idx ON person_identity_link (source_person_id);
CREATE INDEX IF NOT EXISTS person_identity_link_target_person_id_fk_idx ON person_identity_link (target_person_id);
CREATE INDEX IF NOT EXISTS person_identity_person_id_fk_idx ON person_identity (person_id);
CREATE INDEX IF NOT EXISTS pgr_review_member_person_id_fk_idx ON pgr_review_member (person_id);
CREATE INDEX IF NOT EXISTS pgr_supervisor_nomination_person_id_fk_idx ON pgr_supervisor_nomination (person_id);
CREATE INDEX IF NOT EXISTS processing_restriction_person_id_fk_idx ON processing_restriction (person_id);
CREATE INDEX IF NOT EXISTS staff_assignment_person_id_fk_idx ON staff_assignment (person_id);
CREATE INDEX IF NOT EXISTS student_address_person_id_fk_idx ON student_address (person_id);
CREATE INDEX IF NOT EXISTS student_contact_method_person_id_fk_idx ON student_contact_method (person_id);
CREATE INDEX IF NOT EXISTS student_regulatory_profile_person_id_fk_idx ON student_regulatory_profile (person_id);
