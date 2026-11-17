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
