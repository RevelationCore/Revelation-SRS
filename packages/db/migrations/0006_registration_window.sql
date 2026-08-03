-- Revelation SRS — Registration window enforcement
-- Migration: 0006_registration_window
--
-- Technical debt item: ModuleRegistrationService.createRegistration used to
-- call a #validateRegistrationWindow method that was removed during UAT
-- because the AUTUMN 2025 teaching period had passed. Tenant configuration
-- already carries a registrationWindowMode key (see
-- apps/api/test/tenant-admin.int.test.ts) that was never wired to any real
-- behaviour. This migration adds the missing registration_window table so
-- admins can set an explicit open/close window per academic period; the
-- service only enforces it when a tenant's configuration.registrationWindowMode
-- is 'academic-period', so tenants that leave it unset keep the previous
-- unrestricted behaviour.

CREATE TABLE IF NOT EXISTS "registration_window" (
  "id"                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"          uuid        NOT NULL REFERENCES "tenant"("id"),
  "academic_period_id" uuid        NOT NULL REFERENCES "academic_period"("id"),
  "opens_at"           timestamptz NOT NULL,
  "closes_at"          timestamptz NOT NULL,
  CONSTRAINT "registration_window_tenant_period_unique"
    UNIQUE ("tenant_id", "academic_period_id"),
  CONSTRAINT "registration_window_closes_after_opens"
    CHECK ("closes_at" > "opens_at")
);

CREATE INDEX IF NOT EXISTS "registration_window_tenant_period_idx"
  ON "registration_window" ("tenant_id", "academic_period_id");

ALTER TABLE "registration_window" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "registration_window" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "registration_window";
CREATE POLICY tenant_isolation ON "registration_window"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
