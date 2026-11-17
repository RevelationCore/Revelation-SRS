-- 0009 — Integrations and outputs (Phase 3)
-- (docs/decisions/phase-3-gap-closure-decisions.md, D-14 to D-22)

-- ── D-16: one CAS record ────────────────────────────────────────────────────
-- cas_case becomes the system of record. A CAS is needed before the visa
-- application, so before any enrolment: a case belongs to an application (new
-- entrant) or an enrolment (in-country extension or course change).

ALTER TABLE "cas_case"
  ADD COLUMN IF NOT EXISTS "person_id"        uuid,
  ADD COLUMN IF NOT EXISTS "application_id"   uuid,
  ADD COLUMN IF NOT EXISTS "prepared_payload" jsonb,
  ADD COLUMN IF NOT EXISTS "prepared_by"      text;
ALTER TABLE "cas_case" ALTER COLUMN "enrolment_id" DROP NOT NULL;

UPDATE "cas_case" c SET "person_id" = e."person_id"
FROM "enrolment" e
WHERE e."id" = c."enrolment_id" AND e."tenant_id" = c."tenant_id" AND e."recorded_until" IS NULL AND c."person_id" IS NULL;

-- Carry any CAS request that has no case into cas_case, so no CAS is lost.
INSERT INTO "cas_case" ("version_id", "id", "tenant_id", "enrolment_id", "person_id", "cas_reference", "status_code", "actor_id", "valid_from", "recorded_at")
SELECT gen_random_uuid(), r."id", r."tenant_id", r."enrolment_id", e."person_id", r."cas_reference",
  CASE r."status_code" WHEN 'assigned' THEN 'assigned' WHEN 'used' THEN 'assigned' WHEN 'withdrawn' THEN 'withdrawn' WHEN 'expired' THEN 'withdrawn' ELSE 'opened' END,
  'migration-0009', r."valid_from", r."recorded_at"
FROM "ukvi_cas_request" r
JOIN "enrolment" e ON e."id" = r."enrolment_id" AND e."tenant_id" = r."tenant_id" AND e."recorded_until" IS NULL
WHERE r."recorded_until" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "cas_case" c WHERE c."tenant_id" = r."tenant_id" AND c."enrolment_id" = r."enrolment_id");

DELETE FROM "cas_case" WHERE "person_id" IS NULL;
ALTER TABLE "cas_case" ALTER COLUMN "person_id" SET NOT NULL;
ALTER TABLE "cas_case" DROP CONSTRAINT IF EXISTS "cas_case_subject_check";
ALTER TABLE "cas_case" ADD CONSTRAINT "cas_case_subject_check" CHECK ("application_id" IS NOT NULL OR "enrolment_id" IS NOT NULL);
CREATE INDEX IF NOT EXISTS "cas_case_application_idx" ON "cas_case" ("tenant_id", "application_id");
CREATE INDEX IF NOT EXISTS "cas_case_person_idx" ON "cas_case" ("tenant_id", "person_id");
CREATE INDEX IF NOT EXISTS "cas_case_reference_idx" ON "cas_case" ("tenant_id", "cas_reference") WHERE "recorded_until" IS NULL;

ALTER TABLE "ukvi_visa_status" ADD COLUMN IF NOT EXISTS "cas_case_id" uuid;
ALTER TABLE "ukvi_visa_status" ALTER COLUMN "enrolment_id" DROP NOT NULL;
ALTER TABLE "ukvi_compliance_alert" ADD COLUMN IF NOT EXISTS "cas_case_id" uuid;

DELETE FROM "field_value_set" WHERE "entity_name" = 'ukvi_cas_request';
DROP TABLE IF EXISTS "ukvi_cas_request";

-- The CAS case lifecycle (migration 0004) gains the preparation, approval and SMS steps.
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('cas-case-status-code', 'prepared',  'Prepared for approval', 22),
  ('cas-case-status-code', 'approved',  'Approved',              24),
  ('cas-case-status-code', 'requested', 'Sent to SMS',           26)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;
