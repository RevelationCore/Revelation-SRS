-- 0009 — Audiences and evidence (Phase 5)
-- (docs/decisions/phase-5-gap-closure-decisions.md, D-35 to D-47)

-- ── D-35: every calculation records the rule versions it used ───────────────
ALTER TABLE "mark"          ADD COLUMN IF NOT EXISTS "rule_versions" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE "module_result" ADD COLUMN IF NOT EXISTS "rule_versions" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE "progression_calculation_evidence" ADD COLUMN IF NOT EXISTS "rule_versions" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE "mark_calculation_evidence"        ADD COLUMN IF NOT EXISTS "rule_versions" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE "ukvi_compliance_alert"            ADD COLUMN IF NOT EXISTS "rule_versions" jsonb NOT NULL DEFAULT '[]';

-- Classification evidence is written at recommendation, before an award exists.
ALTER TABLE "award_calculation_evidence" ADD COLUMN IF NOT EXISTS "rule_versions" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE "award_calculation_evidence" ADD COLUMN IF NOT EXISTS "award_recommendation_id" uuid;
ALTER TABLE "award_calculation_evidence" ALTER COLUMN "award_id" DROP NOT NULL;
CREATE INDEX IF NOT EXISTS "award_calc_evidence_recommendation_idx"
  ON "award_calculation_evidence" ("tenant_id", "award_recommendation_id");

-- The evidence tables predate the RLS convention; they now get it, as
-- evidence is written inside the decision's tenant transaction.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mark_calculation_evidence', 'progression_calculation_evidence', 'award_calculation_evidence'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("tenant_id" = current_setting(''app.current_tenant_id'', true)::uuid) WITH CHECK ("tenant_id" = current_setting(''app.current_tenant_id'', true)::uuid)', t);
  END LOOP;
END $$;

-- ── D-36: data pack hash, rule manifest, decisions that cite the hash ───────
-- A rule manifest is content-addressed: rule_manifest_ref on a pack holds the
-- manifest's sha256 hash, so the reference also proves the content.
CREATE TABLE IF NOT EXISTS "rule_manifest" (
  "id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"     uuid        NOT NULL REFERENCES "tenant"("id"),
  "manifest_hash" text        NOT NULL CHECK ("manifest_hash" ~ '^sha256:[0-9a-f]{64}$'),
  "content"       jsonb       NOT NULL,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tenant_id", "manifest_hash")
);
ALTER TABLE "rule_manifest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rule_manifest" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "rule_manifest";
CREATE POLICY tenant_isolation ON "rule_manifest"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

-- Append-only: a manifest is never changed once written.
CREATE OR REPLACE FUNCTION "rule_manifest_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'rule_manifest is append-only';
END $$;
DROP TRIGGER IF EXISTS "rule_manifest_append_only" ON "rule_manifest";
CREATE TRIGGER "rule_manifest_append_only" BEFORE UPDATE OR DELETE ON "rule_manifest"
  FOR EACH ROW EXECUTE FUNCTION "rule_manifest_append_only"();

ALTER TABLE "exam_board_data_pack" DROP CONSTRAINT IF EXISTS "exam_board_data_pack_pack_hash_check";
ALTER TABLE "exam_board_data_pack" ADD CONSTRAINT "exam_board_data_pack_pack_hash_check"
  CHECK ("pack_hash" IS NULL OR "pack_hash" ~ '^sha256:[0-9a-f]{64}$');

ALTER TABLE "exam_board_decision" ADD COLUMN IF NOT EXISTS "pack_hash" text;
-- A logical reference: exam_board_data_pack already references exam_board, and
-- a foreign key back would make a cycle (which the demo reset refuses).
ALTER TABLE "exam_board" ADD COLUMN IF NOT EXISTS "ratified_data_pack_id" uuid;
ALTER TABLE "exam_board" ADD COLUMN IF NOT EXISTS "ratified_pack_hash" text;

-- ── D-37: before and after version references on corrections ────────────────
ALTER TABLE "post_ratification_amendment" DROP CONSTRAINT IF EXISTS "post_ratification_amendment_before_version_ref_fkey";
ALTER TABLE "post_ratification_amendment" ADD CONSTRAINT "post_ratification_amendment_before_version_ref_fkey"
  FOREIGN KEY ("before_version_ref") REFERENCES "source_version_reference"("id");
ALTER TABLE "post_ratification_amendment" DROP CONSTRAINT IF EXISTS "post_ratification_amendment_after_version_ref_fkey";
ALTER TABLE "post_ratification_amendment" ADD CONSTRAINT "post_ratification_amendment_after_version_ref_fkey"
  FOREIGN KEY ("after_version_ref") REFERENCES "source_version_reference"("id");
ALTER TABLE "post_ratification_amendment" DROP CONSTRAINT IF EXISTS "post_ratification_amendment_version_refs_paired";
ALTER TABLE "post_ratification_amendment" ADD CONSTRAINT "post_ratification_amendment_version_refs_paired"
  CHECK (("before_version_ref" IS NULL) = ("after_version_ref" IS NULL));

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES ('source-version-purpose-code', 'Source Version Purpose', 'srs-internal', NULL, 'Why a record version was cited', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z', NULL
FROM "value_set" vs,
(VALUES
  ('source-version-purpose-code', 'decision-basis',     'Basis of a decision',          10),
  ('source-version-purpose-code', 'published-artefact', 'Published artefact',           20),
  ('source-version-purpose-code', 'submission-source',  'Source of a submission',       30),
  ('source-version-purpose-code', 'amendment-before',   'Version a correction replaced', 40),
  ('source-version-purpose-code', 'amendment-after',    'Version a correction created',  50)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES ('source_version_reference', 'purpose_code', 'source-version-purpose-code', NULL)
ON CONFLICT DO NOTHING;

-- ── D-39: applicant self-service ────────────────────────────────────────────
ALTER TABLE "admissions_offer" ADD COLUMN IF NOT EXISTS "responded_by" text;
ALTER TABLE "admissions_offer" ADD COLUMN IF NOT EXISTS "response_channel_code" text;
ALTER TABLE "student_application" ADD COLUMN IF NOT EXISTS "withdrawn_at" timestamptz;
ALTER TABLE "student_application" ADD COLUMN IF NOT EXISTS "withdrawn_by" text;
ALTER TABLE "student_application" ADD COLUMN IF NOT EXISTS "withdrawal_reason_code" text;

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('offer-response-channel-code', 'Offer Response Channel', 'srs-internal', NULL, 'Where an applicant''s reply to an offer was made', false),
  ('application-withdrawal-reason-code', 'Application Withdrawal Reason', 'srs-internal', NULL, 'Why an applicant withdrew; optional', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z', NULL
FROM "value_set" vs,
(VALUES
  ('offer-response-channel-code', 'ucas',             'UCAS',                     10),
  ('offer-response-channel-code', 'applicant-portal', 'Applicant portal',         20),
  ('offer-response-channel-code', 'staff-recorded',   'Recorded by staff',        30),
  ('application-withdrawal-reason-code', 'accepted-elsewhere', 'Accepted a place elsewhere', 10),
  ('application-withdrawal-reason-code', 'changed-plans',      'Changed plans',              20),
  ('application-withdrawal-reason-code', 'financial',          'Financial reasons',          30),
  ('application-withdrawal-reason-code', 'personal',           'Personal reasons',           40),
  ('application-withdrawal-reason-code', 'other',              'Other',                      90)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('admissions_offer',    'response_channel_code',  'offer-response-channel-code', NULL),
  ('student_application', 'withdrawal_reason_code', 'application-withdrawal-reason-code', NULL)
ON CONFLICT DO NOTHING;

-- ── D-40: examiner reports entered by examiners themselves ──────────────────
ALTER TABLE "examiner_report" ADD COLUMN IF NOT EXISTS "submitted_by" text;
ALTER TABLE "examiner_report" ADD COLUMN IF NOT EXISTS "entry_channel_code" text;
ALTER TABLE "examiner_report" ADD COLUMN IF NOT EXISTS "on_behalf_reason" text;
-- One independent preliminary report per appointment.
CREATE UNIQUE INDEX IF NOT EXISTS "examiner_report_one_per_appointment" ON "examiner_report" ("examiner_appointment_id");
ALTER TABLE "examiner_report" DROP CONSTRAINT IF EXISTS "examiner_report_on_behalf_reason_check";
ALTER TABLE "examiner_report" ADD CONSTRAINT "examiner_report_on_behalf_reason_check"
  CHECK ("entry_channel_code" IS DISTINCT FROM 'staff-on-behalf' OR "on_behalf_reason" IS NOT NULL);

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES ('examiner-report-entry-channel-code', 'Examiner Report Entry Channel', 'srs-internal', NULL, 'Who entered an examiner''s preliminary report', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z', NULL
FROM "value_set" vs,
(VALUES
  ('examiner-report-entry-channel-code', 'examiner-portal', 'Submitted by the examiner', 10),
  ('examiner-report-entry-channel-code', 'staff-on-behalf', 'Entered by staff for the examiner', 20)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES ('examiner_report', 'entry_channel_code', 'examiner-report-entry-channel-code', NULL)
ON CONFLICT DO NOTHING;

-- ── D-41: exceptional-circumstances outcomes through a governed determination ─
-- A proposed outcome is decided by someone other than its proposer and the
-- person who recorded the submission; until then the EC keeps its outcome.
CREATE TABLE IF NOT EXISTS "ec_determination" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL REFERENCES "tenant"("id"),
  "exceptional_circumstances_id" uuid NOT NULL,
  "proposed_outcome_code" text        NOT NULL,
  "reason"                text        NOT NULL,
  "status_code"           text        NOT NULL DEFAULT 'proposed' CHECK ("status_code" IN ('proposed', 'upheld', 'not-upheld')),
  "proposed_by"           text        NOT NULL,
  "proposed_at"           timestamptz NOT NULL DEFAULT now(),
  "recorded_by"           text        NOT NULL,
  "workflow_instance_id"  uuid,
  "decided_by"            text,
  "decided_at"            timestamptz,
  "decision_reason"       text
);
CREATE INDEX IF NOT EXISTS "ec_determination_ec_idx" ON "ec_determination" ("tenant_id", "exceptional_circumstances_id");
-- One open proposal per EC.
CREATE UNIQUE INDEX IF NOT EXISTS "ec_determination_one_open" ON "ec_determination" ("tenant_id", "exceptional_circumstances_id") WHERE "status_code" = 'proposed';
ALTER TABLE "ec_determination" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ec_determination" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ec_determination";
CREATE POLICY tenant_isolation ON "ec_determination"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

INSERT INTO "workflow_definition" ("definition_code", "display_name", "owner_module_code", "status_code", "current_version_number", "description", "created_by")
VALUES ('ec-determination', 'Exceptional circumstances determination', 'circumstances', 'active', 1,
  'A proposed outcome for an exceptional-circumstances claim, decided by someone other than its proposer and the person who recorded the claim.', 'system')
ON CONFLICT DO NOTHING;

INSERT INTO "workflow_definition_version" ("workflow_definition_id", "version_number", "status_code", "definition_json", "effective_from", "created_by")
SELECT wd."id", 1, 'active',
  jsonb_build_object('source', 'docs/decisions/phase-5-gap-closure-decisions.md', 'decisionStepKey', 'decide-ec-outcome', 'decisionGatewayAuditTable', 'workflow_decision_audit'),
  '2026-11-18T00:00:00Z'::timestamptz, 'system'
FROM "workflow_definition" wd WHERE wd."definition_code" = 'ec-determination'
ON CONFLICT ("workflow_definition_id", "version_number") DO NOTHING;

INSERT INTO "workflow_step" ("workflow_definition_version_id", "step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration")
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('outcome-proposed',  'start',      'EC outcome proposed',           null,                     10, '{}'),
  ('decide-ec-outcome', 'human-task', 'Decide the EC outcome',         'registry-administrator', 20, '{"assignmentRulesRequired": true}'),
  ('decision-gateway',  'decision',   'EC determination gateway',      'registry-administrator', 30, '{"auditTable": "workflow_decision_audit"}'),
  ('determination-closed', 'end',     'EC determination closed',       null,                     40, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'ec-determination' AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

INSERT INTO "workflow_decision_gateway" ("workflow_definition_version_id", "gateway_key", "display_name", "decision_type_code", "source_reference", "configuration")
SELECT wdv."id", 'G01', 'Uphold the proposed EC outcome?', 'exclusive', 'bp-04-005', jsonb_build_object('policySource', 'Institutional exceptional circumstances policy')
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
WHERE wd."definition_code" = 'ec-determination' AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- EC outcomes were free text; a determination validates against this set (D-41).
INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES ('ec-outcome-code', 'Exceptional Circumstances Outcome', 'srs-internal', NULL, 'The determined effect of an exceptional-circumstances claim; institutions add their own', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z', NULL
FROM "value_set" vs,
(VALUES
  ('ec-outcome-code', 'pending',   'Awaiting determination',                 10),
  ('ec-outcome-code', 'defer',     'Deferral (assessment at the next opportunity)', 20),
  ('ec-outcome-code', 'first-sit', 'Uncapped attempt (treated as a first sit)', 30),
  ('ec-outcome-code', 'extension', 'Extension granted',                      40),
  ('ec-outcome-code', 'condone',   'Considered by the board in its discretion', 50),
  ('ec-outcome-code', 'no-action', 'Not upheld: no change',                  60)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES ('exceptional_circumstances', 'outcome_code', 'ec-outcome-code', NULL)
ON CONFLICT DO NOTHING;

-- ── D-42: working-day calendar for statutory deadlines ──────────────────────
CREATE TABLE IF NOT EXISTS "non_working_day" (
  "id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"     uuid        NOT NULL REFERENCES "tenant"("id"),
  "date"          date        NOT NULL,
  "division_code" text        NOT NULL,
  "description"   text        NOT NULL,
  "source"        text        NOT NULL,
  "created_by"    text        NOT NULL,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tenant_id", "date", "division_code")
);
ALTER TABLE "non_working_day" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "non_working_day" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "non_working_day";
CREATE POLICY tenant_isolation ON "non_working_day"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES ('calendar-division-code', 'Calendar Division', 'srs-internal', NULL, 'Which bank holidays a non-working day belongs to; tenant closures apply everywhere', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z', NULL
FROM "value_set" vs,
(VALUES
  ('calendar-division-code', 'england-and-wales', 'England and Wales',  10),
  ('calendar-division-code', 'scotland',          'Scotland',           20),
  ('calendar-division-code', 'northern-ireland',  'Northern Ireland',   30),
  ('calendar-division-code', 'tenant',            'Institution closure', 40)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES ('non_working_day', 'division_code', 'calendar-division-code', NULL)
ON CONFLICT DO NOTHING;

-- ── Wellbeing case screens: code sets for the wellbeing module's records ────
-- The wellbeing module is a separate service with its own database; its
-- coded fields are listed here so the admin screens draw their choices from
-- the value-set system. Entity names are the module's schema-qualified
-- tables. Status sets give labels only: the module enforces each lifecycle.
INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('wellbeing-disability-support-type', 'Disability Support Type',         'srs-internal', NULL, 'How a disability support case is funded', false),
  ('wellbeing-disability-case-status',  'Disability Case Status',          'srs-internal', NULL, 'Where a disability support case is in its lifecycle', false),
  ('wellbeing-support-plan-status',     'Support Plan Status',             'srs-internal', NULL, 'Status of a disability support plan', false),
  ('wellbeing-dsa-entitlement-type',    'DSA Entitlement Type',            'srs-internal', NULL, 'What a Disabled Students'' Allowance entitlement provides', true),
  ('wellbeing-evidence-type',           'Wellbeing Evidence Type',         'srs-internal', NULL, 'Kind of supporting evidence held for a disability case', true),
  ('wellbeing-evidence-status',         'Wellbeing Evidence Status',       'srs-internal', NULL, 'Where a piece of evidence is in its lifecycle', false),
  ('wellbeing-presenting-concern',      'Presenting Concern',              'srs-internal', NULL, 'Main concern on referral to mental-health support', true),
  ('wellbeing-mh-case-status',          'Mental Health Case Status',       'srs-internal', NULL, 'Where a mental-health case is in its lifecycle', false),
  ('wellbeing-risk-level',              'Risk Level',                      'srs-internal', NULL, 'Practitioner-assessed risk for a mental-health case', false),
  ('wellbeing-intervention-plan-type',  'Intervention Plan Type',          'srs-internal', NULL, 'Kind of support an intervention plan provides', true),
  ('wellbeing-intervention-plan-status','Intervention Plan Status',        'srs-internal', NULL, 'Where an intervention plan is in its lifecycle', false),
  ('wellbeing-session-frequency',       'Session Frequency',               'srs-internal', NULL, 'How often planned sessions take place', false),
  ('wellbeing-session-type',            'Session Type',                    'srs-internal', NULL, 'Kind of mental-health support session', false),
  ('wellbeing-alert-type',              'Early Warning Alert Type',        'srs-internal', NULL, 'What raised an early-warning alert', false),
  ('wellbeing-alert-source',            'Early Warning Alert Source',      'srs-internal', NULL, 'Where an early-warning alert came from', false),
  ('wellbeing-alert-triage-status',     'Early Warning Triage Status',     'srs-internal', NULL, 'Where an early-warning alert is in triage', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, NULL, NULL
FROM "value_set" vs,
(VALUES
  ('wellbeing-disability-support-type', 'dsa',            'Disabled Students'' Allowance', 10),
  ('wellbeing-disability-support-type', 'institutional',  'Institutional support',          20),
  ('wellbeing-disability-support-type', 'interim',        'Interim support',                30),
  ('wellbeing-disability-case-status', 'assessment_pending', 'Assessment pending', 10),
  ('wellbeing-disability-case-status', 'evidence_pending',   'Evidence pending',   20),
  ('wellbeing-disability-case-status', 'active',             'Active support',     30),
  ('wellbeing-disability-case-status', 'rejected',           'Not eligible',       40),
  ('wellbeing-disability-case-status', 'closed',             'Closed',             50),
  ('wellbeing-support-plan-status', 'none',    'No plan', 10),
  ('wellbeing-support-plan-status', 'draft',   'Draft',   20),
  ('wellbeing-support-plan-status', 'active',  'Active',  30),
  ('wellbeing-support-plan-status', 'expired', 'Expired', 40),
  ('wellbeing-dsa-entitlement-type', 'equipment',            'Equipment',               10),
  ('wellbeing-dsa-entitlement-type', 'support-worker',       'Support worker',          20),
  ('wellbeing-dsa-entitlement-type', 'non-medical-helper',   'Non-medical helper',      30),
  ('wellbeing-dsa-entitlement-type', 'specialist-mentoring', 'Specialist mentoring',    40),
  ('wellbeing-dsa-entitlement-type', 'other',                'Other',                   90),
  ('wellbeing-evidence-type', 'medical',            'Medical evidence',      10),
  ('wellbeing-evidence-type', 'assessment',         'Needs assessment',      20),
  ('wellbeing-evidence-type', 'personal-statement', 'Personal statement',    30),
  ('wellbeing-evidence-type', 'other',              'Other',                 90),
  ('wellbeing-evidence-status', 'pending',  'Awaited',  10),
  ('wellbeing-evidence-status', 'received', 'Received', 20),
  ('wellbeing-evidence-status', 'verified', 'Verified', 30),
  ('wellbeing-evidence-status', 'rejected', 'Rejected', 40),
  ('wellbeing-presenting-concern', 'anxiety',    'Anxiety',    10),
  ('wellbeing-presenting-concern', 'depression', 'Depression', 20),
  ('wellbeing-presenting-concern', 'crisis',     'Crisis',     30),
  ('wellbeing-presenting-concern', 'other',      'Other',      90),
  ('wellbeing-mh-case-status', 'referral_received',  'Referral received',  10),
  ('wellbeing-mh-case-status', 'assessment_pending', 'Assessment pending', 20),
  ('wellbeing-mh-case-status', 'active',             'Active',             30),
  ('wellbeing-mh-case-status', 'on_hold',            'On hold',            40),
  ('wellbeing-mh-case-status', 'discharged',         'Discharged',         50),
  ('wellbeing-mh-case-status', 'closed',             'Closed',             60),
  ('wellbeing-risk-level', 'low',    'Low',    10),
  ('wellbeing-risk-level', 'medium', 'Medium', 20),
  ('wellbeing-risk-level', 'high',   'High',   30),
  ('wellbeing-risk-level', 'crisis', 'Crisis', 40),
  ('wellbeing-intervention-plan-type', 'counselling',    'Counselling',    10),
  ('wellbeing-intervention-plan-type', 'crisis-support', 'Crisis support', 20),
  ('wellbeing-intervention-plan-type', 'signposting',    'Signposting',    30),
  ('wellbeing-intervention-plan-type', 'peer-support',   'Peer support',   40),
  ('wellbeing-intervention-plan-status', 'draft',        'Draft',        10),
  ('wellbeing-intervention-plan-status', 'active',       'Active',       20),
  ('wellbeing-intervention-plan-status', 'completed',    'Completed',    30),
  ('wellbeing-intervention-plan-status', 'discontinued', 'Discontinued', 40),
  ('wellbeing-session-frequency', 'weekly',      'Weekly',      10),
  ('wellbeing-session-frequency', 'fortnightly', 'Fortnightly', 20),
  ('wellbeing-session-frequency', 'monthly',     'Monthly',     30),
  ('wellbeing-session-frequency', 'ad-hoc',      'As needed',   40),
  ('wellbeing-session-type', 'individual', 'Individual', 10),
  ('wellbeing-session-type', 'group',      'Group',      20),
  ('wellbeing-session-type', 'telephone',  'Telephone',  30),
  ('wellbeing-session-type', 'crisis',     'Crisis',     40),
  ('wellbeing-session-type', 'assessment', 'Assessment', 50),
  ('wellbeing-alert-type', 'ukvi-compliance', 'UKVI compliance', 10),
  ('wellbeing-alert-type', 'tutor-concern',   'Tutor concern',   20),
  ('wellbeing-alert-type', 'staff-referral',  'Staff referral',  30),
  ('wellbeing-alert-source', 'ukvi',   'UKVI monitoring', 10),
  ('wellbeing-alert-source', 'tutor',  'Tutor',           20),
  ('wellbeing-alert-source', 'staff',  'Staff',           30),
  ('wellbeing-alert-source', 'system', 'System',          40),
  ('wellbeing-alert-triage-status', 'pending',   'Awaiting triage', 10),
  ('wellbeing-alert-triage-status', 'reviewed',  'Reviewed',        20),
  ('wellbeing-alert-triage-status', 'assigned',  'Assigned to case', 30),
  ('wellbeing-alert-triage-status', 'resolved',  'Resolved',        40),
  ('wellbeing-alert-triage-status', 'dismissed', 'Dismissed',       50)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('wellbeing.disability_support_case', 'support_type_code',        'wellbeing-disability-support-type', NULL),
  ('wellbeing.disability_support_case', 'status_code',              'wellbeing-disability-case-status', NULL),
  ('wellbeing.disability_support_case', 'support_plan_status_code', 'wellbeing-support-plan-status', NULL),
  ('wellbeing.dsa_entitlement',         'entitlement_type_code',    'wellbeing-dsa-entitlement-type', NULL),
  ('wellbeing.evidence_reference',      'evidence_type_code',       'wellbeing-evidence-type', NULL),
  ('wellbeing.evidence_reference',      'status_code',              'wellbeing-evidence-status', NULL),
  ('wellbeing.mental_health_case',      'presenting_concern_code',  'wellbeing-presenting-concern', NULL),
  ('wellbeing.mental_health_case',      'status_code',              'wellbeing-mh-case-status', NULL),
  ('wellbeing.mental_health_case',      'risk_level_code',          'wellbeing-risk-level', NULL),
  ('wellbeing.intervention_plan',       'plan_type_code',           'wellbeing-intervention-plan-type', NULL),
  ('wellbeing.intervention_plan',       'status_code',              'wellbeing-intervention-plan-status', NULL),
  ('wellbeing.intervention_plan',       'session_frequency_code',   'wellbeing-session-frequency', NULL),
  ('wellbeing.mh_session_note',         'session_type_code',        'wellbeing-session-type', NULL),
  ('wellbeing.early_warning_alert',     'alert_type_code',          'wellbeing-alert-type', NULL),
  ('wellbeing.early_warning_alert',     'alert_source_code',        'wellbeing-alert-source', NULL),
  ('wellbeing.early_warning_alert',     'triage_status_code',       'wellbeing-alert-triage-status', NULL)
ON CONFLICT DO NOTHING;

-- ── Email: the institution's mailbox and the fake mail server ───────────────
-- email_message is the SRS's own record of every email it sent or received.
-- Outbound mail goes through a transport; the only one shipped is the fake
-- mail server, whose store is email_simulator_message (what external
-- mailboxes "received", and what external senders sent in). Inbound mail
-- arrives through the provider hook, which the simulator also uses.
CREATE TABLE IF NOT EXISTS "email_message" (
  "id"                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                 uuid        NOT NULL REFERENCES "tenant"("id"),
  "direction_code"            text        NOT NULL CHECK ("direction_code" IN ('outbound', 'inbound')),
  "from_address"              text        NOT NULL,
  "to_address"                text        NOT NULL,
  "subject"                   text        NOT NULL,
  "body_text"                 text        NOT NULL,
  "person_id"                 uuid,
  "thread_id"                 uuid        NOT NULL,
  "in_reply_to_id"            uuid        REFERENCES "email_message"("id"),
  "communication_dispatch_id" uuid,
  "status_code"               text        NOT NULL CHECK ("status_code" IN ('sent', 'failed', 'received')),
  "failure_reason"            text,
  "transport_code"            text        NOT NULL,
  "transport_message_id"      text,
  "sent_by"                   text,
  "read_at"                   timestamptz,
  "read_by"                   text,
  "created_at"                timestamptz NOT NULL DEFAULT now(),
  CHECK (("direction_code" = 'inbound') = ("status_code" = 'received'))
);
CREATE INDEX IF NOT EXISTS "email_message_mailbox_idx" ON "email_message" ("tenant_id", "direction_code", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "email_message_person_idx" ON "email_message" ("tenant_id", "person_id");
CREATE INDEX IF NOT EXISTS "email_message_thread_idx" ON "email_message" ("tenant_id", "thread_id");
-- A provider retrying its inbound hook delivers the same Message-ID again.
CREATE UNIQUE INDEX IF NOT EXISTS "email_message_transport_id" ON "email_message" ("tenant_id", "transport_message_id") WHERE "transport_message_id" IS NOT NULL;
ALTER TABLE "email_message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_message" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "email_message";
CREATE POLICY tenant_isolation ON "email_message"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS "email_simulator_message" (
  "id"                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"              uuid        NOT NULL REFERENCES "tenant"("id"),
  "direction_code"         text        NOT NULL CHECK ("direction_code" IN ('to-external', 'to-institution')),
  "message_id"             text        NOT NULL,
  "from_address"           text        NOT NULL,
  "to_address"             text        NOT NULL,
  "subject"                text        NOT NULL,
  "body_text"              text        NOT NULL,
  "in_reply_to_message_id" text,
  "created_by"             text        NOT NULL,
  "created_at"             timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tenant_id", "message_id")
);
CREATE INDEX IF NOT EXISTS "email_simulator_message_to_idx" ON "email_simulator_message" ("tenant_id", "to_address");
CREATE INDEX IF NOT EXISTS "email_simulator_message_from_idx" ON "email_simulator_message" ("tenant_id", "from_address");
ALTER TABLE "email_simulator_message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_simulator_message" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "email_simulator_message";
CREATE POLICY tenant_isolation ON "email_simulator_message"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

-- ── Valid values: institutions relabel and hide platform values ─────────────
-- A platform value's code never changes, so records, returns and
-- integrations are unaffected; an override changes only the wording one
-- institution sees, or takes the value out of its pickers. A hidden value
-- still labels the records that hold it and still validates. Sets whose
-- values the system writes itself (lifecycle statuses) can be relabelled
-- but not hidden: allows_tenant_hide = false.
ALTER TABLE "value_set" ADD COLUMN IF NOT EXISTS "allows_tenant_hide" boolean NOT NULL DEFAULT true;
UPDATE "value_set" SET "allows_tenant_hide" = false WHERE "set_code" LIKE '%status%';

CREATE TABLE IF NOT EXISTS "value_set_member_override" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant"("id"),
  "value_set_member_id" uuid        NOT NULL REFERENCES "value_set_member"("id"),
  "display_label"       text,
  "description"         text,
  "hidden"              boolean     NOT NULL DEFAULT false,
  "updated_by"          text        NOT NULL,
  "updated_at"          timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tenant_id", "value_set_member_id"),
  CHECK ("display_label" IS NULL OR length(trim("display_label")) > 0)
);
ALTER TABLE "value_set_member_override" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "value_set_member_override" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "value_set_member_override";
CREATE POLICY tenant_isolation ON "value_set_member_override"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

-- ── Valid values: code sets for the coded fields that had none ─────────────
-- Every coded field a screen shows or offers now has a value set, so screens
-- show a label, never a bare code. Lifecycle sets the system writes are
-- relabel-only (allows_tenant_hide = false). Fields that hold identifiers
-- or references (period, intake, template, flow, currency, locale, workflow
-- and role codes) are not picklists and have no set.
INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible", "allows_tenant_hide")
VALUES
  ('admissions-offer-type-code', 'Offer Type', 'srs-internal', NULL, 'Kind of admissions offer', false, false),
  ('admissions-offer-status-code', 'Offer Status', 'srs-internal', NULL, 'Where an admissions offer is', false, false),
  ('offer-response-code', 'Offer Response', 'srs-internal', NULL, 'The applicant''s reply to an offer', false, false),
  ('offer-condition-status-code', 'Offer Condition Status', 'srs-internal', NULL, 'Whether an offer condition has been met', false, false),
  ('condition-match-outcome-code', 'Condition Match Outcome', 'srs-internal', NULL, 'How results compare with an offer condition', false, false),
  ('offer-confirmation-decision-code', 'Confirmation Decision', 'srs-internal', NULL, 'The decision when results arrive', false, false),
  ('application-status-code', 'Application Status', 'srs-internal', NULL, 'Where an application is', false, false),
  ('application-identity-match-code', 'Applicant Identity Match', 'srs-internal', NULL, 'Whether an applicant was matched to an existing person', false, false),
  ('application-routing-reason-code', 'Application Routing Reason', 'srs-internal', NULL, 'Why an application needs attention', false, false),
  ('application-recommendation-code', 'Admissions Recommendation', 'srs-internal', NULL, 'The assessor''s recommendation', false, false),
  ('reassessment-plan-status-code', 'Reassessment Plan Status', 'srs-internal', NULL, 'Where a reassessment plan is', false, false),
  ('award-recommendation-status-code', 'Award Recommendation Status', 'srs-internal', NULL, 'Where an award recommendation is', false, false),
  ('award-classification-code', 'Award Classification', 'srs-internal', NULL, 'Classification of an award', true, true),
  ('document-issue-status-code', 'Issued Document Status', 'srs-internal', NULL, 'Whether an issued document is still current', false, false),
  ('document-verification-outcome-code', 'Document Verification Outcome', 'srs-internal', NULL, 'The result of checking a document', false, false),
  ('document-verification-method-code', 'Verification Method', 'srs-internal', NULL, 'How a document was checked', false, false),
  ('document-signing-key-status-code', 'Signing Key Status', 'srs-internal', NULL, 'Whether a document signing key is in use', false, false),
  ('document-signing-provider-code', 'Signing Provider', 'srs-internal', NULL, 'Where a signing key is held', false, false),
  ('graduation-cycle-status-code', 'Graduation Cycle Status', 'srs-internal', NULL, 'Where a graduation cycle is', false, false),
  ('graduation-response-code', 'Graduation Response', 'srs-internal', NULL, 'A graduand''s reply to a ceremony invitation', false, true),
  ('ceremony-attendance-code', 'Ceremony Attendance', 'srs-internal', NULL, 'Whether an allocated graduand attended', false, false),
  ('curriculum-publication-status-code', 'Curriculum Publication Status', 'srs-internal', NULL, 'Where a curriculum publication is', false, false),
  ('curriculum-object-type-code', 'Curriculum Object Type', 'srs-internal', NULL, 'Kind of object in a curriculum publication', false, false),
  ('curriculum-change-type-code', 'Curriculum Change Type', 'srs-internal', NULL, 'What a publication does to an object', false, false),
  ('curriculum-binding-change-status-code', 'Curriculum Binding Change Status', 'srs-internal', NULL, 'Where a change to a student''s curriculum is', false, false),
  ('module-relationship-type-code', 'Module Relationship', 'srs-internal', NULL, 'How two modules relate', false, true),
  ('academic-period-type-code', 'Academic Period Type', 'srs-internal', NULL, 'Kind of teaching period', false, true),
  ('credit-framework-code', 'Credit Framework', 'srs-internal', NULL, 'The credit scheme a programme uses', true, true),
  ('delivery-mode-code', 'Delivery Mode', 'srs-internal', NULL, 'How a module offering is taught', true, true),
  ('recognised-credit-status-code', 'Recognised Credit Status', 'srs-internal', NULL, 'Where a credit recognition is', false, false),
  ('rule-exception-status-code', 'Rule Exception Status', 'srs-internal', NULL, 'Where a rule exception is', false, false),
  ('module-registration-status-code', 'Module Registration Status', 'srs-internal', NULL, 'Where a module registration is', false, false),
  ('allocation-run-status-code', 'Allocation Run Status', 'srs-internal', NULL, 'Where a module allocation run is', false, false),
  ('allocation-run-kind-code', 'Allocation Run Kind', 'srs-internal', NULL, 'Main or top-up allocation', false, false),
  ('allocation-outcome-code', 'Allocation Outcome', 'srs-internal', NULL, 'What allocation gave a choice', false, false),
  ('timetable-publication-status-code', 'Timetable Publication Status', 'srs-internal', NULL, 'Whether a timetable publication was applied', false, false),
  ('timetable-source-code', 'Timetable Source', 'srs-internal', NULL, 'Where a timetable came from', false, false),
  ('financial-status-code', 'Financial Status', 'srs-internal', NULL, 'Whether a student''s finances are arranged', false, false),
  ('fee-liability-status-code', 'Fee Liability Status', 'srs-internal', NULL, 'Whether a fee liability is current', false, false),
  ('financial-status-source-code', 'Financial Status Source', 'srs-internal', NULL, 'Who set a financial status', false, false),
  ('downstream-trigger-type-code', 'Downstream Notice Type', 'srs-internal', NULL, 'A notice sent after enrolment', false, false),
  ('downstream-trigger-status-code', 'Downstream Notice Status', 'srs-internal', NULL, 'Where an enrolment notice is', false, false),
  ('reenrolment-period-type-code', 'Registration Period Type', 'srs-internal', NULL, 'Initial or annual registration', false, false),
  ('reenrolment-confirmation-status-code', 'Registration Confirmation Status', 'srs-internal', NULL, 'Whether a student has registered for the year', false, false),
  ('reenrolment-channel-code', 'Registration Channel', 'srs-internal', NULL, 'How a student registered', false, false),
  ('identity-verification-status-code', 'Identity Verification Status', 'srs-internal', NULL, 'Where an identity check is', false, false),
  ('right-to-study-outcome-code', 'Right-to-Study Outcome', 'srs-internal', NULL, 'The outcome of a right-to-study check', false, false),
  ('student-status-case-status-code', 'Status Case Status', 'srs-internal', NULL, 'Where a student status case is', false, false),
  ('status-case-condition-status-code', 'Status Case Condition Status', 'srs-internal', NULL, 'Whether a status case condition is met', false, false),
  ('support-award-status-code', 'Support Award Status', 'srs-internal', NULL, 'Where a student support award is', false, false),
  ('support-instalment-status-code', 'Support Instalment Status', 'srs-internal', NULL, 'Where a support payment is', false, false),
  ('employment-link-source-code', 'Employment Link Source', 'srs-internal', NULL, 'Where a student employment link came from', false, false),
  ('ec-determination-status-code', 'EC Determination Status', 'srs-internal', NULL, 'Where a proposed EC outcome is', false, false),
  ('misconduct-case-status-code', 'Misconduct Case Status', 'srs-internal', NULL, 'Where a misconduct case is', false, false),
  ('selection-decision-authority-code', 'Selection Decision Authority', 'srs-internal', NULL, 'Who decided a module selection', false, false),
  ('ukvi-sponsor-outcome-code', 'Sponsor Decision Outcome', 'srs-internal', NULL, 'A UKVI sponsor reporting decision', false, false),
  ('ukvi-sponsor-decision-status-code', 'Sponsor Decision Status', 'srs-internal', NULL, 'Whether a sponsor decision is authorised', false, false),
  ('ukvi-evidence-quality-code', 'Engagement Evidence Quality', 'srs-internal', NULL, 'How reliable sponsor engagement evidence is', false, false),
  ('hesa-validation-source-code', 'Validation Source', 'srs-internal', NULL, 'Who produced a HESA validation report', false, false),
  ('regulatory-transform-code', 'Field Derivation', 'srs-internal', NULL, 'How a return field was produced', false, false),
  ('communication-channel-code', 'Communication Channel', 'srs-internal', NULL, 'How a communication is sent', false, false),
  ('communication-dispatch-status-code', 'Dispatch Status', 'srs-internal', NULL, 'What happened to a communication', false, false),
  ('email-direction-code', 'Email Direction', 'srs-internal', NULL, 'Sent or received', false, false),
  ('email-status-code', 'Email Status', 'srs-internal', NULL, 'What happened to an email', false, false),
  ('email-simulator-direction-code', 'Fake Mail Direction', 'srs-internal', NULL, 'Which way mail went through the fake mail server', false, false),
  ('delivery-item-status-code', 'Delivery Status', 'srs-internal', NULL, 'Where a hand-off to another system is', false, false),
  ('exam-board-role-code', 'Exam Board Role', 'srs-internal', NULL, 'A member''s role at a board meeting', true, true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, NULL, NULL
FROM "value_set" vs,
(VALUES
  ('admissions-offer-type-code', 'conditional', 'Conditional', 10),
  ('admissions-offer-type-code', 'unconditional', 'Unconditional', 20),
  ('admissions-offer-type-code', 'clearing-verbal', 'Clearing verbal offer', 30),
  ('admissions-offer-status-code', 'made', 'Made', 10),
  ('admissions-offer-status-code', 'accepted', 'Accepted', 20),
  ('admissions-offer-status-code', 'declined', 'Declined', 30),
  ('admissions-offer-status-code', 'withdrawn', 'Withdrawn', 40),
  ('admissions-offer-status-code', 'expired', 'Expired', 50),
  ('admissions-offer-status-code', 'superseded', 'Superseded', 60),
  ('admissions-offer-status-code', 'confirmed', 'Confirmed', 70),
  ('admissions-offer-status-code', 'unsuccessful', 'Unsuccessful', 80),
  ('offer-response-code', 'accept', 'Accepted', 10),
  ('offer-response-code', 'decline', 'Declined', 20),
  ('offer-condition-status-code', 'pending', 'Pending', 10),
  ('offer-condition-status-code', 'met', 'Met', 20),
  ('offer-condition-status-code', 'waived', 'Waived', 30),
  ('offer-condition-status-code', 'unmet', 'Not met', 40),
  ('condition-match-outcome-code', 'meets', 'Results meet this', 10),
  ('condition-match-outcome-code', 'below', 'Results fall below this', 20),
  ('condition-match-outcome-code', 'needs-review', 'Check against the results', 30),
  ('offer-confirmation-decision-code', 'confirmed', 'Confirmed', 10),
  ('offer-confirmation-decision-code', 'confirmed-alternative', 'Confirmed on an alternative course', 20),
  ('offer-confirmation-decision-code', 'unsuccessful', 'Unsuccessful', 30),
  ('application-status-code', 'received', 'Received', 10),
  ('application-status-code', 'incomplete', 'Incomplete', 20),
  ('application-status-code', 'under-assessment', 'Under assessment', 30),
  ('application-status-code', 'recommended', 'Recommended', 40),
  ('application-status-code', 'rejected', 'Rejected', 50),
  ('application-status-code', 'offered', 'Offered', 60),
  ('application-status-code', 'withdrawn', 'Withdrawn', 70),
  ('application-identity-match-code', 'matched', 'Matched to an existing person', 10),
  ('application-identity-match-code', 'created', 'New person created', 20),
  ('application-identity-match-code', 'needs-review', 'Identity to confirm', 30),
  ('application-routing-reason-code', 'identity', 'Identity to confirm', 10),
  ('application-routing-reason-code', 'incomplete', 'Incomplete', 20),
  ('application-routing-reason-code', 'duplicate', 'Possible duplicate', 30),
  ('application-routing-reason-code', 'restricted', 'Restricted', 40),
  ('application-recommendation-code', 'offer', 'Make an offer', 10),
  ('application-recommendation-code', 'reject', 'Reject', 20),
  ('reassessment-plan-status-code', 'planned', 'Planned', 10),
  ('reassessment-plan-status-code', 'completed', 'Completed', 20),
  ('reassessment-plan-status-code', 'expired', 'Expired', 30),
  ('reassessment-plan-status-code', 'cancelled', 'Cancelled', 40),
  ('award-recommendation-status-code', 'recommended', 'Recommended', 10),
  ('award-recommendation-status-code', 'conferred', 'Conferred', 20),
  ('award-recommendation-status-code', 'withdrawn', 'Withdrawn', 30),
  ('award-classification-code', 'first', 'First class honours', 10),
  ('award-classification-code', 'upper-second', 'Upper second class honours (2:1)', 20),
  ('award-classification-code', 'lower-second', 'Lower second class honours (2:2)', 30),
  ('award-classification-code', 'third', 'Third class honours', 40),
  ('award-classification-code', 'distinction', 'Distinction', 50),
  ('award-classification-code', 'merit', 'Merit', 60),
  ('award-classification-code', 'pass', 'Pass', 70),
  ('document-issue-status-code', 'issued', 'Issued', 10),
  ('document-issue-status-code', 'superseded', 'Superseded', 20),
  ('document-issue-status-code', 'revoked', 'Revoked', 30),
  ('document-verification-outcome-code', 'valid', 'Genuine and current', 10),
  ('document-verification-outcome-code', 'revoked', 'Revoked', 20),
  ('document-verification-outcome-code', 'superseded', 'Superseded by a newer document', 30),
  ('document-verification-outcome-code', 'not-found', 'Not found', 40),
  ('document-verification-method-code', 'code', 'Verification code', 10),
  ('document-verification-method-code', 'file', 'Uploaded file', 20),
  ('document-verification-method-code', 'staff-lookup', 'Looked up by staff', 30),
  ('document-signing-key-status-code', 'active', 'Active', 10),
  ('document-signing-key-status-code', 'retired', 'Retired', 20),
  ('document-signing-key-status-code', 'compromised', 'Compromised', 30),
  ('document-signing-provider-code', 'local-key', 'Local key', 10),
  ('document-signing-provider-code', 'openbao-transit', 'OpenBao Transit', 20),
  ('graduation-cycle-status-code', 'open', 'Open', 10),
  ('graduation-cycle-status-code', 'frozen', 'Frozen', 20),
  ('graduation-cycle-status-code', 'closed', 'Closed', 30),
  ('graduation-response-code', 'invited', 'No reply yet', 10),
  ('graduation-response-code', 'attending', 'Attending', 20),
  ('graduation-response-code', 'in-absentia', 'In absentia', 30),
  ('graduation-response-code', 'deferred', 'Deferred', 40),
  ('graduation-response-code', 'declined', 'Declined', 50),
  ('ceremony-attendance-code', 'allocated', 'Allocated', 10),
  ('ceremony-attendance-code', 'attended', 'Attended', 20),
  ('ceremony-attendance-code', 'absent', 'Absent', 30),
  ('curriculum-publication-status-code', 'validated', 'Ready to apply', 10),
  ('curriculum-publication-status-code', 'rejected', 'Rejected', 20),
  ('curriculum-publication-status-code', 'applied', 'Applied', 30),
  ('curriculum-object-type-code', 'programme', 'Programme', 10),
  ('curriculum-object-type-code', 'module', 'Module', 20),
  ('curriculum-object-type-code', 'route', 'Route', 30),
  ('curriculum-object-type-code', 'rule-set', 'Rule set', 40),
  ('curriculum-object-type-code', 'module-group', 'Module group', 50),
  ('curriculum-object-type-code', 'module-group-member', 'Group member', 60),
  ('curriculum-object-type-code', 'learning-outcome', 'Learning outcome', 70),
  ('curriculum-object-type-code', 'module-offering', 'Module offering', 80),
  ('curriculum-change-type-code', 'add', 'Added', 10),
  ('curriculum-change-type-code', 'change', 'Changed', 20),
  ('curriculum-change-type-code', 'close', 'Closed', 30),
  ('curriculum-change-type-code', 'unchanged', 'Unchanged', 40),
  ('curriculum-change-type-code', 'invalid', 'Invalid', 50),
  ('curriculum-binding-change-status-code', 'proposed', 'Proposed', 10),
  ('curriculum-binding-change-status-code', 'approved', 'Approved', 20),
  ('curriculum-binding-change-status-code', 'rejected', 'Rejected', 30),
  ('curriculum-binding-change-status-code', 'applied-directly', 'Applied directly', 40),
  ('module-relationship-type-code', 'prerequisite', 'Prerequisite', 10),
  ('module-relationship-type-code', 'co-requisite', 'Co-requisite', 20),
  ('module-relationship-type-code', 'exclusion', 'Exclusion', 30),
  ('academic-period-type-code', 'semester', 'Semester', 10),
  ('academic-period-type-code', 'term', 'Term', 20),
  ('academic-period-type-code', 'year', 'Full year', 30),
  ('credit-framework-code', 'cats', 'CATS (UK credit)', 10),
  ('credit-framework-code', 'ects', 'ECTS (European credit)', 20),
  ('credit-framework-code', 'institutional', 'Institutional scheme', 30),
  ('delivery-mode-code', 'in-person', 'In person', 10),
  ('delivery-mode-code', 'online', 'Online', 20),
  ('delivery-mode-code', 'blended', 'Blended', 30),
  ('recognised-credit-status-code', 'proposed', 'Proposed', 10),
  ('recognised-credit-status-code', 'approved', 'Approved', 20),
  ('recognised-credit-status-code', 'rejected', 'Rejected', 30),
  ('rule-exception-status-code', 'proposed', 'Proposed', 10),
  ('rule-exception-status-code', 'approved', 'Approved', 20),
  ('rule-exception-status-code', 'rejected', 'Rejected', 30),
  ('rule-exception-status-code', 'revoked', 'Revoked', 40),
  ('module-registration-status-code', 'registered', 'Registered', 10),
  ('module-registration-status-code', 'withdrawn', 'Withdrawn', 20),
  ('module-registration-status-code', 'completed', 'Completed', 30),
  ('allocation-run-status-code', 'previewed', 'Preview', 10),
  ('allocation-run-status-code', 'submitted', 'Awaiting approval', 20),
  ('allocation-run-status-code', 'approved', 'Approved', 30),
  ('allocation-run-status-code', 'applied', 'Applied', 40),
  ('allocation-run-status-code', 'superseded', 'Superseded', 50),
  ('allocation-run-status-code', 'rejected', 'Rejected', 60),
  ('allocation-run-kind-code', 'main', 'Main allocation', 10),
  ('allocation-run-kind-code', 'top-up', 'Top-up allocation', 20),
  ('allocation-outcome-code', 'allocated', 'Allocated', 10),
  ('allocation-outcome-code', 'unallocated', 'Not allocated', 20),
  ('allocation-outcome-code', 'fixed', 'Fixed', 30),
  ('timetable-publication-status-code', 'applied', 'Applied', 10),
  ('timetable-publication-status-code', 'rejected', 'Rejected', 20),
  ('timetable-source-code', 'ttb', 'Timetabling system', 10),
  ('timetable-source-code', 'srs-admin', 'Entered by registry', 20),
  ('timetable-source-code', 'simulator', 'Simulator', 30),
  ('financial-status-code', 'pending', 'Not yet arranged', 10),
  ('financial-status-code', 'arranged', 'Arranged', 20),
  ('financial-status-code', 'hold', 'On hold', 30),
  ('financial-status-code', 'not-required', 'Not required', 40),
  ('fee-liability-status-code', 'generated', 'Current', 10),
  ('fee-liability-status-code', 'superseded', 'Superseded', 20),
  ('fee-liability-status-code', 'cancelled', 'Cancelled', 30),
  ('financial-status-source-code', 'finance', 'Finance system', 10),
  ('financial-status-source-code', 'slc', 'Student Loans Company', 20),
  ('financial-status-source-code', 'manual', 'Recorded by staff', 30),
  ('downstream-trigger-type-code', 'ucas-confirmation', 'UCAS confirmation', 10),
  ('downstream-trigger-type-code', 'slc-confirmation', 'SLC attendance confirmation', 20),
  ('downstream-trigger-type-code', 'ukvi-cas', 'UKVI CAS', 30),
  ('downstream-trigger-status-code', 'pending', 'Pending', 10),
  ('downstream-trigger-status-code', 'sent', 'Sent', 20),
  ('downstream-trigger-status-code', 'processed', 'Processed', 30),
  ('downstream-trigger-status-code', 'acknowledged', 'Acknowledged', 40),
  ('downstream-trigger-status-code', 'failed', 'Failed', 50),
  ('downstream-trigger-status-code', 'cancelled', 'Cancelled', 60),
  ('reenrolment-period-type-code', 'initial', 'Initial registration', 10),
  ('reenrolment-period-type-code', 'annual', 'Annual re-registration', 20),
  ('reenrolment-confirmation-status-code', 'pending', 'Not yet registered', 10),
  ('reenrolment-confirmation-status-code', 'confirmed', 'Registered', 20),
  ('reenrolment-confirmation-status-code', 'lapsed', 'Lapsed', 30),
  ('reenrolment-channel-code', 'portal', 'Self-service portal', 10),
  ('reenrolment-channel-code', 'assisted', 'Assisted by staff', 20),
  ('identity-verification-status-code', 'requested', 'Requested', 10),
  ('identity-verification-status-code', 'verified', 'Verified', 20),
  ('identity-verification-status-code', 'failed', 'Failed', 30),
  ('identity-verification-status-code', 'fraud-flagged', 'Flagged for fraud', 40),
  ('right-to-study-outcome-code', 'pending', 'Waiting for a check', 10),
  ('right-to-study-outcome-code', 'eligible', 'Eligible', 20),
  ('right-to-study-outcome-code', 'not-eligible', 'Not eligible', 30),
  ('right-to-study-outcome-code', 'referred', 'Referred to a regulatory officer', 40),
  ('right-to-study-outcome-code', 'recheck-required', 'Recheck needed', 50),
  ('student-status-case-status-code', 'requested', 'Requested', 10),
  ('student-status-case-status-code', 'approved', 'Approved', 20),
  ('student-status-case-status-code', 'rejected', 'Rejected', 30),
  ('student-status-case-status-code', 'withdrawn', 'Withdrawn', 40),
  ('status-case-condition-status-code', 'open', 'Open', 10),
  ('status-case-condition-status-code', 'met', 'Met', 20),
  ('status-case-condition-status-code', 'waived', 'Waived', 30),
  ('support-award-status-code', 'draft', 'Draft', 10),
  ('support-award-status-code', 'approved', 'Approved', 20),
  ('support-award-status-code', 'suspended', 'Suspended', 30),
  ('support-award-status-code', 'ended', 'Ended', 40),
  ('support-instalment-status-code', 'planned', 'Planned', 10),
  ('support-instalment-status-code', 'approved', 'Approved', 20),
  ('support-instalment-status-code', 'paid', 'Paid', 30),
  ('support-instalment-status-code', 'rejected', 'Rejected', 40),
  ('support-instalment-status-code', 'cancelled', 'Cancelled', 50),
  ('employment-link-source-code', 'connector', 'HR system', 10),
  ('employment-link-source-code', 'person', 'Declared by the student', 20),
  ('ec-determination-status-code', 'proposed', 'Proposed', 10),
  ('ec-determination-status-code', 'upheld', 'Upheld', 20),
  ('ec-determination-status-code', 'not-upheld', 'Not upheld', 30),
  ('misconduct-case-status-code', 'open', 'Open', 10),
  ('misconduct-case-status-code', 'closed', 'Closed', 20),
  ('misconduct-case-status-code', 'withdrawn', 'Withdrawn', 30),
  ('selection-decision-authority-code', 'automatic', 'Automatic', 10),
  ('selection-decision-authority-code', 'registry-administrator', 'Registry', 20),
  ('selection-decision-authority-code', 'programme-approver', 'Programme approver', 30),
  ('selection-decision-authority-code', 'allocation', 'Allocation run', 40),
  ('ukvi-sponsor-outcome-code', 'report', 'Report to UKVI', 10),
  ('ukvi-sponsor-outcome-code', 'no-report', 'No report', 20),
  ('ukvi-sponsor-outcome-code', 'further-review', 'Further review', 30),
  ('ukvi-sponsor-decision-status-code', 'pending-authorisation', 'Awaiting authorisation', 10),
  ('ukvi-sponsor-decision-status-code', 'authorised', 'Authorised', 20),
  ('ukvi-evidence-quality-code', 'verified', 'Verified', 10),
  ('ukvi-evidence-quality-code', 'reconciliation-required', 'Needs reconciling', 20),
  ('hesa-validation-source-code', 'internal', 'Our checks', 10),
  ('hesa-validation-source-code', 'hesa-authority', 'HESA', 20),
  ('regulatory-transform-code', 'identity', 'Copied as recorded', 10),
  ('regulatory-transform-code', 'derived', 'Derived', 20),
  ('regulatory-transform-code', 'aggregated', 'Aggregated', 30),
  ('communication-channel-code', 'email', 'Email', 10),
  ('communication-channel-code', 'crm-handoff', 'CRM hand-off', 20),
  ('communication-channel-code', 'integration-event', 'Integration event', 30),
  ('communication-dispatch-status-code', 'dispatched', 'Sent', 10),
  ('communication-dispatch-status-code', 'suppressed', 'Not sent: channel off', 20),
  ('communication-dispatch-status-code', 'failed', 'Failed', 30),
  ('email-direction-code', 'outbound', 'Sent', 10),
  ('email-direction-code', 'inbound', 'Received', 20),
  ('email-status-code', 'sent', 'Sent', 10),
  ('email-status-code', 'failed', 'Not delivered', 20),
  ('email-status-code', 'received', 'Received', 30),
  ('email-simulator-direction-code', 'to-external', 'Delivered to an external mailbox', 10),
  ('email-simulator-direction-code', 'to-institution', 'Sent to the institution', 20),
  ('delivery-item-status-code', 'pending', 'Waiting', 10),
  ('delivery-item-status-code', 'delivered', 'Delivered', 20),
  ('delivery-item-status-code', 'failed', 'Could not deliver', 30),
  ('delivery-item-status-code', 'superseded', 'Superseded', 40),
  ('exam-board-role-code', 'chair', 'Chair', 10),
  ('exam-board-role-code', 'member', 'Member', 20),
  ('exam-board-role-code', 'external-examiner', 'External examiner', 30),
  ('exam-board-role-code', 'secretary', 'Secretary', 40),
  ('exam-board-role-code', 'observer', 'Observer', 50)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('admissions_offer', 'offer_type_code', 'admissions-offer-type-code', NULL),
  ('admissions_offer', 'status_code', 'admissions-offer-status-code', NULL),
  ('admissions_offer', 'response_code', 'offer-response-code', NULL),
  ('offer_condition', 'status_code', 'offer-condition-status-code', NULL),
  ('condition_evidence', 'match_outcome_code', 'condition-match-outcome-code', NULL),
  ('offer_confirmation_decision', 'decision_code', 'offer-confirmation-decision-code', NULL),
  ('student_application', 'status_code', 'application-status-code', NULL),
  ('student_application', 'identity_match_code', 'application-identity-match-code', NULL),
  ('student_application', 'routing_reason_code', 'application-routing-reason-code', NULL),
  ('student_application', 'recommendation_code', 'application-recommendation-code', NULL),
  ('reassessment_plan', 'status_code', 'reassessment-plan-status-code', NULL),
  ('award_recommendation', 'status_code', 'award-recommendation-status-code', NULL),
  ('award', 'classification_code', 'award-classification-code', NULL),
  ('award_recommendation', 'classification_code', 'award-classification-code', NULL),
  ('award_recommendation', 'calculated_classification_code', 'award-classification-code', NULL),
  ('award_calculation_evidence', 'classification_code', 'award-classification-code', NULL),
  ('document_issue', 'status_code', 'document-issue-status-code', NULL),
  ('document_verification', 'outcome_code', 'document-verification-outcome-code', NULL),
  ('document_verification', 'method_code', 'document-verification-method-code', NULL),
  ('document_signing_key', 'status_code', 'document-signing-key-status-code', NULL),
  ('document_signing_key', 'provider_code', 'document-signing-provider-code', NULL),
  ('graduation_cycle', 'status_code', 'graduation-cycle-status-code', NULL),
  ('graduation_invitation', 'response_code', 'graduation-response-code', NULL),
  ('ceremony_allocation', 'attendance_code', 'ceremony-attendance-code', NULL),
  ('curriculum_publication', 'status_code', 'curriculum-publication-status-code', NULL),
  ('curriculum_publication_item', 'object_type_code', 'curriculum-object-type-code', NULL),
  ('curriculum_publication_item', 'change_type_code', 'curriculum-change-type-code', NULL),
  ('curriculum_binding_change', 'status_code', 'curriculum-binding-change-status-code', NULL),
  ('module_relationship', 'relationship_type_code', 'module-relationship-type-code', NULL),
  ('academic_period', 'period_type_code', 'academic-period-type-code', NULL),
  ('programme', 'credit_framework_code', 'credit-framework-code', NULL),
  ('module_offering', 'delivery_mode_code', 'delivery-mode-code', NULL),
  ('recognised_credit', 'status_code', 'recognised-credit-status-code', NULL),
  ('rule_exception', 'status_code', 'rule-exception-status-code', NULL),
  ('module_registration', 'status_code', 'module-registration-status-code', NULL),
  ('module_allocation_run', 'status_code', 'allocation-run-status-code', NULL),
  ('module_allocation_run', 'kind_code', 'allocation-run-kind-code', NULL),
  ('module_allocation_result', 'outcome_code', 'allocation-outcome-code', NULL),
  ('timetable_publication', 'status_code', 'timetable-publication-status-code', NULL),
  ('timetable_publication', 'source_system_code', 'timetable-source-code', NULL),
  ('fee_liability', 'financial_status_code', 'financial-status-code', NULL),
  ('fee_liability', 'status_code', 'fee-liability-status-code', NULL),
  ('fee_liability', 'status_source_code', 'financial-status-source-code', NULL),
  ('enrolment_downstream_trigger', 'trigger_type_code', 'downstream-trigger-type-code', NULL),
  ('enrolment_downstream_trigger', 'status_code', 'downstream-trigger-status-code', NULL),
  ('reenrolment_period', 'period_type_code', 'reenrolment-period-type-code', NULL),
  ('reenrolment_confirmation', 'status_code', 'reenrolment-confirmation-status-code', NULL),
  ('reenrolment_confirmation', 'channel_code', 'reenrolment-channel-code', NULL),
  ('identity_verification_check', 'status_code', 'identity-verification-status-code', NULL),
  ('right_to_study_check', 'outcome_code', 'right-to-study-outcome-code', NULL),
  ('student_status_case', 'status_code', 'student-status-case-status-code', NULL),
  ('status_case_condition', 'status_code', 'status-case-condition-status-code', NULL),
  ('support_award', 'status_code', 'support-award-status-code', NULL),
  ('support_instalment', 'status_code', 'support-instalment-status-code', NULL),
  ('student_employment_link', 'source_code', 'employment-link-source-code', NULL),
  ('ec_determination', 'status_code', 'ec-determination-status-code', NULL),
  ('misconduct_case_reference', 'case_status_code', 'misconduct-case-status-code', NULL),
  ('module_selection_proposal', 'decision_authority_code', 'selection-decision-authority-code', NULL),
  ('ukvi_sponsor_decision', 'outcome_code', 'ukvi-sponsor-outcome-code', NULL),
  ('ukvi_sponsor_decision', 'status_code', 'ukvi-sponsor-decision-status-code', NULL),
  ('ukvi_engagement_evidence_snapshot', 'evidence_quality_code', 'ukvi-evidence-quality-code', NULL),
  ('hesa_validation_report', 'source_code', 'hesa-validation-source-code', NULL),
  ('regulatory_field_lineage', 'transform_code', 'regulatory-transform-code', NULL),
  ('communication_template', 'channel_code', 'communication-channel-code', NULL),
  ('communication_dispatch_log', 'channel_code', 'communication-channel-code', NULL),
  ('communication_dispatch_log', 'status_code', 'communication-dispatch-status-code', NULL),
  ('email_message', 'direction_code', 'email-direction-code', NULL),
  ('email_message', 'status_code', 'email-status-code', NULL),
  ('email_simulator_message', 'direction_code', 'email-simulator-direction-code', NULL),
  ('delivery_item', 'status_code', 'delivery-item-status-code', NULL),
  ('exam_board_member_attendance', 'role_code', 'exam-board-role-code', NULL),
  ('admissions_offer', 'mode_of_study_code', 'mode-of-study-code', NULL),
  ('student_application', 'mode_of_study_code', 'mode-of-study-code', NULL),
  ('student_status_case', 'destination_mode_of_study_code', 'mode-of-study-code', NULL),
  ('fee_liability', 'fee_band_code', 'fee-band-code', NULL),
  ('fee_liability', 'funding_source_code', 'funding-source-code', NULL),
  ('fee_liability', 'fee_status_code', 'fee-status-code', NULL),
  ('enrolment_status_transition', 'from_status_code', 'enrolment-status-code', NULL),
  ('enrolment_status_transition', 'to_status_code', 'enrolment-status-code', NULL),
  ('delivery_item', 'fulfilment_mode_code', 'distribution-fulfilment-mode-code', NULL),
  ('adjustment_distribution', 'fulfilment_mode_code', 'distribution-fulfilment-mode-code', NULL),
  ('ec_determination', 'proposed_outcome_code', 'ec-outcome-code', NULL),
  ('curriculum_binding_change', 'change_reason_code', 'curriculum-binding-change-reason-code', NULL),
  ('progression_calculation_evidence', 'decision_code', 'decision-code', NULL),
  ('feature_flag', 'flag_class_code', 'feature-flag-class', NULL),
  ('feature_flag', 'risk_class_code', 'feature-flag-risk-class', NULL)
ON CONFLICT DO NOTHING;

-- Logical fields: a value held in a shared column (case_decision.decision_type_code)
-- whose valid values depend on the kind of case. Screens label them through these.
INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('pgr_progress_review', 'outcome_code', 'pgr-review-outcome-code', 'The progress review decision, held in case_decision.decision_type_code')
ON CONFLICT DO NOTHING;

-- Wellbeing reasonable-adjustment cases (the wellbeing module's tables) and
-- PGR supervision decisions.
INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible", "allows_tenant_hide")
VALUES
  ('wellbeing-adjustment-case-status', 'Adjustment Case Status', 'srs-internal', NULL, 'Where a reasonable-adjustment case is', false, false),
  ('wellbeing-adjustment-case-type', 'Adjustment Need', 'srs-internal', NULL, 'The kind of adjustment a referral asks for', true, true),
  ('wellbeing-assessment-outcome', 'Adjustment Assessment Outcome', 'srs-internal', NULL, 'A specialist assessor''s finding', false, false),
  ('wellbeing-panel-decision', 'Adjustment Panel Decision', 'srs-internal', NULL, 'The panel''s decision on a recommendation', false, false),
  ('wellbeing-adjustment-evidence-type', 'Adjustment Evidence Type', 'srs-internal', NULL, 'Kind of evidence attached to an adjustment case', true, true),
  ('pgr-supervision-decision-code', 'Supervision Decision', 'srs-internal', NULL, 'The decision on a supervisory team', false, false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, NULL, NULL
FROM "value_set" vs,
(VALUES
  ('wellbeing-adjustment-case-status', 'referral_received',  'Referral received',    10),
  ('wellbeing-adjustment-case-status', 'assessment_pending', 'Assessment pending',   20),
  ('wellbeing-adjustment-case-status', 'under_assessment',   'Under assessment',     30),
  ('wellbeing-adjustment-case-status', 'determination_made', 'Determination made',   40),
  ('wellbeing-adjustment-case-status', 'under_review',       'Under review (panel)', 50),
  ('wellbeing-adjustment-case-status', 'approved',           'Approved',             60),
  ('wellbeing-adjustment-case-status', 'rejected',           'Rejected',             70),
  ('wellbeing-adjustment-case-status', 'review_complete',    'Review complete',      80),
  ('wellbeing-adjustment-case-status', 'closed',             'Closed',               90),
  ('wellbeing-adjustment-case-type', 'exam-time',  'Exam time',  10),
  ('wellbeing-adjustment-case-type', 'venue',      'Venue',      20),
  ('wellbeing-adjustment-case-type', 'coursework', 'Coursework', 30),
  ('wellbeing-adjustment-case-type', 'placement',  'Placement',  40),
  ('wellbeing-adjustment-case-type', 'other',      'Other',      90),
  ('wellbeing-assessment-outcome', 'recommended',       'Recommended',     10),
  ('wellbeing-assessment-outcome', 'not-recommended',   'Not recommended', 20),
  ('wellbeing-assessment-outcome', 'deferred',          'Deferred',        30),
  ('wellbeing-assessment-outcome', 'referred-to-panel', 'Refer to panel',  40),
  ('wellbeing-panel-decision', 'upheld',   'Upheld',   10),
  ('wellbeing-panel-decision', 'modified', 'Modified', 20),
  ('wellbeing-panel-decision', 'rejected', 'Rejected', 30),
  ('wellbeing-adjustment-evidence-type', 'medical-letter',   'Medical letter',   10),
  ('wellbeing-adjustment-evidence-type', 'assessor-report',  'Assessor report',  20),
  ('wellbeing-adjustment-evidence-type', 'dsa-award-letter', 'DSA award letter', 30),
  ('wellbeing-adjustment-evidence-type', 'other',            'Other',            90),
  ('pgr-supervision-decision-code', 'approve', 'Approve', 10),
  ('pgr-supervision-decision-code', 'return',  'Return',  20),
  ('pgr-supervision-decision-code', 'reject',  'Reject',  30)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('wellbeing.adjustment_case',          'status_code',          'wellbeing-adjustment-case-status', NULL),
  ('wellbeing.adjustment_case',          'adjustment_type_code', 'wellbeing-adjustment-case-type', NULL),
  ('wellbeing.adjustment_assessment',    'outcome_code',         'wellbeing-assessment-outcome', NULL),
  ('wellbeing.adjustment_panel_decision','decision_code',        'wellbeing-panel-decision', NULL),
  ('wellbeing.adjustment_case_evidence', 'evidence_type_code',   'wellbeing-adjustment-evidence-type', NULL),
  ('pgr_supervision_case',               'decision_code',        'pgr-supervision-decision-code', 'The supervision decision, held in case_decision.decision_type_code')
ON CONFLICT DO NOTHING;

-- Staff and system roles, so workflow steps, tasks and assignment rules show a
-- role's name. The codes are the platform's roles: relabel only.
INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible", "allows_tenant_hide")
VALUES ('srs-role-code', 'Role', 'srs-internal', NULL, 'A staff, student or system role', false, false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, NULL, NULL
FROM "value_set" vs,
(VALUES
  ('srs-role-code', 'student', 'Student', 10),
  ('srs-role-code', 'applicant', 'Applicant', 20),
  ('srs-role-code', 'module-tutor', 'Module tutor', 30),
  ('srs-role-code', 'personal-tutor', 'Personal tutor', 40),
  ('srs-role-code', 'engagement-officer', 'Engagement officer', 50),
  ('srs-role-code', 'research-supervisor', 'Research supervisor', 60),
  ('srs-role-code', 'wellbeing-advisor', 'Wellbeing advisor', 70),
  ('srs-role-code', 'wellbeing-mental-health-advisor', 'Mental health advisor', 80),
  ('srs-role-code', 'wellbeing-specialist-assessor', 'Specialist assessor', 90),
  ('srs-role-code', 'wellbeing-panel-chair', 'Wellbeing panel chair', 100),
  ('srs-role-code', 'wellbeing-auditor', 'Wellbeing auditor', 110),
  ('srs-role-code', 'exam-board-member', 'Exam board member', 120),
  ('srs-role-code', 'exam-board-chair', 'Exam board chair', 130),
  ('srs-role-code', 'external-examiner', 'External examiner', 140),
  ('srs-role-code', 'integrity-officer', 'Academic integrity officer', 150),
  ('srs-role-code', 'registry-administrator', 'Registry administrator', 160),
  ('srs-role-code', 'regulatory-officer', 'Regulatory officer', 170),
  ('srs-role-code', 'finance-administrator', 'Finance administrator', 180),
  ('srs-role-code', 'dpo', 'Data protection officer', 190),
  ('srs-role-code', 'tenant-administrator', 'Tenant administrator', 200),
  ('srs-role-code', 'system-administrator', 'System administrator', 210),
  ('srs-role-code', 'integration-service', 'Integration service', 220),
  ('srs-role-code', 'programme-approver', 'Programme approver', 230),
  ('srs-role-code', 'pgr-administrator', 'PGR administrator', 240),
  ('srs-role-code', 'pgr-director', 'PGR director', 250),
  ('srs-role-code', 'pgr-examiner', 'PGR examiner', 260)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('workflow_step',            'owner_role_code',     'srs-role-code', NULL),
  ('workflow_task',            'assignee_role_code',  'srs-role-code', NULL),
  ('workflow_assignment_rule', 'assignee_role_code',  'srs-role-code', NULL),
  ('workflow_assignment_rule', 'role_code',           'srs-role-code', NULL),
  ('feature_flag_assignment',  'role_code',           'srs-role-code', NULL)
ON CONFLICT DO NOTHING;

-- Attendance and engagement (the attendance module's tables). Their mappings
-- were removed in 0003 when the tables moved to the module; screens label
-- them through these schema-qualified entities.
INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible", "allows_tenant_hide")
VALUES
  ('engagement-alert-severity-code', 'Engagement Alert Severity', 'srs-internal', NULL, 'How serious an engagement alert is', false, false),
  ('engagement-policy-status-code', 'Engagement Policy Status', 'srs-internal', NULL, 'Whether an engagement policy version is approved', false, false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, NULL, NULL
FROM "value_set" vs,
(VALUES
  ('engagement-alert-severity-code', 'low',    'Low',    10),
  ('engagement-alert-severity-code', 'medium', 'Medium', 20),
  ('engagement-alert-severity-code', 'high',   'High',   30),
  ('engagement-policy-status-code', 'draft',    'Draft',    10),
  ('engagement-policy-status-code', 'approved', 'Approved', 20)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('attendance.expected_engagement_event',    'activity_type_code',  'engagement-activity-type-code', NULL),
  ('attendance.expected_engagement_event',    'event_mode_code',     'engagement-event-mode-code', NULL),
  ('attendance.engagement_observation',       'capture_method_code', 'engagement-capture-method-code', NULL),
  ('attendance.engagement_observation',       'outcome_code',        'engagement-observation-outcome-code', NULL),
  ('attendance.engagement_observation',       'data_quality_code',   'engagement-data-quality-code', NULL),
  ('attendance.engagement_alert',             'status_code',         'engagement-alert-status-code', NULL),
  ('attendance.engagement_alert',             'severity_code',       'engagement-alert-severity-code', NULL),
  ('attendance.engagement_intervention_case', 'status_code',         'engagement-case-status-code', NULL),
  ('attendance.engagement_intervention_case', 'outcome_code',        'engagement-case-outcome-code', NULL),
  ('attendance.engagement_policy_version',    'status_code',         'engagement-policy-status-code', NULL),
  ('engagement_outcome',                      'severity_code',       'engagement-alert-severity-code', NULL),
  ('workflow_task',                           'task_type_code',      'workflow-step-type-code', NULL)
ON CONFLICT DO NOTHING;

-- Where an approved adjustment is applied.
INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible", "allows_tenant_hide")
VALUES ('adjustment-target-system-code', 'Adjustment Target', 'srs-internal', NULL, 'A system an approved adjustment is applied in', false, false)
ON CONFLICT ("set_code") DO NOTHING;
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, NULL, NULL
FROM "value_set" vs,
(VALUES
  ('adjustment-target-system-code', 'vle',        'VLE',        10),
  ('adjustment-target-system-code', 'attendance', 'Attendance', 20),
  ('adjustment-target-system-code', 'exams',      'Exams',      30)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;
INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('adjustment_target_config', 'target_system',  'adjustment-target-system-code', NULL),
  ('adjustment_distribution',  'target_system',  'adjustment-target-system-code', NULL)
ON CONFLICT DO NOTHING;

-- Issued documents share the student-document types; a verification also
-- reports the signature check, a value the API derives (logical field).
INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible", "allows_tenant_hide")
VALUES ('document-signature-status-code', 'Signature Check', 'srs-internal', NULL, 'What checking a document''s signature found', false, false)
ON CONFLICT ("set_code") DO NOTHING;
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "description", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.description, v.sort_order, NULL, NULL
FROM "value_set" vs,
(VALUES
  ('document-signature-status-code', 'valid',         'Signature valid',          NULL, 10),
  ('document-signature-status-code', 'invalid',       'Signature does not match', 'Treat the document as not genuine', 20),
  ('document-signature-status-code', 'key-withdrawn', 'Signed with a withdrawn key', 'Signed with a key the institution has withdrawn', 30),
  ('document-signature-status-code', 'unsigned',      'Not signed',               'Issued before documents were signed', 40)
) AS v(set_code, code, display_label, description, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;
INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('document_issue',        'document_type_code', 'student-document-type-code', NULL),
  ('document_verification', 'signature_status',   'document-signature-status-code', 'Derived by the verification service')
ON CONFLICT DO NOTHING;

-- Values the API derives or holds in shared columns (logical fields).
INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible", "allows_tenant_hide")
VALUES
  ('slc-confirmation-type-code', 'SLC Confirmation Type', 'srs-internal', NULL, 'What an SLC attendance confirmation reports', false, false),
  ('non-registration-outcome-code', 'Non-Registration Outcome', 'srs-internal', NULL, 'How a non-registration case was resolved', false, false)
ON CONFLICT ("set_code") DO NOTHING;
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, NULL, NULL
FROM "value_set" vs,
(VALUES
  ('slc-confirmation-type-code', 'enrolment',    'Enrolment',    10),
  ('slc-confirmation-type-code', 'withdrawal',   'Withdrawal',   20),
  ('slc-confirmation-type-code', 'intermission', 'Interruption', 30),
  ('non-registration-outcome-code', 'registered-late',  'Registered late', 10),
  ('non-registration-outcome-code', 'referred',         'Referred to the student''s own request', 20),
  ('non-registration-outcome-code', 'non-registration', 'Non-registration decided', 30)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;
INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('slc_confirmation',      'confirmation_type', 'slc-confirmation-type-code', 'Derived from the enrolment status'),
  ('non_registration_case', 'outcome_code',      'non-registration-outcome-code', 'Held in case_decision.decision_type_code')
ON CONFLICT DO NOTHING;

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible", "allows_tenant_hide")
VALUES
  ('rule-source-code', 'Rule Source', 'srs-internal', NULL, 'Where an applied academic rule came from', false, false),
  ('non-registration-flag-code', 'Non-Registration Flag', 'srs-internal', NULL, 'Why a non-registration case needs care', false, false)
ON CONFLICT ("set_code") DO NOTHING;
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, NULL, NULL
FROM "value_set" vs,
(VALUES
  ('rule-source-code', 'programme',          'Programme rule', 10),
  ('rule-source-code', 'tenant-default',     'Institution rule', 20),
  ('rule-source-code', 'exception',          'Rule exception for this student', 30),
  ('rule-source-code', 'component-override', 'Assessment component override', 40),
  ('rule-source-code', 'reassessment-plan',  'Reassessment plan cap', 50),
  ('rule-source-code', 'built-in-default',   'Built-in default (no rule configured)', 60),
  ('non-registration-flag-code', 'results-pending',       'Last year''s results not ratified', 10),
  ('non-registration-flag-code', 'open-status-request',   'Has an open status request', 20),
  ('non-registration-flag-code', 'approved-interruption', 'Has an approved interruption', 30),
  ('non-registration-flag-code', 'sponsored',             'Student visa sponsored', 40)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;
INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('rule_version_reference', 'source',   'rule-source-code', 'Derived when a rule is resolved'),
  ('non_registration_case',  'flag_code', 'non-registration-flag-code', 'Derived for the worklist')
ON CONFLICT DO NOTHING;

-- Engagement intervention cases (attendance module): contact attempts,
-- actions and referrals. Free text in the module until now; institutions
-- can add their own channels, action types and services.
INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible", "allows_tenant_hide")
VALUES
  ('engagement-contact-channel-code', 'Contact Channel', 'srs-internal', NULL, 'How a student was contacted about engagement', true, true),
  ('engagement-contact-outcome-code', 'Contact Outcome', 'srs-internal', NULL, 'What came of a contact attempt', true, true),
  ('engagement-action-type-code', 'Engagement Action', 'srs-internal', NULL, 'A planned action in an engagement case', true, true),
  ('engagement-referral-target-code', 'Referral Service', 'srs-internal', NULL, 'The service an engagement case is referred to', true, true),
  ('engagement-referral-type-code', 'Referral Type', 'srs-internal', NULL, 'The kind of engagement referral', true, true)
ON CONFLICT ("set_code") DO NOTHING;
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, NULL, NULL
FROM "value_set" vs,
(VALUES
  ('engagement-contact-channel-code', 'portal',    'Portal message', 10),
  ('engagement-contact-channel-code', 'email',     'Email',          20),
  ('engagement-contact-channel-code', 'telephone', 'Telephone',      30),
  ('engagement-contact-channel-code', 'sms',       'Text message',   40),
  ('engagement-contact-channel-code', 'in-person', 'In person',      50),
  ('engagement-contact-channel-code', 'letter',    'Letter',         60),
  ('engagement-contact-outcome-code', 'no-response',           'No response',           10),
  ('engagement-contact-outcome-code', 'contacted',             'Contacted',             20),
  ('engagement-contact-outcome-code', 'response-received',     'Response received',     30),
  ('engagement-contact-outcome-code', 'wrong-contact-details', 'Wrong contact details', 40),
  ('engagement-action-type-code', 'academic-meeting', 'Academic meeting', 10),
  ('engagement-referral-target-code', 'wellbeing',                 'Wellbeing service',            10),
  ('engagement-referral-target-code', 'safeguarding',              'Safeguarding',                 20),
  ('engagement-referral-target-code', 'academic-status-review',    'Academic-status review',       30),
  ('engagement-referral-target-code', 'sponsor-compliance-review', 'Sponsor-compliance review',    40),
  ('engagement-referral-type-code', 'support-request',   'Support request',   10),
  ('engagement-referral-type-code', 'compliance-review', 'Compliance review', 20)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;
INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('attendance.engagement_contact_attempt', 'channel_code',        'engagement-contact-channel-code', NULL),
  ('attendance.engagement_contact_attempt', 'outcome_code',        'engagement-contact-outcome-code', NULL),
  ('attendance.engagement_action',          'action_type_code',    'engagement-action-type-code', NULL),
  ('attendance.engagement_action',          'owner_role_code',     'srs-role-code', NULL),
  ('attendance.engagement_referral',        'target_service_code', 'engagement-referral-target-code', NULL),
  ('attendance.engagement_referral',        'referral_type_code',  'engagement-referral-type-code', NULL),
  ('attendance.engagement_referral',        'status_code',         'engagement-referral-status-code', NULL)
ON CONFLICT DO NOTHING;
