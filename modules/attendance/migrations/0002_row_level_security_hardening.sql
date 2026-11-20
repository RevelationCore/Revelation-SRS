-- 0002_row_level_security_hardening
--
-- Runs the attendance service under row-level security, as phase 1 did for
-- the core API (BL-034).
--
-- 1. The service connects as a login role inheriting srs_app (OpenBao grants
--    srs_app to every service's dynamic role), so srs_app needs this
--    schema's privileges explicitly: the module may be migrated into a
--    database where the core migrations' default privileges do not apply.
-- 2. Every policy cast current_setting('app.current_tenant_id', true) to
--    uuid directly. A pooled connection that has left a tenant context reads
--    the setting as '' and the cast throws, so any query outside a tenant
--    context failed with a 500 instead of seeing nothing. NULLIF turns an
--    empty setting into NULL, which matches no row.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'srs_app') THEN
    CREATE ROLE srs_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA attendance TO srs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA attendance TO srs_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA attendance TO srs_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA attendance GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO srs_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA attendance GRANT USAGE, SELECT ON SEQUENCES TO srs_app;

DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname
    FROM   pg_policies
    WHERE  schemaname = 'attendance'
      AND  qual LIKE '%current_setting(''app.current_tenant_id''%'
      AND  qual NOT LIKE '%NULLIF%'
  LOOP
    EXECUTE format(
      'ALTER POLICY %I ON %I.%I USING (tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid)',
      p.policyname, p.schemaname, p.tablename
    );
  END LOOP;
END
$$;
