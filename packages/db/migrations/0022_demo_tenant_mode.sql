-- Revelation SRS — Phase 10.5 Stage 0: Demo Tenant Mode
-- Migration: 0022_demo_tenant_mode
-- Applied by: packages/db/src/migrate.ts
--
-- Adds demo_mode to the tenant table.
-- A tenant with demo_mode = TRUE is the only valid target for the demo data
-- reset commands (pnpm demo:reset). This is the primary safety gate:
-- no reset command may execute against a tenant where demo_mode = FALSE,
-- regardless of any other environment flag.
--
-- All existing tenants default to demo_mode = FALSE (no behavioural change).
-- Demo tenants must be explicitly opted in via a system-administrator operation.

ALTER TABLE "tenant" ADD COLUMN "demo_mode" boolean NOT NULL DEFAULT false;
