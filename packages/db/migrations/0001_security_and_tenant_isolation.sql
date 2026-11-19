-- Security and tenant isolation (enterprise readiness plan, phase 1).
--
-- 1. Application database role (item 1.1, finding SEC-1).
--
-- Migrations run as the schema owner. Services connect as a login role that
-- inherits srs_app: not a superuser, not the owner, and without BYPASSRLS, so
-- row-level security applies to every query they make. OpenBao issues such
-- login roles in Kubernetes (infra/k8s/base/openbao.yaml); local compose
-- creates srs_api (infra/compose/init/02-app-role.sql).

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'srs_app') THEN
    CREATE ROLE srs_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public, documents TO srs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, documents TO srs_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, documents TO srs_app;

-- Tables, sequences and schemas the owner creates later (core and module
-- migrations alike) are granted the same way.
ALTER DEFAULT PRIVILEGES GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO srs_app;
ALTER DEFAULT PRIVILEGES GRANT USAGE, SELECT ON SEQUENCES TO srs_app;
ALTER DEFAULT PRIVILEGES GRANT USAGE ON SCHEMAS TO srs_app;

-- The audit trail is append-only: the application may write and read it, never
-- change or remove it.
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_record" FROM srs_app;
