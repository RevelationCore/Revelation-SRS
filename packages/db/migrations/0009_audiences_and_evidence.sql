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
