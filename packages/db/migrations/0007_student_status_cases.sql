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
