-- Reasonable adjustments: core-SRS-owned outcome-document storage.
--
-- packages/documents' pluggable table set, installed into this service's
-- own database (a second, independent install alongside the one in the
-- wellbeing module's database — deliberately duplicated storage rather
-- than a cross-service reference, so this record's document survives
-- independently of the wellbeing module and is retrievable by anyone who
-- can already see the adjustment record, with no wellbeing-module role
-- required).

CREATE SCHEMA IF NOT EXISTS documents;

CREATE TABLE IF NOT EXISTS documents."document" (
  "id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        uuid        NOT NULL REFERENCES "tenant" ("id"),
  "owner_service"    text        NOT NULL,
  "owner_ref"        text        NOT NULL,
  "filename"         text        NOT NULL,
  "mime_type"        text        NOT NULL,
  "size_bytes"       integer     NOT NULL,
  "checksum_sha256"  text        NOT NULL,
  "content"          bytea,
  "status_code"      text        NOT NULL DEFAULT 'pending-scan',
  "uploaded_by"      text        NOT NULL,
  "uploaded_at"      timestamptz NOT NULL DEFAULT now(),
  "deleted_at"       timestamptz,
  "deleted_by"       text,
  "deleted_reason"   text
);

CREATE INDEX IF NOT EXISTS "document_owner_idx"
  ON documents."document" ("tenant_id", "owner_service", "owner_ref");

CREATE TABLE IF NOT EXISTS documents."document_access_log" (
  "id"           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_id"  uuid        NOT NULL,
  "tenant_id"    uuid        NOT NULL REFERENCES "tenant" ("id"),
  "actor_id"     text        NOT NULL,
  "action"       text        NOT NULL,
  "occurred_at"  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "document_access_log_document_idx"
  ON documents."document_access_log" ("document_id");

-- Row-level security matches this service's existing convention (same
-- app.current_tenant_id session variable already used by
-- reasonable_adjustment, adjustment_distribution, and every other
-- tenant-scoped table here).
ALTER TABLE documents."document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents."document" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON documents."document";
CREATE POLICY tenant_isolation ON documents."document"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE documents."document_access_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents."document_access_log" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON documents."document_access_log";
CREATE POLICY tenant_isolation ON documents."document_access_log"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE "reasonable_adjustment"
  ADD COLUMN "outcome_document_id" uuid REFERENCES documents."document" ("id");
