-- 0004_retention_disposal_plan
--
-- BL-327 (rest of BL-284): irreversible retention disposal needs two people.
-- A DPO prepares a plan from a dry run; a different person holding
-- retention:approve approves it; execution applies only that plan, refuses
-- if any person's eligibility has changed, and records a disposition with a
-- certificate reference for each person.

CREATE TABLE "retention_disposal_plan" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        uuid NOT NULL REFERENCES "tenant"("id"),
  "status_code"      text NOT NULL DEFAULT 'prepared',
  "prepared_by"      text NOT NULL,
  "prepared_at"      timestamptz NOT NULL DEFAULT now(),
  "approved_by"      text,
  "approved_at"      timestamptz,
  "rejected_by"      text,
  "rejected_at"      timestamptz,
  "rejection_reason" text,
  "executed_by"      text,
  "executed_at"      timestamptz,
  -- SHA-256 of the sorted person IDs, so the approved plan is the one executed.
  "plan_hash"        text NOT NULL,
  CONSTRAINT "retention_disposal_plan_approver_differs" CHECK ("approved_by" IS NULL OR "approved_by" <> "prepared_by"),
  CONSTRAINT "retention_disposal_plan_rejecter_differs" CHECK ("rejected_by" IS NULL OR "rejected_by" <> "prepared_by")
);

CREATE TABLE "retention_disposal_plan_item" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"   uuid NOT NULL REFERENCES "tenant"("id"),
  "plan_id"     uuid NOT NULL REFERENCES "retention_disposal_plan"("id"),
  "person_id"   uuid NOT NULL REFERENCES "person"("id"),
  "action_code" text NOT NULL DEFAULT 'anonymised',
  UNIQUE ("plan_id", "person_id")
);

-- A disposition per person, not only per retention assignment: most people
-- are disposed of under the default rule and have no assignment.
ALTER TABLE "record_disposition" ALTER COLUMN "retention_assignment_id" DROP NOT NULL;
ALTER TABLE "record_disposition" ADD COLUMN "person_id" uuid REFERENCES "person"("id");
ALTER TABLE "record_disposition" ADD COLUMN "disposal_plan_id" uuid REFERENCES "retention_disposal_plan"("id");
ALTER TABLE "record_disposition" ADD COLUMN "certificate_ref" text;
CREATE UNIQUE INDEX "record_disposition_certificate_unique"
  ON "record_disposition" ("tenant_id", "certificate_ref") WHERE "certificate_ref" IS NOT NULL;

ALTER TABLE "retention_disposal_plan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "retention_disposal_plan" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "retention_disposal_plan"
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

ALTER TABLE "retention_disposal_plan_item" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "retention_disposal_plan_item" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "retention_disposal_plan_item"
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

GRANT SELECT, INSERT, UPDATE ON "retention_disposal_plan", "retention_disposal_plan_item" TO srs_app;

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('retention-disposal-plan-status-code', 'Retention Disposal Plan Status', 'srs-internal', 'Where a two-person retention disposal plan is (BL-327)', false)
ON CONFLICT DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, NULL, NULL
FROM "value_set" vs,
(VALUES
  ('retention-disposal-plan-status-code', 'prepared', 'Prepared',  10),
  ('retention-disposal-plan-status-code', 'approved', 'Approved',  20),
  ('retention-disposal-plan-status-code', 'rejected', 'Rejected',  30),
  ('retention-disposal-plan-status-code', 'executed', 'Executed',  40)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('retention_disposal_plan', 'status_code', 'retention-disposal-plan-status-code'),
  ('retention_disposal_plan_item', 'action_code', 'record-disposition-type-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;
