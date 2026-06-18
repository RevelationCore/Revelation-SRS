-- Revelation SRS — Phase 10.5 Stage 1: Demo Status and Checkpoint Tables
-- Migration: 0023_demo_status_checkpoint
-- Applied by: packages/db/src/migrate.ts
--
-- demo_status: one row per demo tenant recording the currently-loaded scenario,
--   the clock offset (referenceDate - wall-clock time at load), and rotation
--   metadata consumed by GET /api/v1/demo/status and the demo site banner.
--
-- demo_load_checkpoint: one row per demo tenant recording the last committed
--   load phase, enabling interrupted scenario loads to resume rather than
--   restart from scratch.

CREATE TABLE "demo_status" (
  "id"              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"       uuid        NOT NULL REFERENCES "tenant"("id"),
  "scenario_slug"   text        NOT NULL,
  "scenario_name"   text        NOT NULL,
  "schema_version"  text        NOT NULL,
  "reference_date"  date        NOT NULL,
  "clock_offset_ms" bigint      NOT NULL,
  "loaded_at"       timestamptz NOT NULL DEFAULT now(),
  "next_reset_at"   timestamptz,
  CONSTRAINT "demo_status_tenant_unique" UNIQUE ("tenant_id")
);

CREATE TABLE "demo_load_checkpoint" (
  "id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"     uuid        NOT NULL REFERENCES "tenant"("id"),
  "scenario_slug" text        NOT NULL,
  "phase_name"    text        NOT NULL,
  "updated_at"    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "demo_load_checkpoint_tenant_unique" UNIQUE ("tenant_id")
);
