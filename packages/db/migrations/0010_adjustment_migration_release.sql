-- 0010_adjustment_migration_release
--
-- ADR-033 item 7, SME-8 (BL-379): migrated adjustments are live as decided
-- but are distributed only once a second person releases their batch,
-- reconciled against the legacy system's report. A release is recorded per
-- adjustment, so a repeat releases nothing even where every target is
-- 'not-used' and no distribution was created.

CREATE TABLE IF NOT EXISTS "adjustment_migration_release" (
  "tenant_id"                uuid        NOT NULL REFERENCES "tenant"("id"),
  "adjustment_id"            uuid        NOT NULL,
  "migration_batch_id"       uuid        NOT NULL,
  "reconciliation_reference" text        NOT NULL CHECK (char_length("reconciliation_reference") BETWEEN 1 AND 100),
  "released_by"              text        NOT NULL,
  "released_at"              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("tenant_id", "adjustment_id")
);
CREATE INDEX IF NOT EXISTS "adjustment_migration_release_batch_idx" ON "adjustment_migration_release" ("tenant_id", "migration_batch_id");
CREATE INDEX IF NOT EXISTS "reasonable_adjustment_migration_batch_idx" ON "reasonable_adjustment" ("tenant_id", "migration_batch_id") WHERE "migration_batch_id" IS NOT NULL;

ALTER TABLE "adjustment_migration_release" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "adjustment_migration_release" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "adjustment_migration_release";
CREATE POLICY tenant_isolation ON "adjustment_migration_release"
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);
-- Append-only: a release is never undone here; expiry withdraws an adjustment.
GRANT SELECT, INSERT ON "adjustment_migration_release" TO srs_app;
