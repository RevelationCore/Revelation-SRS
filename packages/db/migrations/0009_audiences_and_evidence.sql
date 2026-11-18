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
