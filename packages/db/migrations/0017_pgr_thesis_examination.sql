-- Revelation SRS — PGR thesis submission and examination
-- Migration: 0017_pgr_thesis_examination
--
-- Stage 3 of the PGR lifecycle build (BP-05-010, BPR-D12). Per ADR-023,
-- pgr_examination_case extends the shared business_case primitive. Follows
-- ADR-020's staged-authority pattern: immutable submitted thesis version
-- (thesis_submission, append-only) -> examiner nomination and chair
-- approval -> examiner reports (append-only) -> viva (viva_event) ->
-- ratified, immutable outcome (pgr_examination_outcome, append-only — the
-- outcome value set was already seeded in 0014_pgr_foundation). Corrections
-- are deadlined follow-up requirements linked to the ratified outcome,
-- never an edit to it.

CREATE TABLE "pgr_examination_case" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "business_case_id" uuid NOT NULL,
  "enrolment_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "pgr_examination_case_business_case_idx"
  ON "pgr_examination_case" ("tenant_id", "business_case_id");
CREATE INDEX "pgr_examination_case_enrolment_idx"
  ON "pgr_examination_case" ("tenant_id", "enrolment_id");

ALTER TABLE "pgr_examination_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pgr_examination_case" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pgr_examination_case"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "thesis_submission" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "examination_case_id" uuid NOT NULL REFERENCES "pgr_examination_case"("id"),
  "version_number" integer NOT NULL,
  "format_code" text NOT NULL,
  "declaration_confirmed" boolean NOT NULL,
  "restricted" boolean NOT NULL DEFAULT false,
  "restriction_reason_text" text,
  "restriction_review_date" date,
  "storage_ref" text NOT NULL,
  "submitted_by" text NOT NULL,
  "submitted_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "thesis_submission_case_version_unique"
  ON "thesis_submission" ("tenant_id", "examination_case_id", "version_number");

ALTER TABLE "thesis_submission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "thesis_submission" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "thesis_submission"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "examiner_appointment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "examination_case_id" uuid NOT NULL REFERENCES "pgr_examination_case"("id"),
  "person_id" uuid NOT NULL REFERENCES "person"("id"),
  "examiner_role_code" text NOT NULL,
  "independence_checked_at" timestamptz,
  "conflict_type_code" text,
  "recused_at" timestamptz,
  "confirmed_at" timestamptz,
  "nominated_by" text NOT NULL,
  "nominated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "examiner_appointment_case_idx"
  ON "examiner_appointment" ("tenant_id", "examination_case_id");

ALTER TABLE "examiner_appointment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "examiner_appointment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "examiner_appointment"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "examiner_report" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "examination_case_id" uuid NOT NULL REFERENCES "pgr_examination_case"("id"),
  "examiner_appointment_id" uuid NOT NULL REFERENCES "examiner_appointment"("id"),
  "report_ref" text NOT NULL,
  "recommendation_code" text,
  "submitted_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "examiner_report_case_idx"
  ON "examiner_report" ("tenant_id", "examination_case_id");

ALTER TABLE "examiner_report" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "examiner_report" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "examiner_report"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "viva_event" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "examination_case_id" uuid NOT NULL REFERENCES "pgr_examination_case"("id"),
  "held_at" timestamptz NOT NULL,
  "joint_recommendation_text" text NOT NULL,
  "recorded_by" text NOT NULL,
  "recorded_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "viva_event_case_idx"
  ON "viva_event" ("tenant_id", "examination_case_id");

ALTER TABLE "viva_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "viva_event" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "viva_event"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "pgr_examination_outcome" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "examination_case_id" uuid NOT NULL REFERENCES "pgr_examination_case"("id"),
  "outcome_code" text NOT NULL,
  "decided_by" text NOT NULL,
  "decided_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "pgr_examination_outcome_case_idx"
  ON "pgr_examination_outcome" ("tenant_id", "examination_case_id");

ALTER TABLE "pgr_examination_outcome" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pgr_examination_outcome" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pgr_examination_outcome"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "thesis_correction_requirement" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "outcome_id" uuid NOT NULL REFERENCES "pgr_examination_outcome"("id"),
  "deadline_date" date NOT NULL,
  "completed_at" timestamptz,
  "completed_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "thesis_correction_requirement_outcome_idx"
  ON "thesis_correction_requirement" ("tenant_id", "outcome_id");

ALTER TABLE "thesis_correction_requirement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "thesis_correction_requirement" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "thesis_correction_requirement"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Value sets

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('pgr-thesis-format-code', 'PGR Thesis Format',  'srs-internal', 'Format of a submitted PGR thesis', false),
  ('pgr-examiner-role-code', 'PGR Examiner Role',  'srs-internal', 'Role of an examiner on a PGR examination case', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('pgr-thesis-format-code', 'traditional',     'Traditional thesis',        10),
  ('pgr-thesis-format-code', 'practice-based',  'Practice-based submission', 20),
  ('pgr-thesis-format-code', 'published-work',  'Published-work submission', 30),

  ('pgr-examiner-role-code', 'internal', 'Internal examiner', 10),
  ('pgr-examiner-role-code', 'external', 'External examiner', 20)
) AS v(set_code, code, display_label, sort_order)
  ON v.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code")
VALUES
  ('thesis_submission',    'format_code',          'pgr-thesis-format-code'),
  ('examiner_appointment', 'examiner_role_code',   'pgr-examiner-role-code'),
  ('examiner_appointment', 'conflict_type_code',   'board-conflict-type-code'),
  ('examiner_report',      'recommendation_code',  'pgr-examination-outcome-code')
ON CONFLICT DO NOTHING;
