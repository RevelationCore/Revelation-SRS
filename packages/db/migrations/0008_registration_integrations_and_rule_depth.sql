-- 0008 — Rule exceptions, admissions bridge and person indexes; registration
-- and the other Phase 2 processes; Phase 3 integrations and outputs; Phase 4
-- rule depth in module selection and status.
-- Squashed 2026-11-17 from 0008 and 0009.


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

-- Originally 0009_integrations_and_outputs.sql
-- 0009 — Integrations and outputs (Phase 3)
-- (docs/decisions/phase-3-gap-closure-decisions.md, D-14 to D-22)

-- ── D-16: one CAS record ────────────────────────────────────────────────────
-- cas_case becomes the system of record. A CAS is needed before the visa
-- application, so before any enrolment: a case belongs to an application (new
-- entrant) or an enrolment (in-country extension or course change).

ALTER TABLE "cas_case"
  ADD COLUMN IF NOT EXISTS "person_id"        uuid,
  ADD COLUMN IF NOT EXISTS "application_id"   uuid,
  ADD COLUMN IF NOT EXISTS "prepared_payload" jsonb,
  ADD COLUMN IF NOT EXISTS "prepared_by"      text;
ALTER TABLE "cas_case" ALTER COLUMN "enrolment_id" DROP NOT NULL;

UPDATE "cas_case" c SET "person_id" = e."person_id"
FROM "enrolment" e
WHERE e."id" = c."enrolment_id" AND e."tenant_id" = c."tenant_id" AND e."recorded_until" IS NULL AND c."person_id" IS NULL;

-- Carry any CAS request that has no case into cas_case, so no CAS is lost.
INSERT INTO "cas_case" ("version_id", "id", "tenant_id", "enrolment_id", "person_id", "cas_reference", "status_code", "actor_id", "valid_from", "recorded_at")
SELECT gen_random_uuid(), r."id", r."tenant_id", r."enrolment_id", e."person_id", r."cas_reference",
  CASE r."status_code" WHEN 'assigned' THEN 'assigned' WHEN 'used' THEN 'assigned' WHEN 'withdrawn' THEN 'withdrawn' WHEN 'expired' THEN 'withdrawn' ELSE 'opened' END,
  'migration-0009', r."valid_from", r."recorded_at"
FROM "ukvi_cas_request" r
JOIN "enrolment" e ON e."id" = r."enrolment_id" AND e."tenant_id" = r."tenant_id" AND e."recorded_until" IS NULL
WHERE r."recorded_until" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "cas_case" c WHERE c."tenant_id" = r."tenant_id" AND c."enrolment_id" = r."enrolment_id");

DELETE FROM "cas_case" WHERE "person_id" IS NULL;
ALTER TABLE "cas_case" ALTER COLUMN "person_id" SET NOT NULL;
ALTER TABLE "cas_case" DROP CONSTRAINT IF EXISTS "cas_case_subject_check";
ALTER TABLE "cas_case" ADD CONSTRAINT "cas_case_subject_check" CHECK ("application_id" IS NOT NULL OR "enrolment_id" IS NOT NULL);
CREATE INDEX IF NOT EXISTS "cas_case_application_idx" ON "cas_case" ("tenant_id", "application_id");
CREATE INDEX IF NOT EXISTS "cas_case_person_idx" ON "cas_case" ("tenant_id", "person_id");
CREATE INDEX IF NOT EXISTS "cas_case_reference_idx" ON "cas_case" ("tenant_id", "cas_reference") WHERE "recorded_until" IS NULL;

ALTER TABLE "ukvi_visa_status" ADD COLUMN IF NOT EXISTS "cas_case_id" uuid;
ALTER TABLE "ukvi_visa_status" ALTER COLUMN "enrolment_id" DROP NOT NULL;
ALTER TABLE "ukvi_compliance_alert" ADD COLUMN IF NOT EXISTS "cas_case_id" uuid;

DELETE FROM "field_value_set" WHERE "entity_name" = 'ukvi_cas_request';
DROP TABLE IF EXISTS "ukvi_cas_request";

-- The CAS case lifecycle (migration 0004) gains the preparation, approval and SMS steps.
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('cas-case-status-code', 'prepared',  'Prepared for approval', 22),
  ('cas-case-status-code', 'approved',  'Approved',              24),
  ('cas-case-status-code', 'requested', 'Sent to SMS',           26)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

-- ── D-17: right to study as its own outcome ─────────────────────────────────
-- Who checked, on what basis, by which method, and when permission expires:
-- separate from identity verification (D-6). Bitemporal: a specialist
-- decision or a recheck is a new version of the same check.

CREATE TABLE IF NOT EXISTS "right_to_study_check" (
  "version_id"                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                             uuid        NOT NULL,
  "tenant_id"                      uuid        NOT NULL REFERENCES "tenant"("id"),
  "person_id"                      uuid        NOT NULL,
  "enrolment_id"                   uuid,
  "cas_case_id"                    uuid,
  "basis_code"                     text,
  "method_code"                    text,
  "outcome_code"                   text        NOT NULL,
  "checked_by"                     text        NOT NULL,
  "checked_at"                     timestamptz NOT NULL DEFAULT now(),
  "permission_expires_on"          date,
  "uk_entry_date"                  date,
  "restriction_code"               text,
  "evidence_ref"                   text,
  "identity_verification_check_id" uuid,
  "recheck_due_on"                 date,
  "share_code"                     text,
  "note"                           text,
  "expiry_warning_sent_at"         timestamptz,
  "valid_from"                     timestamptz NOT NULL,
  "valid_to"                       timestamptz,
  "recorded_at"                    timestamptz NOT NULL DEFAULT now(),
  "recorded_until"                 timestamptz,
  CONSTRAINT "right_to_study_check_temporal_check_valid" CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "right_to_study_check_temporal_check_recorded" CHECK (recorded_until IS NULL OR recorded_until > recorded_at),
  CONSTRAINT "right_to_study_check_outcome_check" CHECK ("outcome_code" IN ('pending', 'eligible', 'not-eligible', 'referred', 'recheck-required')),
  CONSTRAINT "right_to_study_check_decided_check" CHECK ("outcome_code" IN ('pending', 'referred') OR ("basis_code" IS NOT NULL AND "method_code" IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS "right_to_study_check_unique_logical_transaction" ON "right_to_study_check" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "right_to_study_check_current_version_unique" ON "right_to_study_check" ("tenant_id", "id") WHERE "recorded_until" IS NULL;
CREATE INDEX IF NOT EXISTS "right_to_study_check_person_idx" ON "right_to_study_check" ("tenant_id", "person_id");
CREATE INDEX IF NOT EXISTS "right_to_study_check_expiry_idx" ON "right_to_study_check" ("tenant_id", "permission_expires_on") WHERE "recorded_until" IS NULL;
ALTER TABLE "right_to_study_check" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "right_to_study_check" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "right_to_study_check";
CREATE POLICY tenant_isolation ON "right_to_study_check"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

-- ── D-18: financial registration ────────────────────────────────────────────
-- The SRS owns fee status (a provider determination); Finance owns amounts,
-- payments and debt. Financial registration is a state on each year's fee
-- liability, separate from academic registration.

ALTER TABLE "enrolment" ADD COLUMN IF NOT EXISTS "fee_status_code" text;

ALTER TABLE "fee_liability"
  ADD COLUMN IF NOT EXISTS "fee_status_code"        text,
  ADD COLUMN IF NOT EXISTS "financial_status_code"  text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "payer_arrangement_code" text,
  ADD COLUMN IF NOT EXISTS "finance_reference"      text,
  ADD COLUMN IF NOT EXISTS "hold_reason_code"       text,
  ADD COLUMN IF NOT EXISTS "status_source_code"     text,
  ADD COLUMN IF NOT EXISTS "status_updated_by"      text,
  ADD COLUMN IF NOT EXISTS "status_updated_at"      timestamptz;
ALTER TABLE "fee_liability" DROP CONSTRAINT IF EXISTS "fee_liability_financial_status_check";
ALTER TABLE "fee_liability" ADD CONSTRAINT "fee_liability_financial_status_check"
  CHECK ("financial_status_code" IN ('pending', 'arranged', 'hold', 'not-required'));
ALTER TABLE "fee_liability" DROP CONSTRAINT IF EXISTS "fee_liability_hold_reason_check";
ALTER TABLE "fee_liability" ADD CONSTRAINT "fee_liability_hold_reason_check"
  CHECK (("financial_status_code" = 'hold') = ("hold_reason_code" IS NOT NULL));

-- ── D-17 and D-18 picklists ─────────────────────────────────────────────────

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('right-to-study-basis-code',         'Right to Study Basis',          'srs-internal', NULL, 'Why a person may study in the UK', true),
  ('right-to-study-method-code',        'Right to Study Check Method',   'srs-internal', NULL, 'How the right to study was checked', true),
  ('right-to-study-restriction-code',   'Right to Study Restriction',    'srs-internal', NULL, 'A condition on the permission that affects study', true),
  ('fee-status-code',                   'Fee Status',                    'srs-internal', NULL, 'The provider''s fee status determination', true),
  ('payer-arrangement-code',            'Payer Arrangement',             'srs-internal', NULL, 'Who is paying the year''s tuition', true),
  ('financial-hold-reason-code',        'Financial Hold Reason',         'srs-internal', NULL, 'Why a year''s financial registration is on hold; source_metadata.tuition marks a tuition-fee hold', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z', v.meta::jsonb
FROM "value_set" vs,
(VALUES
  ('right-to-study-basis-code', 'british-irish',        'British or Irish citizen',                10, NULL),
  ('right-to-study-basis-code', 'euss-settled',         'EU Settlement Scheme: settled',           20, NULL),
  ('right-to-study-basis-code', 'euss-pre-settled',     'EU Settlement Scheme: pre-settled',       30, NULL),
  ('right-to-study-basis-code', 'student-route',        'Sponsored on the Student route',          40, NULL),
  ('right-to-study-basis-code', 'other-permission',     'Other permission that allows study',      50, NULL),
  ('right-to-study-basis-code', 'indefinite-leave',     'Indefinite leave to remain',              60, NULL),
  ('right-to-study-method-code', 'view-and-prove',      'Online (View and Prove share code)',      10, NULL),
  ('right-to-study-method-code', 'document-in-person',  'Document seen in person',                 20, NULL),
  ('right-to-study-method-code', 'document-remote',     'Document seen by remote video',           30, NULL),
  ('right-to-study-method-code', 'identity-passport',   'Passport from the identity check',        40, NULL),
  ('right-to-study-restriction-code', 'study-restricted', 'Study condition on the permission',     10, NULL),
  ('right-to-study-restriction-code', 'atas-required',  'ATAS certificate required',               20, NULL),
  ('fee-status-code', 'home',                           'Home',                                    10, NULL),
  ('fee-status-code', 'overseas',                       'Overseas',                                20, NULL),
  ('fee-status-code', 'islands',                        'Channel Islands and Isle of Man',         30, NULL),
  ('fee-status-code', 'not-assessed',                   'Not yet assessed',                        90, NULL),
  ('payer-arrangement-code', 'self-pay',                'Self-pay',                                10, NULL),
  ('payer-arrangement-code', 'slc-tuition-loan',        'Student Loans Company tuition fee loan',  20, NULL),
  ('payer-arrangement-code', 'sponsor',                 'Sponsor',                                 30, NULL),
  ('payer-arrangement-code', 'scholarship',             'Scholarship',                             40, NULL),
  ('payer-arrangement-code', 'mixed',                   'More than one payer',                     50, NULL),
  ('financial-hold-reason-code', 'tuition-unpaid',      'Tuition fees unpaid',                     10, '{"tuition": true}'),
  ('financial-hold-reason-code', 'sponsor-not-confirmed', 'Sponsor has not confirmed payment',     20, '{"tuition": true}'),
  ('financial-hold-reason-code', 'accommodation-debt',  'Accommodation or other non-tuition debt', 30, '{"tuition": false}'),
  ('ukvi-alert-type-code', 'permission-expired',        'Permission to stay has expired',          50, NULL)
) AS v(set_code, code, display_label, sort_order, meta)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('right_to_study_check', 'basis_code',          'right-to-study-basis-code',       NULL),
  ('right_to_study_check', 'method_code',         'right-to-study-method-code',      NULL),
  ('right_to_study_check', 'restriction_code',    'right-to-study-restriction-code', NULL),
  ('admissions_offer',     'fee_status_basis_code','fee-status-code',                NULL),
  ('enrolment',            'fee_status_code',     'fee-status-code',                 NULL),
  ('fee_liability',        'payer_arrangement_code','payer-arrangement-code',        NULL),
  ('fee_liability',        'hold_reason_code',    'financial-hold-reason-code',      NULL)
ON CONFLICT DO NOTHING;

-- ── D-22: curriculum publication beyond programmes and modules ──────────────
ALTER TABLE "curriculum_publication_item" DROP CONSTRAINT IF EXISTS "curriculum_publication_item_type_check";
ALTER TABLE "curriculum_publication_item" ADD CONSTRAINT "curriculum_publication_item_type_check"
  CHECK ("object_type_code" IN ('programme', 'module', 'route', 'rule-set', 'module-group', 'module-group-member', 'learning-outcome', 'module-offering'));

-- ── D-20: rendering and signing award documents ─────────────────────────────
ALTER TABLE "document_issue"
  ADD COLUMN IF NOT EXISTS "rendered_document_id" uuid,
  ADD COLUMN IF NOT EXISTS "template_code"        text,
  ADD COLUMN IF NOT EXISTS "template_version"     text,
  ADD COLUMN IF NOT EXISTS "pdf_sha256"           text,
  ADD COLUMN IF NOT EXISTS "signing_key_id"       text,
  ADD COLUMN IF NOT EXISTS "signature_jws"        text;
CREATE UNIQUE INDEX IF NOT EXISTS "document_issue_pdf_sha256_unique" ON "document_issue" ("tenant_id", "pdf_sha256") WHERE "pdf_sha256" IS NOT NULL;

-- The institution's public signing keys, published at its JWKS endpoint; retired keys stay published.
CREATE TABLE IF NOT EXISTS "document_signing_key" (
  "id"             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      uuid        NOT NULL REFERENCES "tenant"("id"),
  "key_id"         text        NOT NULL,
  "algorithm"      text        NOT NULL DEFAULT 'ES256',
  "public_key_pem" text        NOT NULL,
  "provider_code"  text        NOT NULL,
  "status_code"    text        NOT NULL DEFAULT 'active',
  "registered_by"  text        NOT NULL,
  "registered_at"  timestamptz NOT NULL DEFAULT now(),
  "retired_at"     timestamptz,
  "compromised_at" timestamptz,
  CONSTRAINT "document_signing_key_status_check" CHECK ("status_code" IN ('active', 'retired', 'compromised')),
  CONSTRAINT "document_signing_key_provider_check" CHECK ("provider_code" IN ('local-key', 'openbao-transit'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "document_signing_key_unique" ON "document_signing_key" ("tenant_id", "key_id");
ALTER TABLE "document_signing_key" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_signing_key" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "document_signing_key";
CREATE POLICY tenant_isolation ON "document_signing_key"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

-- ── D-21: verification without an account ───────────────────────────────────
-- Public checks are logged with a salted hash of the IP, never the IP; a staff
-- lookup by name and date of birth records the holder's consent.
ALTER TABLE "document_verification"
  ADD COLUMN IF NOT EXISTS "requester_ip_hash"    text,
  ADD COLUMN IF NOT EXISTS "consent_evidence_ref" text,
  ADD COLUMN IF NOT EXISTS "method_code"          text NOT NULL DEFAULT 'code';
ALTER TABLE "document_verification" DROP CONSTRAINT IF EXISTS "document_verification_method_check";
ALTER TABLE "document_verification" ADD CONSTRAINT "document_verification_method_check" CHECK ("method_code" IN ('code', 'file', 'staff-lookup'));

-- ── D-14, D-15: UCAS outbound decisions and results mapped to conditions ────
-- Outbound items are integration_exchange rows queued with the decision (an
-- outbox); a later decision supersedes a queued one; an inbound UCAS status
-- that agrees reconciles a sent one.
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('integration-exchange-status', 'queued',     'Queued',     5),
  ('integration-exchange-status', 'superseded', 'Superseded', 70),
  ('integration-exchange-status', 'reconciled', 'Reconciled', 80),
  ('integration-exchange-status', 'mismatch',   'Mismatch',   90)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

-- Structured criteria a result can be matched to; free-text conditions are only ever suggested for review.
ALTER TABLE "offer_condition" ADD COLUMN IF NOT EXISTS "match_criteria" jsonb;
ALTER TABLE "condition_evidence"
  ADD COLUMN IF NOT EXISTS "match_outcome_code" text,
  ADD COLUMN IF NOT EXISTS "embargoed_until"    date;
ALTER TABLE "condition_evidence" DROP CONSTRAINT IF EXISTS "condition_evidence_match_outcome_check";
ALTER TABLE "condition_evidence" ADD CONSTRAINT "condition_evidence_match_outcome_check"
  CHECK ("match_outcome_code" IS NULL OR "match_outcome_code" IN ('meets', 'below', 'needs-review'));

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('ucas-decision-crosswalk', 'UCAS Decision Crosswalk', 'srs-internal', NULL,
   'SRS outcomes sent to UCAS: source_metadata.ucasCode is the UCAS decision code, source_metadata.reconcilesWith the inbound statuses that confirm it; confirm per cycle', true),
  ('qualification-type-code', 'Qualification Type', 'srs-internal', NULL, 'Qualification a result is for', true),
  ('grade-scale-a-level', 'A level grades', 'srs-internal', NULL, 'Ordered from highest (lowest sort order) to lowest', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z', v.meta::jsonb
FROM "value_set" vs,
(VALUES
  ('ucas-decision-crosswalk', 'offer-conditional',     'Conditional offer',             10, '{"ucasCode": "C", "reconcilesWith": ["offer-made", "offer-accepted"]}'),
  ('ucas-decision-crosswalk', 'offer-unconditional',   'Unconditional offer',           20, '{"ucasCode": "U", "reconcilesWith": ["offer-made", "offer-accepted"]}'),
  ('ucas-decision-crosswalk', 'reject',                'Unsuccessful application',      30, '{"ucasCode": "R", "reconcilesWith": ["withdrawn"]}'),
  ('ucas-decision-crosswalk', 'withdraw',              'Offer withdrawn',               40, '{"ucasCode": "W", "reconcilesWith": ["withdrawn"]}'),
  ('ucas-decision-crosswalk', 'confirmed',             'Confirmed',                     50, '{"ucasCode": "UF", "reconcilesWith": ["confirmed"]}'),
  ('ucas-decision-crosswalk', 'confirmed-alternative', 'Confirmed on another course',   60, '{"ucasCode": "CC", "reconcilesWith": ["confirmed"]}'),
  ('ucas-decision-crosswalk', 'unsuccessful',          'Unsuccessful at confirmation',  70, '{"ucasCode": "R", "reconcilesWith": ["withdrawn"]}'),
  ('qualification-type-code', 'a-level',               'A level',                       10, NULL),
  ('qualification-type-code', 'btec-extended-diploma', 'BTEC Extended Diploma',         20, NULL),
  ('qualification-type-code', 'ib-diploma',            'International Baccalaureate',   30, NULL),
  ('grade-scale-a-level', 'A*', 'A*', 10, NULL),
  ('grade-scale-a-level', 'A',  'A',  20, NULL),
  ('grade-scale-a-level', 'B',  'B',  30, NULL),
  ('grade-scale-a-level', 'C',  'C',  40, NULL),
  ('grade-scale-a-level', 'D',  'D',  50, NULL),
  ('grade-scale-a-level', 'E',  'E',  60, NULL),
  ('grade-scale-a-level', 'U',  'U',  70, NULL)
) AS v(set_code, code, display_label, sort_order, meta)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "integration_contract" ("contract_id", "display_name", "owner_module_code", "direction_code", "pattern_type", "current_contract_version", "data_classification_code")
VALUES ('ucas-results-inbound.v1', 'UCAS Results (Awarding Body Linkage)', 'regulatory', 'inbound', 'file-and-api', '1.0.0', 'personal')
ON CONFLICT ("contract_id") DO NOTHING;

-- Originally 0009_rule_depth.sql

-- 0009 — Rule depth in module selection and status (Phase 4)
-- (docs/decisions/phase-4-gap-closure-decisions.md, D-23 to D-34)

-- ── D-23: the rule-type picklist matches the rule types the engine defines ──
UPDATE "value_set_member" SET "active_to" = '2026-11-17T00:00:00Z'
WHERE "value_set_id" = (SELECT "id" FROM "value_set" WHERE "set_code" = 'academic-rule-type-code')
  AND "code" IN ('progression', 'classification', 'assessment', 'credit-transfer', 'resit-eligibility', 'award-eligibility')
  AND "active_to" IS NULL;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z', jsonb_build_object('domain', v.domain)
FROM "value_set" vs,
(VALUES
  ('max-credits-per-period',         'Maximum credits per period',        110, 'selection'),
  ('credit-load-requirement',        'Credit load requirement',           120, 'selection'),
  ('level-credit-requirement',       'Credits at the current level',      130, 'selection'),
  ('adjacent-level-credit-limit',    'Credits at an adjacent level',      140, 'selection'),
  ('joint-honours-balance',          'Joint honours balance',             150, 'selection'),
  ('repeat-module-requirement',      'Repeat module requirement',         160, 'selection'),
  ('timetable-clash-policy',         'Timetable clash policy',            170, 'selection'),
  ('pass-mark',                      'Pass mark',                         210, 'assessment'),
  ('late-penalty-rate',              'Late submission penalty rate',      220, 'assessment'),
  ('late-penalty-cap',               'Late submission penalty cap',       230, 'assessment'),
  ('resit-mark-cap',                 'Resit mark cap',                    240, 'assessment'),
  ('compensation-threshold',         'Compensation threshold',            310, 'progression'),
  ('compensation-credit-limit',      'Compensation credit limit',         320, 'progression'),
  ('condonement-threshold',          'Condonement threshold',             330, 'progression'),
  ('progression-credit-requirement', 'Progression credit requirement',    340, 'progression'),
  ('progression-pass-requirement',   'Progression pass requirement',      350, 'progression'),
  ('classification-boundary',        'Classification boundary',           410, 'award'),
  ('classification-algorithm',       'Classification algorithm',          420, 'award'),
  ('classification-discretion-zone', 'Classification discretion zone',    430, 'award'),
  ('award-credit-requirement',       'Award credit requirement',          440, 'award'),
  ('ukvi-attendance-threshold',      'UKVI attendance threshold',         510, 'regulatory')
) AS v(code, display_label, sort_order, domain)
WHERE vs."set_code" = 'academic-rule-type-code'
ON CONFLICT DO NOTHING;

-- ── D-29: selection windows ─────────────────────────────────────────────────
ALTER TABLE IF EXISTS "registration_window" RENAME TO "module_selection_window";
ALTER TABLE "module_selection_window" DROP CONSTRAINT IF EXISTS "registration_window_tenant_period_unique";
ALTER TABLE "module_selection_window" RENAME CONSTRAINT "registration_window_closes_after_opens" TO "module_selection_window_closes_after_opens";
ALTER INDEX IF EXISTS "registration_window_tenant_period_idx" RENAME TO "module_selection_window_tenant_period_idx";
ALTER TABLE "module_selection_window"
  ADD COLUMN IF NOT EXISTS "programme_id"           uuid,
  ADD COLUMN IF NOT EXISTS "fheq_level"             smallint,
  ADD COLUMN IF NOT EXISTS "resubmission_closes_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "allocation_mode_code"   text NOT NULL DEFAULT 'first-come',
  ADD COLUMN IF NOT EXISTS "allocation_seed"        bytea,
  ADD COLUMN IF NOT EXISTS "created_by"             text,
  ADD COLUMN IF NOT EXISTS "created_at"             timestamptz NOT NULL DEFAULT now();
ALTER TABLE "module_selection_window" ALTER COLUMN "allocation_mode_code" SET DEFAULT 'ranked';
ALTER TABLE "module_selection_window" DROP CONSTRAINT IF EXISTS "module_selection_window_allocation_mode_check";
ALTER TABLE "module_selection_window" ADD CONSTRAINT "module_selection_window_allocation_mode_check"
  CHECK ("allocation_mode_code" IN ('first-come', 'ranked'));
ALTER TABLE "module_selection_window" DROP CONSTRAINT IF EXISTS "module_selection_window_resubmission_check";
ALTER TABLE "module_selection_window" ADD CONSTRAINT "module_selection_window_resubmission_check"
  CHECK ("resubmission_closes_at" IS NULL OR "resubmission_closes_at" >= "closes_at");
-- One window per scope; overlap between windows of the same scope is refused by the service.
CREATE INDEX IF NOT EXISTS "module_selection_window_scope_idx"
  ON "module_selection_window" ("tenant_id", "academic_period_id", "programme_id", "fheq_level");
DROP POLICY IF EXISTS tenant_isolation ON "module_selection_window";
CREATE POLICY tenant_isolation ON "module_selection_window"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

-- registrationWindowMode becomes moduleSelection.windowEnforcement.
UPDATE "tenant" SET "configuration" = jsonb_set(
  COALESCE("configuration", '{}'::jsonb) - 'registrationWindowMode', '{moduleSelection}',
  COALESCE("configuration"->'moduleSelection', '{}'::jsonb) || '{"windowEnforcement": "required"}'::jsonb)
WHERE "configuration"->>'registrationWindowMode' = 'academic-period';

-- ── Proposal statuses, sources, late submission, ranked choices, repeats ────
ALTER TABLE "module_selection_proposal" DROP CONSTRAINT IF EXISTS "module_selection_proposal_status_code_check";
ALTER TABLE "module_selection_proposal" ADD CONSTRAINT "module_selection_proposal_status_code_check"
  CHECK ("status_code" IN ('draft','submitted','validated','approved','returned','waitlisted','rejected','confirmed','awaiting-allocation'));
ALTER TABLE "module_selection_proposal" DROP CONSTRAINT IF EXISTS "module_selection_proposal_decision_authority_code_check";
ALTER TABLE "module_selection_proposal" ADD CONSTRAINT "module_selection_proposal_decision_authority_code_check"
  CHECK ("decision_authority_code" IS NULL OR "decision_authority_code" IN ('automatic','registry-administrator','programme-approver','allocation'));
ALTER TABLE "module_selection_proposal"
  ADD COLUMN IF NOT EXISTS "late_submission_reason_code" text,
  ADD COLUMN IF NOT EXISTS "late_submission_note"        text,
  ADD COLUMN IF NOT EXISTS "late_submitted_by"           text,
  -- The student's current FHEQ level for the proposal: scopes windows and allocation tiers.
  ADD COLUMN IF NOT EXISTS "fheq_level"                  smallint;

ALTER TABLE "module_selection_proposal_item" DROP CONSTRAINT IF EXISTS "module_selection_proposal_item_source_code_check";
ALTER TABLE "module_selection_proposal_item" ADD CONSTRAINT "module_selection_proposal_item_source_code_check"
  CHECK ("source_code" IN ('compulsory-auto','student-choice','staff-assisted','repeat-required'));
ALTER TABLE "module_selection_proposal_item"
  ADD COLUMN IF NOT EXISTS "choice_slot"          smallint,
  ADD COLUMN IF NOT EXISTS "reassessment_plan_id" uuid,
  ADD COLUMN IF NOT EXISTS "is_replacement"       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "held_until"           timestamptz;
ALTER TABLE "module_selection_proposal_item" DROP CONSTRAINT IF EXISTS "module_selection_proposal_item_replacement_check";
ALTER TABLE "module_selection_proposal_item" ADD CONSTRAINT "module_selection_proposal_item_replacement_check"
  CHECK (NOT "is_replacement" OR "reassessment_plan_id" IS NOT NULL);
DROP POLICY IF EXISTS tenant_isolation ON "module_selection_proposal_item";
CREATE POLICY tenant_isolation ON "module_selection_proposal_item"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

-- ── D-28: the registration a repeat plan produced ───────────────────────────
ALTER TABLE "reassessment_plan" ADD COLUMN IF NOT EXISTS "repeat_module_registration_id" uuid;

-- ── D-27: subject areas ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "module_subject" (
  "version_id"         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                 uuid        NOT NULL,
  "tenant_id"          uuid        NOT NULL REFERENCES "tenant"("id"),
  "module_id"          uuid        NOT NULL,
  "subject_area_code"  text        NOT NULL,
  "proportion_percent" smallint    NOT NULL CHECK ("proportion_percent" BETWEEN 1 AND 100),
  "valid_from"         timestamptz NOT NULL,
  "valid_to"           timestamptz,
  "recorded_at"        timestamptz NOT NULL DEFAULT now(),
  "recorded_until"     timestamptz,
  CONSTRAINT "module_subject_temporal_check_valid" CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "module_subject_temporal_check_recorded" CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS "module_subject_unique_logical_transaction" ON "module_subject" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "module_subject_current_version_unique" ON "module_subject" ("tenant_id", "id") WHERE "recorded_until" IS NULL;
CREATE INDEX IF NOT EXISTS "module_subject_module_idx" ON "module_subject" ("tenant_id", "module_id") WHERE "recorded_until" IS NULL;
ALTER TABLE "module_subject" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "module_subject" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "module_subject";
CREATE POLICY tenant_isolation ON "module_subject"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE "module_group_member" ADD COLUMN IF NOT EXISTS "counts_towards_subject_area_code" text;

-- ── D-24: timetable publications, activities and slots ──────────────────────
CREATE TABLE IF NOT EXISTS "timetable_publication" (
  "id"                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"          uuid        NOT NULL REFERENCES "tenant"("id"),
  "academic_period_id" uuid        NOT NULL REFERENCES "academic_period"("id"),
  "source_system_code" text        NOT NULL CHECK ("source_system_code" IN ('ttb', 'srs-admin', 'simulator')),
  "source_version"     text        NOT NULL,
  "full_period"        boolean     NOT NULL DEFAULT false,
  "status_code"        text        NOT NULL CHECK ("status_code" IN ('applied', 'rejected')),
  "rejection_reasons"  jsonb,
  "payload_hash"       text        NOT NULL,
  "row_count"          integer     NOT NULL DEFAULT 0,
  "received_by"        text        NOT NULL,
  "received_at"        timestamptz NOT NULL DEFAULT now(),
  "applied_at"         timestamptz,
  CONSTRAINT "timetable_publication_source_version_unique" UNIQUE ("tenant_id", "source_system_code", "source_version")
);
CREATE INDEX IF NOT EXISTS "timetable_publication_period_idx" ON "timetable_publication" ("tenant_id", "academic_period_id", "received_at");

CREATE TABLE IF NOT EXISTS "timetable_activity" (
  "id"                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"          uuid        NOT NULL REFERENCES "tenant"("id"),
  "publication_id"     uuid        NOT NULL REFERENCES "timetable_publication"("id"),
  "module_offering_id" uuid        NOT NULL,
  "activity_ref"       text        NOT NULL,
  "activity_type_code" text        NOT NULL,
  "group_set_code"     text,
  "group_code"         text
);
CREATE INDEX IF NOT EXISTS "timetable_activity_offering_idx" ON "timetable_activity" ("tenant_id", "module_offering_id", "publication_id");

CREATE TABLE IF NOT EXISTS "timetable_slot" (
  "id"               uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        uuid     NOT NULL REFERENCES "tenant"("id"),
  "activity_id"      uuid     NOT NULL REFERENCES "timetable_activity"("id"),
  "day_of_week"      smallint NOT NULL CHECK ("day_of_week" BETWEEN 1 AND 7),
  "start_time"       time     NOT NULL,
  "end_time"         time     NOT NULL,
  "week_commencing"  date[]   NOT NULL CHECK (cardinality("week_commencing") > 0),
  "location_ref"     text,
  CONSTRAINT "timetable_slot_time_check" CHECK ("end_time" > "start_time")
);
CREATE INDEX IF NOT EXISTS "timetable_slot_activity_idx" ON "timetable_slot" ("tenant_id", "activity_id");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['timetable_publication', 'timetable_activity', 'timetable_slot'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("tenant_id" = current_setting(''app.current_tenant_id'', true)::uuid) WITH CHECK ("tenant_id" = current_setting(''app.current_tenant_id'', true)::uuid)', t);
  END LOOP;
END $$;

-- ── D-30: allocation runs ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "module_allocation_run" (
  "id"                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"            uuid        NOT NULL REFERENCES "tenant"("id"),
  "window_id"            uuid        NOT NULL REFERENCES "module_selection_window"("id"),
  "kind_code"            text        NOT NULL DEFAULT 'main' CHECK ("kind_code" IN ('main', 'top-up')),
  "status_code"          text        NOT NULL DEFAULT 'previewed'
                           CHECK ("status_code" IN ('previewed', 'submitted', 'approved', 'applied', 'superseded', 'rejected')),
  "algorithm_version"    text        NOT NULL DEFAULT 'rsd-1',
  "priority_order"       jsonb       NOT NULL,
  "inputs_hash"          text        NOT NULL,
  "summary"              jsonb,
  "workflow_instance_id" uuid,
  "created_by"           text        NOT NULL,
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  "submitted_by"         text,
  "approved_by"          text,
  "applied_at"           timestamptz
);
CREATE INDEX IF NOT EXISTS "module_allocation_run_window_idx" ON "module_allocation_run" ("tenant_id", "window_id", "created_at");

CREATE TABLE IF NOT EXISTS "module_allocation_result" (
  "id"                uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid     NOT NULL REFERENCES "tenant"("id"),
  "run_id"            uuid     NOT NULL REFERENCES "module_allocation_run"("id"),
  "proposal_id"       uuid     NOT NULL,
  "choice_slot"       smallint,
  "allocated_item_id" uuid,
  "outcome_code"      text     NOT NULL CHECK ("outcome_code" IN ('allocated', 'unallocated', 'fixed')),
  "order_position"    integer  NOT NULL,
  "tier"              integer  NOT NULL DEFAULT 0,
  "reason"            text
);
CREATE INDEX IF NOT EXISTS "module_allocation_result_run_idx" ON "module_allocation_result" ("tenant_id", "run_id");
CREATE INDEX IF NOT EXISTS "module_allocation_result_proposal_idx" ON "module_allocation_result" ("tenant_id", "proposal_id");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['module_allocation_run', 'module_allocation_result'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("tenant_id" = current_setting(''app.current_tenant_id'', true)::uuid) WITH CHECK ("tenant_id" = current_setting(''app.current_tenant_id'', true)::uuid)', t);
  END LOOP;
END $$;

-- ── D-31: study intensity ───────────────────────────────────────────────────
ALTER TABLE "enrolment" ADD COLUMN IF NOT EXISTS "study_intensity_percent" smallint;
ALTER TABLE "enrolment" DROP CONSTRAINT IF EXISTS "enrolment_study_intensity_check";
ALTER TABLE "enrolment" ADD CONSTRAINT "enrolment_study_intensity_check"
  CHECK ("study_intensity_percent" IS NULL OR "study_intensity_percent" BETWEEN 1 AND 100);
ALTER TABLE "student_status_case" ADD COLUMN IF NOT EXISTS "destination_study_intensity_percent" smallint;
ALTER TABLE "student_status_case" DROP CONSTRAINT IF EXISTS "student_status_case_intensity_check";
ALTER TABLE "student_status_case" ADD CONSTRAINT "student_status_case_intensity_check"
  CHECK ("destination_study_intensity_percent" IS NULL OR "destination_study_intensity_percent" BETWEEN 1 AND 100);

-- ── D-32: where transferred credit came from ────────────────────────────────
ALTER TABLE "recognised_credit" ADD COLUMN IF NOT EXISTS "source_module_result_id" uuid;

-- ── Picklists ───────────────────────────────────────────────────────────────
INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('timetable-activity-type-code', 'Timetable Activity Type', 'srs-internal', NULL, 'Kind of timetabled teaching activity', true),
  ('subject-area-code',            'Subject Area',            'srs-internal', NULL, 'Institution-defined subject areas for joint-honours balance; each tenant adds its own', true),
  ('late-selection-reason-code',   'Late Selection Reason',   'srs-internal', NULL, 'Why staff submitted a module selection outside its window', true),
  ('module-selection-window-allocation-mode-code', 'Selection Window Allocation', 'srs-internal', NULL, 'How oversubscribed offerings are allocated in a selection window', false),
  ('proposal-item-source-code',    'Selection Item Source',   'srs-internal', NULL, 'How a module came to be in a selection proposal', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z', NULL
FROM "value_set" vs,
(VALUES
  ('timetable-activity-type-code', 'lecture',             'Lecture',                       10),
  ('timetable-activity-type-code', 'seminar',             'Seminar',                       20),
  ('timetable-activity-type-code', 'tutorial',            'Tutorial',                      30),
  ('timetable-activity-type-code', 'practical',           'Practical',                     40),
  ('timetable-activity-type-code', 'laboratory',          'Laboratory',                    50),
  ('timetable-activity-type-code', 'workshop',            'Workshop',                      60),
  ('timetable-activity-type-code', 'fieldwork',           'Fieldwork',                     70),
  ('timetable-activity-type-code', 'assessment',          'Timetabled assessment',         80),
  ('timetable-activity-type-code', 'online-synchronous',  'Online, live',                  90),
  ('timetable-activity-type-code', 'online-asynchronous', 'Online, self-paced',           100),
  ('timetable-activity-type-code', 'drop-in',             'Drop-in',                      110),
  ('late-selection-reason-code', 'late-enrolment',            'Late enrolment',                 10),
  ('late-selection-reason-code', 'transfer',                  'Transfer of programme or mode',  20),
  ('late-selection-reason-code', 'return-from-interruption',  'Return from interruption',       30),
  ('late-selection-reason-code', 'extenuating-circumstances', 'Extenuating circumstances',      40),
  ('late-selection-reason-code', 'administrative-error',      'Administrative error',           50),
  ('late-selection-reason-code', 'other',                     'Other',                          90),
  ('module-selection-window-allocation-mode-code', 'ranked',     'Ranked preferences, allocated after the window', 10),
  ('module-selection-window-allocation-mode-code', 'first-come', 'First come, first served',                       20),
  ('proposal-item-source-code', 'compulsory-auto', 'Compulsory (added automatically)', 10),
  ('proposal-item-source-code', 'student-choice',  'Student choice',                   20),
  ('proposal-item-source-code', 'staff-assisted',  'Added by staff',                   30),
  ('proposal-item-source-code', 'repeat-required', 'Repeat required by the board',     40)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('timetable_activity',             'activity_type_code',               'timetable-activity-type-code', NULL),
  ('module_subject',                 'subject_area_code',                'subject-area-code',            NULL),
  ('module_group_member',            'counts_towards_subject_area_code', 'subject-area-code',            NULL),
  ('module_selection_proposal',      'late_submission_reason_code',      'late-selection-reason-code',   NULL),
  ('module_selection_window',        'allocation_mode_code',             'module-selection-window-allocation-mode-code', NULL),
  ('module_selection_proposal_item', 'source_code',                      'proposal-item-source-code',    NULL)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Allocation run approval (D-30): the runner submits a run for review, and a
-- different holder of module-selection:decide approves (and so applies) or
-- rejects it, through the governed review family, on Temporal when the
-- tenant's rollout selects it.

INSERT INTO "workflow_definition" (
  "definition_code", "display_name", "owner_module_code", "status_code", "current_version_number", "description", "created_by"
) VALUES (
  'module-allocation-run',
  'Module allocation run approval',
  'registration',
  'active',
  1,
  'A ranked allocation run submitted for approval. A person other than its runner and submitter approves it, which applies it while its inputs are unchanged, or rejects it.',
  'system'
)
ON CONFLICT DO NOTHING;

INSERT INTO "workflow_definition_version" (
  "workflow_definition_id", "version_number", "status_code", "definition_json", "effective_from", "created_by"
)
SELECT
  wd."id", 1, 'active',
  jsonb_build_object(
    'source', 'docs/decisions/phase-4-gap-closure-decisions.md',
    'decisionStepKey', 'approve-or-reject-allocation',
    'decisionGatewayAuditTable', 'workflow_decision_audit'
  ),
  '2026-11-17T00:00:00Z'::timestamptz, 'system'
FROM "workflow_definition" wd
WHERE wd."definition_code" = 'module-allocation-run'
ON CONFLICT ("workflow_definition_id", "version_number") DO NOTHING;

INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('run-submitted',                'start',      'Allocation run submitted',          null,                 10, '{}'),
  ('approve-or-reject-allocation', 'human-task', 'Second-person allocation approval', 'programme-approver', 20, '{"assignmentRulesRequired": true}'),
  ('decision-gateway',             'decision',   'Allocation decision gateway',       'programme-approver', 30, '{"auditTable": "workflow_decision_audit"}'),
  ('run-closed',                   'end',        'Allocation run closed',             null,                 40, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'module-allocation-run'
  AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name", "decision_type_code", "source_reference", "configuration"
)
SELECT
  wdv."id", 'G01', 'Approve or reject the allocation run?', 'exclusive', 'phase-4-gap-closure-decisions.md',
  jsonb_build_object('ownerRole', 'Programme approver or registry (not the runner)', 'policySource', 'D-30 allocation governance')
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
WHERE wd."definition_code" = 'module-allocation-run'
  AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;
