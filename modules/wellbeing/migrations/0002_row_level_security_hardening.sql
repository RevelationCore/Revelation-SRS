-- 0002_row_level_security_hardening
--
-- Runs the wellbeing service under row-level security, as phase 1 did for
-- the core API (BL-034, BL-035).
--
-- 1. The service connects as a login role inheriting srs_app (OpenBao grants
--    srs_app to every service's dynamic role), so srs_app needs this
--    schema's privileges explicitly: the module may be migrated into a
--    database where the core migrations' default privileges do not apply.
--    The audit log is append-only.
-- 2. The two SRS hand-off outboxes carry a tenant_id but had no RLS.
-- 3. Every policy cast current_setting('app.current_tenant_id', true) to
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

GRANT USAGE ON SCHEMA wellbeing TO srs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA wellbeing TO srs_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA wellbeing TO srs_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA wellbeing GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO srs_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA wellbeing GRANT USAGE, SELECT ON SEQUENCES TO srs_app;
REVOKE UPDATE, DELETE, TRUNCATE ON wellbeing.audit_log FROM srs_app;

-- Enabled with a policy since 0000, but not forced (found by the coverage
-- test): the owner would bypass it.
ALTER TABLE wellbeing.sar_export_log FORCE ROW LEVEL SECURITY;

ALTER TABLE wellbeing.srs_handoff_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE wellbeing.srs_handoff_outbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON wellbeing.srs_handoff_outbox;
CREATE POLICY tenant_isolation ON wellbeing.srs_handoff_outbox
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE wellbeing.srs_ec_handoff_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE wellbeing.srs_ec_handoff_outbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON wellbeing.srs_ec_handoff_outbox;
CREATE POLICY tenant_isolation ON wellbeing.srs_ec_handoff_outbox
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname
    FROM   pg_policies
    WHERE  schemaname = 'wellbeing'
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
