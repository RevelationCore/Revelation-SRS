-- 0014_identity_unmerge
--
-- ADR-031 item 10 (BL-359): an unmerge is a governed case of its own. It is
-- prepared by one officer (who allocates any record created on the survivor
-- since the merge) and decided by another, and reverses the merge's
-- recorded moves.

CREATE TABLE IF NOT EXISTS "identity_unmerge_case" (
  "id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        uuid        NOT NULL REFERENCES "tenant"("id"),
  "merge_id"         uuid        NOT NULL REFERENCES "identity_merge"("id"),
  "business_case_id" uuid        NOT NULL,
  "status_code"      text        NOT NULL DEFAULT 'open' CHECK ("status_code" IN ('open', 'proposed', 'unmerged', 'rejected')),
  "opened_by"        text        NOT NULL,
  "opened_at"        timestamptz NOT NULL DEFAULT now(),
  "proposal_version" integer     NOT NULL DEFAULT 0,
  -- { "<table>.<column>:<rowKey>": "survivor" | "restored" } for records created on the survivor after the merge.
  "allocations"      jsonb       NOT NULL DEFAULT '{}',
  "proposed_by"      text,
  "proposed_at"      timestamptz,
  "decided_by"       text,
  "decided_at"       timestamptz,
  "decision_reason"  text,
  CONSTRAINT "identity_unmerge_case_decided_ck" CHECK ("status_code" NOT IN ('unmerged', 'rejected') OR ("decided_by" IS NOT NULL AND "decision_reason" IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS "identity_unmerge_case_one_open" ON "identity_unmerge_case" ("tenant_id", "merge_id") WHERE "status_code" IN ('open', 'proposed');

ALTER TABLE "identity_unmerge_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identity_unmerge_case" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "identity_unmerge_case";
CREATE POLICY tenant_isolation ON "identity_unmerge_case"
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);
GRANT SELECT, INSERT, UPDATE ON "identity_unmerge_case" TO srs_app;

-- What the merged person's status was, so an unmerge can restore it.
ALTER TABLE "identity_merge" ADD COLUMN IF NOT EXISTS "merged_person_status_code" text;

-- After an unmerge the same person may be merged again, so only a current
-- redirect is unique.
ALTER TABLE "identity_redirect" DROP CONSTRAINT IF EXISTS "identity_redirect_old_person_unique";
DROP INDEX IF EXISTS "identity_redirect_old_person_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "identity_redirect_old_person_current_unique" ON "identity_redirect" ("tenant_id", "old_person_id") WHERE "ended_at" IS NULL;

-- Unmerge removes the identifier aliases the merge created.
GRANT DELETE ON "person_identifier_alias" TO srs_app;
