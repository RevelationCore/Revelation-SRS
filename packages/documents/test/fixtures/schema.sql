-- Reference DDL for the packages/documents table set. A host service that
-- installs this package (e.g. modules/wellbeing) includes the equivalent
-- CREATE statements in its own migrations directory, since the tables live
-- inside that service's own database (see schema.ts's module comment).
-- This file exists only to stand up a throwaway test database for this
-- package's own integration tests.

CREATE SCHEMA IF NOT EXISTS documents;

CREATE TABLE documents.document (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  owner_service    text NOT NULL,
  owner_ref        text NOT NULL,
  filename         text NOT NULL,
  mime_type        text NOT NULL,
  size_bytes       integer NOT NULL,
  checksum_sha256  text NOT NULL,
  content          bytea,
  status_code      text NOT NULL DEFAULT 'pending-scan',
  uploaded_by      text NOT NULL,
  uploaded_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  deleted_by       text,
  deleted_reason   text
);

CREATE INDEX document_owner_idx ON documents.document (tenant_id, owner_service, owner_ref);

CREATE TABLE documents.document_access_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  uuid NOT NULL,
  tenant_id    uuid NOT NULL,
  actor_id     text NOT NULL,
  action       text NOT NULL,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX document_access_log_document_idx ON documents.document_access_log (document_id);
