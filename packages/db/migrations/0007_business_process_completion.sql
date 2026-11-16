-- ============================================================
-- 0007_business_process_completion
--
-- The business-process aggregates that closed the BPR-D data-model gaps:
-- student status cases (D04), curriculum publication, recognised credit and
-- rule exceptions (D05), reassessment plans and award conferment (D14),
-- award documents and graduation (D15), and applications and offers
-- (D01, D02).
--
-- Squashed on 2026-11-16 from migrations 0007–0011, which follow as
-- sections in their original order and with their original text.
-- scripts/verify-migration-squash.sh checked that the squashed set yields
-- the same schema and seed data.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- Originally 0007_student_status_cases.sql
-- ════════════════════════════════════════════════════════════

-- 0007 — Student status cases (BPR-D04; BP-02-006/007/008/009/012)
--
-- A governed case for each change to a student's study status, rooted on
-- business_case (ADR-023): interruption, institution-required suspension,
-- return from interruption, withdrawal, transfer of programme or mode, and
-- leaver-record closure. The case holds the request, reviewers'
-- assessments, conditions and the authorised decision. Approval applies the
-- change to the enrolment (a bitemporal version plus an
-- enrolment_status_transition, which the case then references), so the
-- enrolment never changes status without an authorised case behind it.
--
-- Evidence stays with its owner (BR-4): the case holds reason categories and
-- opaque references, never the sensitive detail.

CREATE TABLE IF NOT EXISTS "student_status_case" (
  "id"                         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                  uuid        NOT NULL REFERENCES "tenant" ("id"),
  "business_case_id"           uuid        NOT NULL,
  "enrolment_id"               uuid        NOT NULL,
  "person_id"                  uuid        NOT NULL,
  "case_type_code"             text        NOT NULL,   -- value set student-status-case-type-code
  "initiated_by_code"          text        NOT NULL,   -- value set status-case-initiator-code
  "reason_category_code"       text,                   -- value set student-status-reason-code
  "requested_effective_date"   date        NOT NULL,
  "expected_return_date"       date,                   -- interruption/suspension
  "destination_programme_id"   uuid,                   -- transfer
  "destination_mode_of_study_code" text,               -- transfer
  "related_case_id"            uuid,                   -- return: the interruption/suspension it ends
  "institutional_outcome_ref"  text,                   -- A1: opaque link to the authorising process
  -- requested | approved | rejected | withdrawn
  "status_code"                text        NOT NULL DEFAULT 'requested',
  "decided_by"                 text,
  "decided_at"                 timestamptz,
  "decision_reason"            text,
  "approved_effective_date"    date,
  "approved_return_date"       date,
  "enrolment_status_transition_id" uuid,               -- the change the approval made
  "created_by"                 text        NOT NULL,
  "created_at"                 timestamptz NOT NULL DEFAULT now(),
  "updated_at"                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "student_status_case_status_check"
    CHECK ("status_code" IN ('requested', 'approved', 'rejected', 'withdrawn')),
  CONSTRAINT "student_status_case_return_after_effective"
    CHECK ("expected_return_date" IS NULL OR "expected_return_date" > "requested_effective_date")
);
CREATE INDEX IF NOT EXISTS "student_status_case_enrolment_idx" ON "student_status_case" ("tenant_id", "enrolment_id");
-- At most one open status-changing case per enrolment; leaver closure runs alongside.
CREATE UNIQUE INDEX IF NOT EXISTS "student_status_case_one_open"
  ON "student_status_case" ("tenant_id", "enrolment_id")
  WHERE "status_code" = 'requested' AND "case_type_code" <> 'leaver-closure';

-- Reviewers' advice (BP-02-007 steps 3–4, BP-02-006 steps 3–4): append-only.
CREATE TABLE IF NOT EXISTS "status_case_assessment" (
  "id"                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"          uuid        NOT NULL REFERENCES "tenant" ("id"),
  "status_case_id"     uuid        NOT NULL REFERENCES "student_status_case" ("id"),
  "assessor_role_code" text        NOT NULL,   -- value set status-case-assessor-role-code
  "outcome_code"       text        NOT NULL,   -- value set status-case-assessment-outcome-code
  "note"               text,
  "assessed_by"        text        NOT NULL,
  "assessed_at"        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "status_case_assessment_case_idx" ON "status_case_assessment" ("tenant_id", "status_case_id");

-- Conditions imposed by a decision, e.g. return conditions on an interruption.
CREATE TABLE IF NOT EXISTS "status_case_condition" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant" ("id"),
  "status_case_id"      uuid        NOT NULL REFERENCES "student_status_case" ("id"),
  "condition_type_code" text        NOT NULL,   -- value set status-case-condition-type-code
  "description"         text        NOT NULL,
  "due_date"            date,
  -- open | met | waived
  "status_code"         text        NOT NULL DEFAULT 'open',
  "evidence_ref"        text,
  "resolved_by"         text,
  "resolved_at"         timestamptz,
  "resolution_note"     text,
  "created_by"          text        NOT NULL,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "status_case_condition_status_check" CHECK ("status_code" IN ('open', 'met', 'waived'))
);
CREATE INDEX IF NOT EXISTS "status_case_condition_case_idx" ON "status_case_condition" ("tenant_id", "status_case_id");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['student_status_case', 'status_case_assessment', 'status_case_condition'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)', t);
  END LOOP;
END $$;

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('student-status-case-type-code', 'Student Status Case Type', 'srs-internal', NULL, 'Kind of governed change to a student''s study status', false),
  ('status-case-initiator-code', 'Status Case Initiator', 'srs-internal', NULL, 'Who started a status case', false),
  ('student-status-reason-code', 'Student Status Change Reason', 'srs-internal', NULL, 'Reason category for a status change (no sensitive detail)', true),
  ('status-case-assessor-role-code', 'Status Case Assessor Role', 'srs-internal', NULL, 'Reviewer who advised on a status case', true),
  ('status-case-assessment-outcome-code', 'Status Case Assessment Outcome', 'srs-internal', NULL, 'A reviewer''s advice on a status case', false),
  ('status-case-condition-type-code', 'Status Case Condition Type', 'srs-internal', NULL, 'Condition imposed by a status decision', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z'
FROM "value_set" vs,
(VALUES
  ('student-status-case-type-code', 'interruption',   'Interruption of studies',     10),
  ('student-status-case-type-code', 'suspension',     'Required suspension',         20),
  ('student-status-case-type-code', 'return',         'Return from interruption',    30),
  ('student-status-case-type-code', 'withdrawal',     'Withdrawal',                  40),
  ('student-status-case-type-code', 'transfer',       'Transfer of programme or mode', 50),
  ('student-status-case-type-code', 'leaver-closure', 'Leaver record closure',       60),
  ('status-case-initiator-code', 'student',     'Student',     10),
  ('status-case-initiator-code', 'institution', 'Institution', 20),
  ('student-status-reason-code', 'health',          'Health',                 10),
  ('student-status-reason-code', 'personal',        'Personal circumstances', 20),
  ('student-status-reason-code', 'financial',       'Financial',              30),
  ('student-status-reason-code', 'caring',          'Caring responsibilities', 40),
  ('student-status-reason-code', 'employment',      'Employment',             50),
  ('student-status-reason-code', 'academic',        'Academic',               60),
  ('student-status-reason-code', 'fitness-to-study','Fitness to study',       70),
  ('student-status-reason-code', 'conduct',         'Conduct outcome',        80),
  ('student-status-reason-code', 'non-engagement',  'Non-engagement',         90),
  ('student-status-reason-code', 'change-of-course','Change of course',      100),
  ('student-status-reason-code', 'completed',       'Completed studies',     110),
  ('student-status-reason-code', 'other',           'Other',                 120),
  ('status-case-assessor-role-code', 'academic',             'Academic approver',             10),
  ('status-case-assessor-role-code', 'destination-academic', 'Destination academic approver', 20),
  ('status-case-assessor-role-code', 'finance',              'Finance',                       30),
  ('status-case-assessor-role-code', 'compliance',           'UKVI compliance',               40),
  ('status-case-assessment-outcome-code', 'supports',       'Supports',        10),
  ('status-case-assessment-outcome-code', 'concerns',       'Raises concerns', 20),
  ('status-case-assessment-outcome-code', 'not-applicable', 'Not applicable',  30),
  ('status-case-condition-type-code', 'return-evidence',      'Return evidence',      10),
  ('status-case-condition-type-code', 'fitness-to-study',     'Fitness to study',     20),
  ('status-case-condition-type-code', 'fee-clearance',        'Fee clearance',        30),
  ('status-case-condition-type-code', 'sponsor-clearance',    'Sponsor clearance',    40),
  ('status-case-condition-type-code', 'academic-requirement', 'Academic requirement', 50),
  ('status-case-condition-type-code', 'other',                'Other',                60)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('student_status_case', 'case_type_code', 'student-status-case-type-code', NULL),
  ('student_status_case', 'initiated_by_code', 'status-case-initiator-code', NULL),
  ('student_status_case', 'reason_category_code', 'student-status-reason-code', NULL),
  ('status_case_assessment', 'assessor_role_code', 'status-case-assessor-role-code', NULL),
  ('status_case_assessment', 'outcome_code', 'status-case-assessment-outcome-code', NULL),
  ('status_case_condition', 'condition_type_code', 'status-case-condition-type-code', NULL)
ON CONFLICT DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- Originally 0008_curriculum_publication.sql
-- ════════════════════════════════════════════════════════════

-- 0008 — Curriculum publication, recognised credit and rule exceptions (BPR-D05; BP-03-001, BP-02-006)
--
-- curriculum_publication / curriculum_publication_item: a versioned release
--   from the curriculum system of record (F-CM-SIS-01), received whole,
--   validated and classified item by item (add, change, close, unchanged)
--   against the current catalogue, then applied in one transaction. An
--   invalid item rejects the whole publication and the catalogue is not
--   changed (BP-03-001 E2). The result counts are the acknowledgement to the
--   source (step 8).
-- recognised_credit: credit a student brings in (prior learning, transfer)
--   or is exempted from, proposed and approved by different people.
-- rule_exception: an authorised waiver or variation of a programme rule
--   for one student, time-bound and revocable.

CREATE TABLE IF NOT EXISTS "curriculum_publication" (
  "id"                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"               uuid        NOT NULL REFERENCES "tenant" ("id"),
  "source_system_code"      text        NOT NULL,
  "source_publication_ref"  text        NOT NULL,
  "publication_version"     text        NOT NULL,
  "approval_ref"            text,
  "effective_from"          date        NOT NULL,
  "correction_rationale"    text,                   -- required for a retrospective publication (E4)
  -- validated | rejected | applied
  "status_code"             text        NOT NULL,
  "added_count"             integer     NOT NULL DEFAULT 0,
  "changed_count"           integer     NOT NULL DEFAULT 0,
  "closed_count"            integer     NOT NULL DEFAULT 0,
  "unchanged_count"         integer     NOT NULL DEFAULT 0,
  "rejected_count"          integer     NOT NULL DEFAULT 0,
  "payload_hash"            text        NOT NULL,
  "received_by"             text        NOT NULL,
  "received_at"             timestamptz NOT NULL DEFAULT now(),
  "applied_by"              text,
  "applied_at"              timestamptz,
  CONSTRAINT "curriculum_publication_status_check" CHECK ("status_code" IN ('validated', 'rejected', 'applied')),
  CONSTRAINT "curriculum_publication_source_unique" UNIQUE ("tenant_id", "source_system_code", "source_publication_ref")
);

CREATE TABLE IF NOT EXISTS "curriculum_publication_item" (
  "id"                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid        NOT NULL REFERENCES "tenant" ("id"),
  "publication_id"    uuid        NOT NULL REFERENCES "curriculum_publication" ("id"),
  "object_type_code"  text        NOT NULL,   -- programme | module
  "object_code"       text        NOT NULL,
  "source_reference"  text,
  -- add | change | close | unchanged | invalid
  "change_type_code"  text        NOT NULL,
  "payload"           jsonb       NOT NULL,
  "issue"             text,
  "applied_entity_id" uuid,
  CONSTRAINT "curriculum_publication_item_type_check" CHECK ("object_type_code" IN ('programme', 'module')),
  CONSTRAINT "curriculum_publication_item_change_check" CHECK ("change_type_code" IN ('add', 'change', 'close', 'unchanged', 'invalid'))
);
CREATE INDEX IF NOT EXISTS "curriculum_publication_item_pub_idx" ON "curriculum_publication_item" ("tenant_id", "publication_id");

CREATE TABLE IF NOT EXISTS "recognised_credit" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL REFERENCES "tenant" ("id"),
  "enrolment_id"          uuid        NOT NULL,
  "recognition_type_code" text        NOT NULL,   -- value set credit-recognition-type-code
  "source_description"    text        NOT NULL,   -- prior institution, qualification or learning
  "credit_value"          smallint    NOT NULL CHECK ("credit_value" > 0),
  "fheq_level"            smallint    CHECK ("fheq_level" BETWEEN 3 AND 8),
  "module_id"             uuid,                   -- module the credit exempts, if any
  "status_case_id"        uuid,                   -- the transfer that mapped it, if any
  "evidence_ref"          text,
  -- proposed | approved | rejected
  "status_code"           text        NOT NULL DEFAULT 'proposed',
  "created_by"            text        NOT NULL,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "decided_by"            text,
  "decided_at"            timestamptz,
  "decision_reason"       text,
  CONSTRAINT "recognised_credit_status_check" CHECK ("status_code" IN ('proposed', 'approved', 'rejected'))
);
CREATE INDEX IF NOT EXISTS "recognised_credit_enrolment_idx" ON "recognised_credit" ("tenant_id", "enrolment_id");

CREATE TABLE IF NOT EXISTS "rule_exception" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL REFERENCES "tenant" ("id"),
  "enrolment_id"          uuid        NOT NULL,
  "programme_rule_set_id" uuid,
  "rule_code"             text        NOT NULL,   -- the rule varied, e.g. a diet or credit-load rule
  "exception_type_code"   text        NOT NULL,   -- value set rule-exception-type-code
  "description"           text        NOT NULL,
  "valid_from"            date        NOT NULL,
  "valid_to"              date,
  "authority_ref"         text,                   -- e.g. the committee minute
  -- proposed | approved | rejected | revoked
  "status_code"           text        NOT NULL DEFAULT 'proposed',
  "created_by"            text        NOT NULL,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "decided_by"            text,
  "decided_at"            timestamptz,
  "decision_reason"       text,
  CONSTRAINT "rule_exception_status_check" CHECK ("status_code" IN ('proposed', 'approved', 'rejected', 'revoked')),
  CONSTRAINT "rule_exception_dates_check" CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from")
);
CREATE INDEX IF NOT EXISTS "rule_exception_enrolment_idx" ON "rule_exception" ("tenant_id", "enrolment_id");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['curriculum_publication', 'curriculum_publication_item', 'recognised_credit', 'rule_exception'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)', t);
  END LOOP;
END $$;

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('credit-recognition-type-code', 'Credit Recognition Type', 'srs-internal', NULL, 'Basis on which credit is recognised for a student', true),
  ('rule-exception-type-code', 'Rule Exception Type', 'srs-internal', NULL, 'Kind of authorised exception to a programme rule', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z'
FROM "value_set" vs,
(VALUES
  ('credit-recognition-type-code', 'rpcl',        'Recognition of prior certificated learning',  10),
  ('credit-recognition-type-code', 'rpel',        'Recognition of prior experiential learning', 20),
  ('credit-recognition-type-code', 'transfer-in', 'Credit transferred in',                       30),
  ('credit-recognition-type-code', 'internal-transfer', 'Credit carried across an internal transfer', 40),
  ('credit-recognition-type-code', 'exemption',   'Module exemption',                            50),
  ('rule-exception-type-code', 'waiver',    'Waiver',    10),
  ('rule-exception-type-code', 'variation', 'Variation', 20)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('recognised_credit', 'recognition_type_code', 'credit-recognition-type-code', NULL),
  ('rule_exception', 'exception_type_code', 'rule-exception-type-code', NULL)
ON CONFLICT DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- Originally 0009_reassessment_and_conferment.sql
-- ════════════════════════════════════════════════════════════

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


-- ════════════════════════════════════════════════════════════
-- Originally 0010_documents_and_graduation.sql
-- ════════════════════════════════════════════════════════════

-- 0010 — Award documents and graduation (BPR-D15; BP-06-004, BP-06-005)
--
-- student_document: a document the student is entitled to for a conferred
--   award (certificate, transcript, HEAR, award letter).
-- document_issue: each issue of it, numbered, with the exact content
--   snapshot, its SHA-256 hash and a verification code. Replacement,
--   corrected-name and certified-copy issues are new rows; history is never
--   rewritten (BP-06-004 A1).
-- document_revocation: append-only; a compromised or erroneous issue is
--   revoked, not deleted (E2).
-- document_verification: each verification check and its outcome.
-- graduation_cycle / graduation_ceremony / graduation_invitation /
--   ceremony_allocation: invitations derived from conferred awards,
--   students' choices, allocation within ceremony capacity, a frozen
--   presentation list, and attendance recorded separately from the award
--   (BP-06-005 step 6, E1).

CREATE TABLE IF NOT EXISTS "student_document" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant" ("id"),
  "award_id"            uuid        NOT NULL,
  "enrolment_id"        uuid        NOT NULL,
  "person_id"           uuid        NOT NULL,
  "document_type_code"  text        NOT NULL,   -- value set student-document-type-code
  "created_by"          text        NOT NULL,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "student_document_one_per_type" UNIQUE ("tenant_id", "award_id", "document_type_code")
);

CREATE TABLE IF NOT EXISTS "document_issue" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant" ("id"),
  "student_document_id" uuid        NOT NULL REFERENCES "student_document" ("id"),
  "issue_number"        smallint    NOT NULL,
  "issue_type_code"     text        NOT NULL,   -- value set document-issue-type-code
  "content_snapshot"    jsonb       NOT NULL,
  "content_hash"        text        NOT NULL,
  "verification_code"   text        NOT NULL,
  "channel_code"        text        NOT NULL,   -- value set document-channel-code
  -- issued | superseded | revoked
  "status_code"         text        NOT NULL DEFAULT 'issued',
  "issued_by"           text        NOT NULL,
  "issued_at"           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "document_issue_status_check" CHECK ("status_code" IN ('issued', 'superseded', 'revoked')),
  CONSTRAINT "document_issue_number_unique" UNIQUE ("student_document_id", "issue_number"),
  CONSTRAINT "document_issue_verification_unique" UNIQUE ("verification_code")
);

CREATE TABLE IF NOT EXISTS "document_revocation" (
  "id"                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid        NOT NULL REFERENCES "tenant" ("id"),
  "document_issue_id" uuid        NOT NULL UNIQUE REFERENCES "document_issue" ("id"),
  "reason_code"       text        NOT NULL,   -- value set document-revocation-reason-code
  "reason_text"       text        NOT NULL,
  "revoked_by"        text        NOT NULL,
  "revoked_at"        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "document_verification" (
  "id"                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid        NOT NULL REFERENCES "tenant" ("id"),
  "document_issue_id" uuid,                 -- null when the code matched nothing
  "verification_code" text        NOT NULL,
  "requested_by"      text        NOT NULL,
  "requester_note"    text,                 -- e.g. the verifying organisation
  -- valid | revoked | superseded | not-found
  "outcome_code"      text        NOT NULL,
  "checked_at"        timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION document_revocation_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'document revocations are append-only';
END;
$$;
CREATE TRIGGER document_revocation_immutable_guard
  BEFORE UPDATE OR DELETE ON "document_revocation"
  FOR EACH ROW EXECUTE FUNCTION document_revocation_immutable();

CREATE TABLE IF NOT EXISTS "graduation_cycle" (
  "id"                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid        NOT NULL REFERENCES "tenant" ("id"),
  "cycle_code"        text        NOT NULL,
  "title"             text        NOT NULL,
  "awards_from"       date        NOT NULL,   -- awards conferred in [awards_from, awards_to] are eligible
  "awards_to"         date        NOT NULL,
  -- open | frozen | closed
  "status_code"       text        NOT NULL DEFAULT 'open',
  "created_by"        text        NOT NULL,
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "frozen_at"         timestamptz,
  CONSTRAINT "graduation_cycle_status_check" CHECK ("status_code" IN ('open', 'frozen', 'closed')),
  CONSTRAINT "graduation_cycle_window_check" CHECK ("awards_to" >= "awards_from"),
  CONSTRAINT "graduation_cycle_code_unique" UNIQUE ("tenant_id", "cycle_code")
);

CREATE TABLE IF NOT EXISTS "graduation_ceremony" (
  "id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"     uuid        NOT NULL REFERENCES "tenant" ("id"),
  "cycle_id"      uuid        NOT NULL REFERENCES "graduation_cycle" ("id"),
  "ceremony_code" text        NOT NULL,
  "starts_at"     timestamptz NOT NULL,
  "venue"         text        NOT NULL,
  "capacity"      integer     NOT NULL CHECK ("capacity" > 0),
  "guest_limit"   smallint    NOT NULL DEFAULT 2 CHECK ("guest_limit" >= 0),
  CONSTRAINT "graduation_ceremony_code_unique" UNIQUE ("cycle_id", "ceremony_code")
);

CREATE TABLE IF NOT EXISTS "graduation_invitation" (
  "id"                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                uuid        NOT NULL REFERENCES "tenant" ("id"),
  "cycle_id"                 uuid        NOT NULL REFERENCES "graduation_cycle" ("id"),
  "award_id"                 uuid        NOT NULL,
  "person_id"                uuid        NOT NULL,
  -- invited | attending | in-absentia | deferred | declined
  "response_code"            text        NOT NULL DEFAULT 'invited',
  "guest_count"              smallint    NOT NULL DEFAULT 0 CHECK ("guest_count" >= 0),
  "accessibility_required"   boolean     NOT NULL DEFAULT false,  -- detail stays with the support team (E2)
  "responded_at"             timestamptz,
  "created_at"               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "graduation_invitation_response_check" CHECK ("response_code" IN ('invited', 'attending', 'in-absentia', 'deferred', 'declined')),
  CONSTRAINT "graduation_invitation_award_unique" UNIQUE ("cycle_id", "award_id")
);

CREATE TABLE IF NOT EXISTS "ceremony_allocation" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant" ("id"),
  "invitation_id"       uuid        NOT NULL UNIQUE REFERENCES "graduation_invitation" ("id"),
  "ceremony_id"         uuid        NOT NULL REFERENCES "graduation_ceremony" ("id"),
  "presentation_order"  integer,
  -- allocated | attended | absent
  "attendance_code"     text        NOT NULL DEFAULT 'allocated',
  "allocated_by"        text        NOT NULL,
  "allocated_at"        timestamptz NOT NULL DEFAULT now(),
  "attendance_recorded_at" timestamptz,
  CONSTRAINT "ceremony_allocation_attendance_check" CHECK ("attendance_code" IN ('allocated', 'attended', 'absent'))
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['student_document', 'document_issue', 'document_revocation', 'document_verification',
                           'graduation_cycle', 'graduation_ceremony', 'graduation_invitation', 'ceremony_allocation'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)', t);
  END LOOP;
END $$;

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('student-document-type-code', 'Student Document Type', 'srs-internal', NULL, 'Award document a student is issued', true),
  ('document-issue-type-code', 'Document Issue Type', 'srs-internal', NULL, 'Kind of issue of an award document', false),
  ('document-channel-code', 'Document Delivery Channel', 'srs-internal', NULL, 'How an issued document is delivered', true),
  ('document-revocation-reason-code', 'Document Revocation Reason', 'srs-internal', NULL, 'Why an issued document was revoked', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z'
FROM "value_set" vs,
(VALUES
  ('student-document-type-code', 'certificate',  'Award certificate', 10),
  ('student-document-type-code', 'transcript',   'Transcript',        20),
  ('student-document-type-code', 'hear',         'Higher Education Achievement Report', 30),
  ('student-document-type-code', 'award-letter', 'Award letter',      40),
  ('document-issue-type-code', 'original',       'Original',           10),
  ('document-issue-type-code', 'replacement',    'Replacement',        20),
  ('document-issue-type-code', 'corrected-name', 'Corrected name',     30),
  ('document-issue-type-code', 'certified-copy', 'Certified copy',     40),
  ('document-channel-code', 'digital',    'Secure digital delivery', 10),
  ('document-channel-code', 'post',       'Post',                    20),
  ('document-channel-code', 'collection', 'Collection in person',    30),
  ('document-revocation-reason-code', 'error',         'Issued in error',     10),
  ('document-revocation-reason-code', 'compromised',   'Compromised',         20),
  ('document-revocation-reason-code', 'award-revoked', 'Award revoked',       30),
  ('document-revocation-reason-code', 'other',         'Other',               40)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('student_document', 'document_type_code', 'student-document-type-code', NULL),
  ('document_issue', 'issue_type_code', 'document-issue-type-code', NULL),
  ('document_issue', 'channel_code', 'document-channel-code', NULL),
  ('document_revocation', 'reason_code', 'document-revocation-reason-code', NULL)
ON CONFLICT DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- Originally 0011_applications_and_offers.sql
-- ════════════════════════════════════════════════════════════

-- 0011 — Applications and offers (BPR-D01, BPR-D02; BP-01-001 to BP-01-004)
--
-- application_received_payload: every payload as received, append-only and
--   idempotent per channel, source reference and content hash.
-- student_application: the channel-neutral working application. The
--   applicant is matched to a person only on certain evidence; an
--   uncertain match is routed for review, never merged (BP-01-001 step 3).
--   Bridges to ucas_application for the UCAS channel.
-- application_assessment: each assessment outcome with its assessor and
--   evidence version, append-only (BP-01-002 step 4).
-- admissions_offer: the authorised offer. An authorised change creates a
--   new version that supersedes the old one (BP-01-003 step 6).
-- offer_condition / condition_evidence: individually testable conditions
--   and the evidence mapped to them, with provenance (BP-01-004).
-- offer_confirmation_decision: the overall confirmation decision with the
--   frozen condition versions it tested, append-only.

CREATE TABLE IF NOT EXISTS "application_received_payload" (
  "id"                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid        NOT NULL REFERENCES "tenant" ("id"),
  "channel_code"      text        NOT NULL,   -- value set application-channel-code
  "source_reference"  text        NOT NULL,
  "cycle"             text        NOT NULL,
  "payload"           jsonb       NOT NULL,
  "payload_hash"      text        NOT NULL,
  "received_by"       text        NOT NULL,
  "received_at"       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "application_received_payload_unique" UNIQUE ("tenant_id", "channel_code", "source_reference", "payload_hash")
);

CREATE TABLE IF NOT EXISTS "student_application" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL REFERENCES "tenant" ("id"),
  "channel_code"          text        NOT NULL,
  "source_reference"      text        NOT NULL,
  "cycle"                 text        NOT NULL,
  "person_id"             uuid,                   -- null until the applicant identity is confirmed
  -- matched | created | needs-review
  "identity_match_code"   text        NOT NULL,
  "programme_id"          uuid        NOT NULL,
  "intake_code"           text        NOT NULL,   -- e.g. 2027-09
  "mode_of_study_code"    text        NOT NULL,
  "latest_payload_id"     uuid        NOT NULL REFERENCES "application_received_payload" ("id"),
  "ucas_application_id"   uuid,
  -- received | incomplete | under-assessment | recommended | rejected | offered | withdrawn
  "status_code"           text        NOT NULL DEFAULT 'received',
  "routing_reason_code"   text,                   -- why it is on a worklist: incomplete | duplicate | restricted | identity
  "recommendation_code"   text,                   -- offer | reject
  "recommendation_reason" text,
  "recommended_by"        text,
  "recommended_at"        timestamptz,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "updated_at"            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "student_application_status_check" CHECK ("status_code" IN ('received', 'incomplete', 'under-assessment', 'recommended', 'rejected', 'offered', 'withdrawn')),
  CONSTRAINT "student_application_identity_check" CHECK ("identity_match_code" IN ('matched', 'created', 'needs-review')),
  CONSTRAINT "student_application_source_unique" UNIQUE ("tenant_id", "channel_code", "source_reference")
);

CREATE TABLE IF NOT EXISTS "application_assessment" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL REFERENCES "tenant" ("id"),
  "application_id"        uuid        NOT NULL REFERENCES "student_application" ("id"),
  "assessment_type_code"  text        NOT NULL,   -- value set application-assessment-type-code
  "outcome_code"          text        NOT NULL,   -- value set application-assessment-outcome-code
  "evidence_ref"          text,
  "evidence_version"      text,
  "note"                  text,
  "assessed_by"           text        NOT NULL,
  "assessed_at"           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "admissions_offer" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL REFERENCES "tenant" ("id"),
  "application_id"        uuid        NOT NULL REFERENCES "student_application" ("id"),
  "version"               smallint    NOT NULL,
  "previous_offer_id"     uuid        REFERENCES "admissions_offer" ("id"),
  "programme_id"          uuid        NOT NULL,
  "intake_code"           text        NOT NULL,
  "mode_of_study_code"    text        NOT NULL,
  "fee_status_basis_code" text,
  "offer_type_code"       text        NOT NULL,   -- conditional | unconditional
  -- made | accepted | declined | withdrawn | expired | superseded | confirmed | unsuccessful
  "status_code"           text        NOT NULL DEFAULT 'made',
  "expires_on"            date,
  "decided_by"            text        NOT NULL,
  "decided_at"            timestamptz NOT NULL DEFAULT now(),
  "change_reason"         text,
  "response_code"         text,                   -- accept | decline
  "response_source_at"    timestamptz,            -- the applicant channel's timestamp
  "responded_at"          timestamptz,
  CONSTRAINT "admissions_offer_type_check" CHECK ("offer_type_code" IN ('conditional', 'unconditional')),
  CONSTRAINT "admissions_offer_status_check" CHECK ("status_code" IN ('made', 'accepted', 'declined', 'withdrawn', 'expired', 'superseded', 'confirmed', 'unsuccessful')),
  CONSTRAINT "admissions_offer_version_unique" UNIQUE ("application_id", "version")
);

CREATE TABLE IF NOT EXISTS "offer_condition" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant" ("id"),
  "offer_id"            uuid        NOT NULL REFERENCES "admissions_offer" ("id"),
  "condition_type_code" text        NOT NULL,   -- value set offer-condition-type-code
  "description"         text        NOT NULL,
  "required_value"      text,                   -- e.g. AAB, IELTS 6.5
  -- pending | met | waived | unmet
  "status_code"         text        NOT NULL DEFAULT 'pending',
  "decided_by"          text,
  "decided_at"          timestamptz,
  "decision_note"       text,
  CONSTRAINT "offer_condition_status_check" CHECK ("status_code" IN ('pending', 'met', 'waived', 'unmet'))
);

CREATE TABLE IF NOT EXISTS "condition_evidence" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant" ("id"),
  "condition_id"        uuid        NOT NULL REFERENCES "offer_condition" ("id"),
  "provenance_code"     text        NOT NULL,   -- value set evidence-provenance-code
  "evidence_ref"        text        NOT NULL,
  "reported_value"      text,
  "verified"            boolean     NOT NULL DEFAULT false,
  "received_by"         text        NOT NULL,
  "received_at"         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "offer_confirmation_decision" (
  "id"                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                uuid        NOT NULL REFERENCES "tenant" ("id"),
  "offer_id"                 uuid        NOT NULL UNIQUE REFERENCES "admissions_offer" ("id"),
  -- confirmed | confirmed-alternative | unsuccessful
  "decision_code"            text        NOT NULL,
  "alternative_programme_id" uuid,
  "condition_snapshot"       jsonb       NOT NULL,   -- the frozen condition versions tested
  "reason"                   text,
  "handoff_workflow_instance_id" uuid,
  "decided_by"               text        NOT NULL,
  "decided_at"               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "offer_confirmation_decision_check" CHECK ("decision_code" IN ('confirmed', 'confirmed-alternative', 'unsuccessful'))
);

CREATE FUNCTION admissions_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER application_received_payload_append_only BEFORE UPDATE OR DELETE ON "application_received_payload"
  FOR EACH ROW EXECUTE FUNCTION admissions_append_only();
CREATE TRIGGER application_assessment_append_only BEFORE UPDATE OR DELETE ON "application_assessment"
  FOR EACH ROW EXECUTE FUNCTION admissions_append_only();
CREATE TRIGGER offer_confirmation_decision_append_only BEFORE UPDATE OR DELETE ON "offer_confirmation_decision"
  FOR EACH ROW EXECUTE FUNCTION admissions_append_only();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['application_received_payload', 'student_application', 'application_assessment', 'admissions_offer',
                           'offer_condition', 'condition_evidence', 'offer_confirmation_decision'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)', t);
  END LOOP;
END $$;

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('application-channel-code', 'Application Channel', 'srs-internal', NULL, 'Route by which an application arrives', true),
  ('application-assessment-type-code', 'Application Assessment Type', 'srs-internal', NULL, 'Kind of application assessment', true),
  ('application-assessment-outcome-code', 'Application Assessment Outcome', 'srs-internal', NULL, 'Outcome of an application assessment', false),
  ('offer-condition-type-code', 'Offer Condition Type', 'srs-internal', NULL, 'Kind of offer condition', true),
  ('evidence-provenance-code', 'Evidence Provenance', 'srs-internal', NULL, 'Where condition evidence came from', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z'
FROM "value_set" vs,
(VALUES
  ('application-channel-code', 'ucas',                 'UCAS',                   10),
  ('application-channel-code', 'direct',               'Direct',                 20),
  ('application-channel-code', 'agent',                'Agent',                  30),
  ('application-channel-code', 'international-direct', 'International direct',   40),
  ('application-channel-code', 'international-agent',  'International agent',    50),
  ('application-channel-code', 'clearing',             'Clearing',               60),
  ('application-assessment-type-code', 'academic',     'Academic evidence',  10),
  ('application-assessment-type-code', 'contextual',   'Contextual data',    20),
  ('application-assessment-type-code', 'interview',    'Interview',          30),
  ('application-assessment-type-code', 'portfolio',    'Portfolio',          40),
  ('application-assessment-type-code', 'safeguarding', 'Safeguarding and compliance', 50),
  ('application-assessment-outcome-code', 'meets',         'Meets criteria',        10),
  ('application-assessment-outcome-code', 'does-not-meet', 'Does not meet criteria', 20),
  ('application-assessment-outcome-code', 'clear',         'No concern',            30),
  ('application-assessment-outcome-code', 'concern',       'Concern raised',        40),
  ('offer-condition-type-code', 'academic',    'Academic result',        10),
  ('offer-condition-type-code', 'language',    'English language',       20),
  ('offer-condition-type-code', 'document',    'Document or verification', 30),
  ('offer-condition-type-code', 'non-academic','Other non-academic',     40),
  ('evidence-provenance-code', 'ucas-results',  'UCAS results',      10),
  ('evidence-provenance-code', 'awarding-body', 'Awarding body',     20),
  ('evidence-provenance-code', 'applicant',     'Applicant upload',  30),
  ('evidence-provenance-code', 'test-provider', 'Test provider',     40)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('student_application', 'channel_code', 'application-channel-code', NULL),
  ('application_assessment', 'assessment_type_code', 'application-assessment-type-code', NULL),
  ('application_assessment', 'outcome_code', 'application-assessment-outcome-code', NULL),
  ('offer_condition', 'condition_type_code', 'offer-condition-type-code', NULL),
  ('condition_evidence', 'provenance_code', 'evidence-provenance-code', NULL)
ON CONFLICT DO NOTHING;
