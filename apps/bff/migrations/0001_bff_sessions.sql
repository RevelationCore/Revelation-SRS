-- 0001_bff_sessions
--
-- ADR-026: browser sessions held by the backend-for-frontend. The cookie
-- carries a random identifier; only its SHA-256 is stored. The tokens are
-- encrypted (AES-256-GCM, with the key id so keys can rotate). No tenant
-- data: the BFF never reads it, and this table has no tenant_id.

CREATE SCHEMA IF NOT EXISTS bff;

DO $$
BEGIN
  -- The role the BFF's login role inherits: DML on the bff schema only.
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'srs_bff') THEN
    CREATE ROLE srs_bff NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS bff."session" (
  "id_hash"             text        PRIMARY KEY,
  "client_id"           text        NOT NULL,
  "sub"                 text        NOT NULL,
  "sid"                 text,
  "tokens"              text        NOT NULL,
  "key_id"              text        NOT NULL,
  "access_expires_at"   timestamptz NOT NULL,
  "idle_expires_at"     timestamptz NOT NULL,
  "absolute_expires_at" timestamptz NOT NULL,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "last_seen_at"        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "session_sid_idx" ON bff."session" ("client_id", "sid");
CREATE INDEX IF NOT EXISTS "session_expiry_idx" ON bff."session" ("idle_expires_at", "absolute_expires_at");

GRANT USAGE ON SCHEMA bff TO srs_bff;
GRANT SELECT, INSERT, UPDATE, DELETE ON bff."session" TO srs_bff;
