-- Revelation SRS — PGR completion and research award conferral
-- Migration: 0018_pgr_completion_and_research_award
--
-- Stage 4 of the PGR lifecycle build (BP-06-006, BPR-D14). Per ADR-023,
-- pgr_completion_case extends the shared business_case primitive and links
-- back to the examination case whose ratified, corrections-complete
-- outcome authorises completion. final_thesis_deposit confirms repository
-- deposit and IP declarations — a missing deposit holds completion.
--
-- The award table is additively relaxed so a research award can be
-- conferred without a taught exam board: exam_board_id becomes nullable
-- and a new source_case_id column (the PGR completion case) is added for
-- research awards. Exactly one of the two is populated per award.

CREATE TABLE "pgr_completion_case" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "business_case_id" uuid NOT NULL,
  "enrolment_id" uuid NOT NULL,
  "examination_case_id" uuid NOT NULL REFERENCES "pgr_examination_case"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "pgr_completion_case_business_case_idx"
  ON "pgr_completion_case" ("tenant_id", "business_case_id");
CREATE INDEX "pgr_completion_case_enrolment_idx"
  ON "pgr_completion_case" ("tenant_id", "enrolment_id");

ALTER TABLE "pgr_completion_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pgr_completion_case" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pgr_completion_case"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "final_thesis_deposit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "completion_case_id" uuid NOT NULL REFERENCES "pgr_completion_case"("id"),
  "deposit_ref" text NOT NULL,
  "ip_declaration_confirmed" boolean NOT NULL,
  "confirmed_by" text NOT NULL,
  "confirmed_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "final_thesis_deposit_completion_case_idx"
  ON "final_thesis_deposit" ("tenant_id", "completion_case_id");

ALTER TABLE "final_thesis_deposit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "final_thesis_deposit" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "final_thesis_deposit"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Additive relaxation of "award" for research (PGR) awards

ALTER TABLE "award" ALTER COLUMN "exam_board_id" DROP NOT NULL;
ALTER TABLE "award" ADD COLUMN "source_case_id" uuid;

ALTER TABLE "award"
  ADD CONSTRAINT "award_exactly_one_authority"
    CHECK (num_nonnulls("exam_board_id", "source_case_id") = 1);
