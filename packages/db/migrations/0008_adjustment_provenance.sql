-- 0008_adjustment_provenance
--
-- ADR-033 (BL-377): every core adjustment records the authority it was
-- recorded under, and the database enforces it. Before this, a staff member
-- could record one with no case and no approval (D-44 F5). manual_proposal_id
-- gains its foreign key with the adjustment_proposal table (BL-378).

ALTER TABLE "reasonable_adjustment" ADD COLUMN IF NOT EXISTS "provenance_code" text;
ALTER TABLE "reasonable_adjustment" ADD COLUMN IF NOT EXISTS "manual_proposal_id" uuid;
ALTER TABLE "reasonable_adjustment" ADD COLUMN IF NOT EXISTS "migration_batch_id" uuid;
ALTER TABLE "reasonable_adjustment" ADD COLUMN IF NOT EXISTS "migration_source_reference" text;

-- Backfill (Alpha: only development and demo databases hold rows).
UPDATE "reasonable_adjustment" SET "provenance_code" = 'wellbeing-case'
  WHERE "provenance_code" IS NULL AND "source_case_id" IS NOT NULL;
UPDATE "reasonable_adjustment" SET "provenance_code" = 'migrated',
  "migration_batch_id" = '00000000-0000-4000-8000-000000000033', "migration_source_reference" = 'unknown'
  WHERE "provenance_code" IS NULL AND "actor_id" = 'migration-import';
UPDATE "reasonable_adjustment" SET "provenance_code" = 'legacy-direct' WHERE "provenance_code" IS NULL;

ALTER TABLE "reasonable_adjustment" ALTER COLUMN "provenance_code" SET NOT NULL;
ALTER TABLE "reasonable_adjustment" ADD CONSTRAINT "reasonable_adjustment_provenance_ck" CHECK (
  "provenance_code" IN ('wellbeing-case', 'manual-approved', 'migrated', 'legacy-direct')
  AND ("provenance_code" <> 'wellbeing-case' OR "source_case_id" IS NOT NULL)
  AND ("provenance_code" <> 'manual-approved' OR "manual_proposal_id" IS NOT NULL)
  AND ("provenance_code" <> 'migrated' OR ("migration_batch_id" IS NOT NULL AND "migration_source_reference" IS NOT NULL))
);

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('adjustment-provenance-code', 'Adjustment Provenance', 'srs-internal', 'The authority a core adjustment was recorded under (ADR-033)', false)
ON CONFLICT DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "active_to", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, NULL, v.active_to, NULL
FROM "value_set" vs,
(VALUES
  ('adjustment-provenance-code', 'wellbeing-case',  'Approved in a wellbeing case',            10, NULL::timestamptz),
  ('adjustment-provenance-code', 'manual-approved', 'Manual, approved by a second person',      20, NULL::timestamptz),
  ('adjustment-provenance-code', 'migrated',        'Migrated from the previous system',        30, NULL::timestamptz),
  -- Recorded before provenance existed; never valid for a new write.
  ('adjustment-provenance-code', 'legacy-direct',   'Recorded directly before 22 November 2026', 40, '2026-11-22T00:00:00Z'::timestamptz)
) AS v(set_code, code, display_label, sort_order, active_to)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('reasonable_adjustment', 'provenance_code', 'adjustment-provenance-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;
