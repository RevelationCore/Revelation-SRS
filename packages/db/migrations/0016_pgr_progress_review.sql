-- Revelation SRS — PGR progress review and milestones
-- Migration: 0016_pgr_progress_review
--
-- Stage 2 of the PGR lifecycle build (BP-04-003, BPR-D07 part 2). Per
-- ADR-023, pgr_progress_review extends the shared business_case primitive —
-- each review (initial, annual, upgrade, return-from-interruption) is its
-- own case instance, not a version of a prior one. pgr_review_member
-- mirrors board_member_conflict's shape (0004_business_process_foundations)
-- for panel composition and conflict/recusal tracking. research_milestone
-- is append-only: an unsatisfactory outcome never alters candidature until
-- the case is decided, and a milestone is only published once a decision
-- exists.

CREATE TABLE "pgr_progress_review" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "business_case_id" uuid NOT NULL,
  "enrolment_id" uuid NOT NULL,
  "supervision_case_id" uuid REFERENCES "pgr_supervision_case"("id"),
  "review_type_code" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "pgr_progress_review_business_case_idx"
  ON "pgr_progress_review" ("tenant_id", "business_case_id");
CREATE INDEX "pgr_progress_review_enrolment_idx"
  ON "pgr_progress_review" ("tenant_id", "enrolment_id");

ALTER TABLE "pgr_progress_review" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pgr_progress_review" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pgr_progress_review"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "pgr_review_member" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "review_id" uuid NOT NULL REFERENCES "pgr_progress_review"("id"),
  "person_id" uuid NOT NULL REFERENCES "person"("id"),
  "role_code" text NOT NULL,
  "conflict_type_code" text,
  "declared_at" timestamptz,
  "recused_at" timestamptz,
  "added_by" text NOT NULL,
  "added_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "pgr_review_member_review_idx"
  ON "pgr_review_member" ("tenant_id", "review_id");

ALTER TABLE "pgr_review_member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pgr_review_member" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pgr_review_member"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "research_milestone" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id" uuid NOT NULL,
  "review_id" uuid REFERENCES "pgr_progress_review"("id"),
  "milestone_type_code" text NOT NULL,
  "achieved_date" date NOT NULL,
  "published_at" timestamptz,
  "actor_id" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "research_milestone_enrolment_idx"
  ON "research_milestone" ("tenant_id", "enrolment_id");

ALTER TABLE "research_milestone" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "research_milestone" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "research_milestone"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Value sets

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('pgr-review-type-code',        'PGR Review Type',         'srs-internal', 'Type of PGR progress review', false),
  ('pgr-review-member-role-code', 'PGR Review Member Role',   'srs-internal', 'Role of a member on a PGR progress-review panel', false),
  ('pgr-review-outcome-code',     'PGR Review Outcome',       'srs-internal', 'Outcome of a PGR progress review', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('pgr-review-type-code', 'initial',                     'Initial review',                 10),
  ('pgr-review-type-code', 'annual',                      'Annual review',                  20),
  ('pgr-review-type-code', 'upgrade',                      'Upgrade / confirmation review',  30),
  ('pgr-review-type-code', 'return-from-interruption',     'Return-from-interruption review',40),

  ('pgr-review-member-role-code', 'chair',                'Chair',                10),
  ('pgr-review-member-role-code', 'independent-reviewer', 'Independent reviewer', 20),
  ('pgr-review-member-role-code', 'panel-member',         'Panel member',         30),

  ('pgr-review-outcome-code', 'satisfactory', 'Satisfactory progress', 10),
  ('pgr-review-outcome-code', 'conditions',   'Conditions set',        20),
  ('pgr-review-outcome-code', 'referral',     'Referral',              30),
  ('pgr-review-outcome-code', 'transfer',     'Transfer',              40),
  ('pgr-review-outcome-code', 'escalation',   'Escalation',            50)
) AS v(set_code, code, display_label, sort_order)
  ON v.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code")
VALUES
  ('pgr_progress_review', 'review_type_code',    'pgr-review-type-code'),
  ('pgr_review_member',   'role_code',            'pgr-review-member-role-code'),
  ('pgr_review_member',   'conflict_type_code',   'board-conflict-type-code'),
  ('research_milestone',  'milestone_type_code',  'research-milestone-type')
ON CONFLICT DO NOTHING;
