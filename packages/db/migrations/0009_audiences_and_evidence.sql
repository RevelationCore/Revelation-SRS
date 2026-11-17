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
