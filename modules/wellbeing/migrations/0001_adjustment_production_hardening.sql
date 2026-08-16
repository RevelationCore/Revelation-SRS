-- ============================================================
-- Reasonable-adjustments production hardening:
--   - documents.* : packages/documents' pluggable storage tables,
--     installed into this module's own database.
--   - wellbeing.adjustment_case_evidence : case-scoped pointer into
--     documents.document (opaque cross-schema reference, not an FK —
--     documents.* is owned by a separate package's schema module).
-- ============================================================

-- ── Documents schema ─────────────────────────────────────────────────────────

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

ALTER TABLE documents."document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents."document" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON documents."document";
CREATE POLICY tenant_isolation ON documents."document"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

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

ALTER TABLE documents."document_access_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents."document_access_log" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON documents."document_access_log";
CREATE POLICY tenant_isolation ON documents."document_access_log"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Adjustment case evidence ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wellbeing."adjustment_case_evidence" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant" ("id"),
  "adjustment_case_id"  uuid        NOT NULL,
  "document_id"         uuid        NOT NULL,
  "evidence_type_code"  text        NOT NULL,
  "uploaded_by"         text        NOT NULL,
  "uploaded_at"         timestamptz NOT NULL DEFAULT now(),
  "deleted_at"          timestamptz
);

CREATE INDEX IF NOT EXISTS "adjustment_case_evidence_case_idx"
  ON wellbeing."adjustment_case_evidence" ("tenant_id", "adjustment_case_id");

ALTER TABLE wellbeing."adjustment_case_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE wellbeing."adjustment_case_evidence" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON wellbeing."adjustment_case_evidence";
CREATE POLICY tenant_isolation ON wellbeing."adjustment_case_evidence"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
