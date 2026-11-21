-- Local application login role (enterprise readiness plan, item 1.1).
--
-- Migrations run as the owner (srs, MIGRATION_DATABASE_URL). The API and the
-- other services connect as srs_api (DATABASE_URL), which inherits srs_app:
-- not a superuser, not the owner, no BYPASSRLS, so row-level security applies.
-- The core migration 0001_security_and_tenant_isolation grants srs_app its
-- table privileges; it creates srs_app too when this script has not run.
--
-- Runs only when the data directory is first initialised. For an existing
-- local volume, run this file once with psql as srs, or recreate the volume.
-- Local development credentials only.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'srs_app') THEN
    CREATE ROLE srs_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'srs_api') THEN
    CREATE ROLE srs_api LOGIN PASSWORD 'srs_api' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT;
  END IF;
END
$$;

GRANT srs_app TO srs_api;
