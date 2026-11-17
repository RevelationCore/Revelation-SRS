-- 0008 — Rule exceptions, admissions bridge and person indexes; registration
-- and the other Phase 2 processes. Squashed 2026-11-17 from 0008 and 0009.

-- Originally 0008_rules_admissions_and_person_indexes.sql
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

-- Originally 0009_registration_and_phase2.sql
-- 0009 — Registration and the other Phase 2 processes
-- (docs/decisions/phase-2-gap-closure-decisions.md, D-8 to D-13)
--
-- D-8  Annual re-registration: who opened and closed a period, its kind
--      (annual or initial), and on each confirmation who confirmed it,
--      through which channel, the terms version accepted and, for an
--      assisted confirmation, why. One current confirmation per enrolment
--      and period; one fee liability per enrolment and year.
-- D-10 A new enrolment status, pre-registration, before a new entrant
--      registers. The enrolment created from a confirmed offer has an ID
--      derived from the offer, so no column is needed on the append-only
--      offer_confirmation_decision.
-- D-11 The reason for changing one student's curriculum binding.
-- D-12 No two live reassessment plans of one type per decision and module.
-- D-13 A verbal Clearing offer is an offer type.

-- ── D-8 Re-registration ─────────────────────────────────────────────────────

ALTER TABLE "reenrolment_period" ADD COLUMN IF NOT EXISTS "period_type_code" text NOT NULL DEFAULT 'annual';
ALTER TABLE "reenrolment_period" ADD COLUMN IF NOT EXISTS "opened_by" text;
ALTER TABLE "reenrolment_period" ADD COLUMN IF NOT EXISTS "closed_at" timestamptz;
ALTER TABLE "reenrolment_period" ADD COLUMN IF NOT EXISTS "closed_by" text;
ALTER TABLE "reenrolment_period" DROP CONSTRAINT IF EXISTS "reenrolment_period_type_check";
ALTER TABLE "reenrolment_period" ADD CONSTRAINT "reenrolment_period_type_check" CHECK ("period_type_code" IN ('annual', 'initial'));

ALTER TABLE "reenrolment_confirmation" ADD COLUMN IF NOT EXISTS "confirmed_by" text;
ALTER TABLE "reenrolment_confirmation" ADD COLUMN IF NOT EXISTS "channel_code" text;
ALTER TABLE "reenrolment_confirmation" ADD COLUMN IF NOT EXISTS "terms_version" text;
ALTER TABLE "reenrolment_confirmation" ADD COLUMN IF NOT EXISTS "assisted_reason_code" text;
ALTER TABLE "reenrolment_confirmation" DROP CONSTRAINT IF EXISTS "reenrolment_confirmation_channel_check";
ALTER TABLE "reenrolment_confirmation" ADD CONSTRAINT "reenrolment_confirmation_channel_check"
  CHECK ("channel_code" IS NULL OR "channel_code" IN ('portal', 'assisted'));
ALTER TABLE "reenrolment_confirmation" DROP CONSTRAINT IF EXISTS "reenrolment_confirmation_assisted_reason_check";
ALTER TABLE "reenrolment_confirmation" ADD CONSTRAINT "reenrolment_confirmation_assisted_reason_check"
  CHECK (("channel_code" = 'assisted') = ("assisted_reason_code" IS NOT NULL) OR "channel_code" IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS "reenrolment_confirmation_one_per_period"
  ON "reenrolment_confirmation" ("tenant_id", "enrolment_id", "reenrolment_period_id") WHERE "recorded_until" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "fee_liability_one_per_year"
  ON "fee_liability" ("tenant_id", "enrolment_id", "academic_year");

-- ── D-11 Curriculum binding change reason ───────────────────────────────────

ALTER TABLE "enrolment_curriculum_binding" ADD COLUMN IF NOT EXISTS "change_reason_code" text;

-- A change that something already depends on (module registrations, a
-- selection proposal or marks in the current year) is proposed by one
-- person and decided by a programme approver, never the proposer.
CREATE TABLE IF NOT EXISTS "curriculum_binding_change" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL REFERENCES "tenant" ("id"),
  "enrolment_id"          uuid        NOT NULL,
  "programme_route_id"    uuid,
  "programme_rule_set_id" uuid        NOT NULL,
  "change_reason_code"    text        NOT NULL,   -- value set curriculum-binding-change-reason-code
  "reason"                text        NOT NULL,
  "effective_date"        date        NOT NULL,
  "status_code"           text        NOT NULL DEFAULT 'proposed',
  "proposed_by"           text        NOT NULL,
  "proposed_at"           timestamptz NOT NULL DEFAULT now(),
  "decided_by"            text,
  "decided_at"            timestamptz,
  "decision_reason"       text,
  CONSTRAINT "curriculum_binding_change_status_check" CHECK ("status_code" IN ('proposed', 'approved', 'rejected', 'applied-directly'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "curriculum_binding_change_one_open"
  ON "curriculum_binding_change" ("tenant_id", "enrolment_id") WHERE "status_code" = 'proposed';
ALTER TABLE "curriculum_binding_change" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "curriculum_binding_change" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "curriculum_binding_change";
CREATE POLICY tenant_isolation ON "curriculum_binding_change" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── D-12 No duplicate live plan of a type per decision and module ───────────
-- A decision can hold several plans for one module (a deferral, a referral,
-- then an additional attempt), but never two live plans of the same type:
-- repeating ratification cannot duplicate the plans it created.

CREATE UNIQUE INDEX IF NOT EXISTS "reassessment_plan_one_live_per_type"
  ON "reassessment_plan" ("progression_decision_id", COALESCE("module_registration_id", '00000000-0000-0000-0000-000000000000'::uuid), "plan_type_code")
  WHERE "status_code" <> 'cancelled';

-- ── D-13 Verbal Clearing offers ─────────────────────────────────────────────

ALTER TABLE "admissions_offer" DROP CONSTRAINT IF EXISTS "admissions_offer_type_check";
ALTER TABLE "admissions_offer" ADD CONSTRAINT "admissions_offer_type_check"
  CHECK ("offer_type_code" IN ('conditional', 'unconditional', 'clearing-verbal'));

-- ── Value sets ──────────────────────────────────────────────────────────────

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('registration-assisted-reason-code', 'Assisted Registration Reason', 'srs-internal', NULL, 'Why the registry confirmed a registration on a student''s behalf', true),
  ('curriculum-binding-change-reason-code', 'Curriculum Binding Change Reason', 'srs-internal', NULL, 'Why one student''s route or rule set was changed', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z'
FROM "value_set" vs,
(VALUES
  ('enrolment-status-code', 'pre-registration', 'Pre-registration', 5),
  ('registration-assisted-reason-code', 'in-person',         'In person',                  10),
  ('registration-assisted-reason-code', 'phone',             'By phone',                   20),
  ('registration-assisted-reason-code', 'accessibility',     'Accessibility need',         30),
  ('registration-assisted-reason-code', 'provider-failure',  'Online registration failed', 40),
  ('registration-assisted-reason-code', 'late',              'Late registration',          50),
  ('curriculum-binding-change-reason-code', 'pathway-change',            'Pathway change',            10),
  ('curriculum-binding-change-reason-code', 'rule-set-correction',       'Rule set correction',       20),
  ('curriculum-binding-change-reason-code', 'recognised-prior-learning', 'Recognised prior learning', 30),
  ('curriculum-binding-change-reason-code', 'error',                     'Recorded in error',         40),
  ('student-status-reason-code', 'non-registration', 'Did not register', 130)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('reenrolment_confirmation', 'assisted_reason_code', 'registration-assisted-reason-code', NULL),
  ('enrolment_curriculum_binding', 'change_reason_code', 'curriculum-binding-change-reason-code', NULL)
ON CONFLICT DO NOTHING;

-- ── Failure to register (BP-02-011; D-9) ────────────────────────────────────
-- A lapsed registration opens a business case (process BP-02-011); contact
-- attempts are case evidence and the outcome is a case decision, so no new
-- table is needed. Only the picklists are new.

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('registration-contact-channel-code', 'Registration Contact Channel', 'srs-internal', NULL, 'How the registry contacted a student who did not register', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z'
FROM "value_set" vs,
(VALUES
  ('registration-contact-channel-code', 'portal',    'Portal notification', 10),
  ('registration-contact-channel-code', 'email',     'Email',               20),
  ('registration-contact-channel-code', 'phone',     'Phone call',          30),
  ('registration-contact-channel-code', 'letter',    'Letter',              40),
  ('registration-contact-channel-code', 'in-person', 'In person',           50),
  ('ukvi-alert-type-code', 'non-enrolment', 'Sponsored student did not register', 40)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('non_registration_case', 'contact_channel_code', 'registration-contact-channel-code', 'Business case BP-02-011 contact attempts (stored as case evidence source_system)')
ON CONFLICT DO NOTHING;
