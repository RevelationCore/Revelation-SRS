-- 0013_identity_merge_execution
--
-- ADR-031 item 5 (BL-355): a merge decision moves current ownership to the
-- survivor, keeps history in place, and records every move so an unmerge can
-- reverse it (BL-359). Each move is a row of identity_merge_move.

CREATE TABLE IF NOT EXISTS "identity_merge" (
  "id"                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                   uuid        NOT NULL REFERENCES "tenant"("id"),
  "identity_resolution_case_id" uuid        NOT NULL REFERENCES "identity_resolution_case"("id"),
  "decision_id"                 uuid        NOT NULL REFERENCES "identity_resolution_decision"("id"),
  "proposal_version"            integer     NOT NULL,
  "survivor_person_id"          uuid        NOT NULL REFERENCES "person"("id"),
  "merged_person_id"            uuid        NOT NULL REFERENCES "person"("id"),
  "effective_at"                timestamptz NOT NULL,
  "decided_by"                  text        NOT NULL,
  "unmerged_at"                 timestamptz,
  "unmerge_decision_id"         uuid,
  CONSTRAINT "identity_merge_two_people" CHECK ("survivor_person_id" <> "merged_person_id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "identity_merge_decision_unique" ON "identity_merge" ("decision_id");

CREATE TABLE IF NOT EXISTS "identity_merge_move" (
  "id"                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid        NOT NULL REFERENCES "tenant"("id"),
  "merge_id"          uuid        NOT NULL REFERENCES "identity_merge"("id"),
  "table_name"        text        NOT NULL,
  "column_name"       text        NOT NULL,
  -- The row's logical id (bitemporal tables) or primary key.
  "row_key"           text        NOT NULL,
  "mode"              text        NOT NULL CHECK ("mode" IN ('versioned-move', 'survivor-chooses', 'ledgered-move')),
  "from_person_id"    uuid        NOT NULL,
  "to_person_id"      uuid        NOT NULL,
  "closed_version_id" uuid,
  "new_version_id"    uuid
);
CREATE INDEX IF NOT EXISTS "identity_merge_move_merge_idx" ON "identity_merge_move" ("tenant_id", "merge_id");

ALTER TABLE "identity_redirect" ADD COLUMN IF NOT EXISTS "merge_id" uuid REFERENCES "identity_merge"("id");
ALTER TABLE "identity_redirect" ADD COLUMN IF NOT EXISTS "ended_at" timestamptz;
ALTER TABLE "identity_redirect" ADD COLUMN IF NOT EXISTS "ended_by_merge_id" uuid REFERENCES "identity_merge"("id");
CREATE INDEX IF NOT EXISTS "identity_redirect_current_idx" ON "identity_redirect" ("tenant_id", "old_person_id") WHERE "ended_at" IS NULL;

ALTER TABLE "identity_merge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identity_merge" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "identity_merge";
CREATE POLICY tenant_isolation ON "identity_merge"
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);
ALTER TABLE "identity_merge_move" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identity_merge_move" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "identity_merge_move";
CREATE POLICY tenant_isolation ON "identity_merge_move"
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);
-- Unmerge (BL-359) sets unmerged_at; moves are append-only.
GRANT SELECT, INSERT, UPDATE ON "identity_merge" TO srs_app;
GRANT SELECT, INSERT ON "identity_merge_move" TO srs_app;
GRANT UPDATE ON "identity_redirect" TO srs_app;
