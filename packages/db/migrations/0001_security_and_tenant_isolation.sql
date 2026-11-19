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

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. No tenant context means no rows (item 1.2).
--
-- After SET LOCAL ends, a pooled connection keeps app.current_tenant_id as ''
-- rather than unset, so `current_setting(...)::uuid` raised "invalid input
-- syntax for type uuid" for any later query outside withTenantContext. That
-- surfaced as a 500 instead of an empty result. Every policy now reads the
-- setting through NULLIF, so a missing or cleared context matches nothing.
-- Superuser connections bypassed RLS, which is why this was never seen.

DO $$
DECLARE
  p          record;
  old_expr   constant text := '(current_setting(''app.current_tenant_id''::text, true))::uuid';
  new_expr   constant text := '(NULLIF(current_setting(''app.current_tenant_id''::text, true), ''''::text))::uuid';
  using_expr text;
  check_expr text;
BEGIN
  FOR p IN
    SELECT pol.polname, n.nspname, c.relname,
           pg_get_expr(pol.polqual, pol.polrelid)      AS qual,
           pg_get_expr(pol.polwithcheck, pol.polrelid) AS withcheck
    FROM pg_policy pol
    JOIN pg_class c     ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'documents')
  LOOP
    using_expr := replace(p.qual, old_expr, new_expr);
    check_expr := replace(p.withcheck, old_expr, new_expr);
    IF using_expr IS DISTINCT FROM p.qual THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s)', p.polname, p.nspname, p.relname, using_expr);
    END IF;
    IF check_expr IS DISTINCT FROM p.withcheck THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I WITH CHECK (%s)', p.polname, p.nspname, p.relname, check_expr);
    END IF;
  END LOOP;
END
$$;
