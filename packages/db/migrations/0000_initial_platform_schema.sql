-- Revelation SRS — Phase 3 Platform Foundation Schema
-- Migration: 0000_initial_platform_schema
-- Applied by: packages/db/src/migrate.ts

-- ── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Tenant ───────────────────────────────────────────────────────────────────
-- No RLS; managed by system-administrator role only.
CREATE TABLE IF NOT EXISTS "tenant" (
  "id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "code"          text        NOT NULL,
  "name"          text        NOT NULL,
  "configuration" jsonb       NOT NULL DEFAULT '{}',
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "active"        boolean     NOT NULL DEFAULT true,
  CONSTRAINT "tenant_code_unique" UNIQUE ("code")
);

-- ── Audit Record ──────────────────────────────────────────────────────────────
-- Append-only; no RLS; application role has INSERT + SELECT only.
CREATE TABLE IF NOT EXISTS "audit_record" (
  "id"                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"            uuid,
  "entity_type"          text        NOT NULL,
  "entity_id"            uuid        NOT NULL,
  "field_name"           text,
  "before_value"         jsonb,
  "after_value"          jsonb,
  "action_type"          text        NOT NULL,
  "actor_type"           text        NOT NULL,
  "actor_id"             text        NOT NULL,
  "actor_display_name"   text,
  "occurred_at"          timestamptz NOT NULL DEFAULT now(),
  "correlation_id"       uuid,
  "workflow_instance_id" text,
  "reason_code"          text,
  "reason_text"          text
);

-- Index for tenant + entity lookups
CREATE INDEX "audit_record_tenant_entity_idx"
  ON "audit_record" ("tenant_id", "entity_type", "entity_id");

-- ── Integration Contract Catalogue ───────────────────────────────────────────
-- Platform-level table; no RLS.
CREATE TABLE IF NOT EXISTS "integration_contract" (
  "id"                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "contract_id"              text        NOT NULL,
  "display_name"             text        NOT NULL,
  "owner_module_code"        text        NOT NULL,
  "direction_code"           text        NOT NULL,
  "pattern_type"             text        NOT NULL,
  "current_contract_version" text        NOT NULL,
  "data_classification_code" text        NOT NULL,
  "created_at"               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "integration_contract_id_unique" UNIQUE ("contract_id")
);

-- ── Integration Registration (Plugin Registry) ───────────────────────────────
-- Per-tenant; subject to RLS.
CREATE TABLE IF NOT EXISTS "integration_registration" (
  "id"                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                   uuid        NOT NULL REFERENCES "tenant"("id"),
  "integration_contract_id"     uuid        NOT NULL REFERENCES "integration_contract"("id"),
  "integration_code"            text        NOT NULL,
  "display_name"                text        NOT NULL,
  "contract_version"            text        NOT NULL,
  "transport_code"              text        NOT NULL,
  "subject_filter"              text,
  "consumer_group"              text,
  "endpoint_url"                text,
  "file_schedule"               text,
  "secret_ref"                  text,
  "replay_supported"            boolean     NOT NULL DEFAULT false,
  "retry_policy"                jsonb,
  "enabled"                     boolean     NOT NULL DEFAULT false,
  "configuration"               jsonb       NOT NULL DEFAULT '{}',
  "last_health_check_at"        timestamptz,
  "health_status_code"          text,
  "last_successful_exchange_at" timestamptz,
  "registered_at"               timestamptz NOT NULL DEFAULT now(),
  "last_updated_at"             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "integration_registration_tenant_code_unique" UNIQUE ("tenant_id", "integration_code")
);

ALTER TABLE "integration_registration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integration_registration" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "integration_registration"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Integration Exchange Ledger ───────────────────────────────────────────────
-- Append-only per-tenant exchange log; subject to RLS.
CREATE TABLE IF NOT EXISTS "integration_exchange" (
  "id"                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                   uuid        NOT NULL REFERENCES "tenant"("id"),
  "integration_registration_id" uuid        NOT NULL REFERENCES "integration_registration"("id"),
  "contract_id"                 text        NOT NULL,
  "direction_code"              text        NOT NULL,
  "exchange_type_code"          text        NOT NULL,
  "idempotency_key"             text        NOT NULL,
  "correlation_id"              uuid,
  "source_reference"            text,
  "status_code"                 text        NOT NULL,
  "attempt_count"               smallint    NOT NULL DEFAULT 0,
  "last_attempt_at"             timestamptz,
  "last_error"                  text,
  "payload_hash"                text,
  "payload_summary"             jsonb,
  "received_at"                 timestamptz,
  "sent_at"                     timestamptz,
  "created_at"                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "integration_exchange_idempotency_unique"
    UNIQUE ("tenant_id", "integration_registration_id", "idempotency_key")
);

ALTER TABLE "integration_exchange" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integration_exchange" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "integration_exchange"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Valid Value Sets ─────────────────────────────────────────────────────────
-- Platform-level catalogue; no RLS (all authenticated users can read).
CREATE TABLE IF NOT EXISTS "value_set" (
  "id"             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "set_code"       text        NOT NULL,
  "display_name"   text        NOT NULL,
  "source"         text        NOT NULL,
  "source_version" text,
  "description"    text,
  "is_extensible"  boolean     NOT NULL DEFAULT false,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "value_set_code_unique" UNIQUE ("set_code")
);

-- Individual values; RLS allows all tenants to see platform values
-- (tenant_id IS NULL) and each tenant to see its own extensions.
CREATE TABLE IF NOT EXISTS "value_set_member" (
  "id"              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "value_set_id"    uuid        NOT NULL REFERENCES "value_set"("id"),
  "tenant_id"       uuid        REFERENCES "tenant"("id"),
  "code"            text        NOT NULL,
  "display_label"   text        NOT NULL,
  "description"     text,
  "sort_order"      smallint    NOT NULL DEFAULT 0,
  "active_from"     timestamptz NOT NULL DEFAULT now(),
  "active_to"       timestamptz,
  "source_metadata" jsonb,
  "created_at"      timestamptz NOT NULL DEFAULT now()
);

-- Platform codes unique within their set
CREATE UNIQUE INDEX "vsm_platform_code_unique"
  ON "value_set_member" ("value_set_id", "code")
  WHERE "tenant_id" IS NULL;

-- Tenant extension codes unique per tenant within their set
CREATE UNIQUE INDEX "vsm_tenant_code_unique"
  ON "value_set_member" ("value_set_id", "tenant_id", "code")
  WHERE "tenant_id" IS NOT NULL;

ALTER TABLE "value_set_member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "value_set_member" FORCE ROW LEVEL SECURITY;
CREATE POLICY value_set_member_visibility ON "value_set_member"
  USING (
    "tenant_id" IS NULL
    OR "tenant_id" = current_setting('app.current_tenant_id', true)::uuid
  );

-- Maps a data-model field to the value set that governs its valid codes.
CREATE TABLE IF NOT EXISTS "field_value_set" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "entity_name"    text NOT NULL,
  "field_name"     text NOT NULL,
  "value_set_code" text NOT NULL REFERENCES "value_set"("set_code"),
  "description"    text,
  CONSTRAINT "field_value_set_unique" UNIQUE ("entity_name", "field_name")
);

-- ── Academic Rule (Bitemporal) ────────────────────────────────────────────────
-- Configuration-driven rules used by the rules engine; per-tenant; RLS.
CREATE TABLE IF NOT EXISTS "academic_rule" (
  "version_id"     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"             uuid        NOT NULL,
  "tenant_id"      uuid        NOT NULL REFERENCES "tenant"("id"),
  "programme_id"   uuid,
  "rule_type_code" text        NOT NULL,
  "rule_key"       text        NOT NULL,
  "rule_value"     jsonb       NOT NULL,
  "description"    text,
  "applies_to_level" smallint,
  "valid_from"     timestamptz NOT NULL,
  "valid_to"       timestamptz,
  "recorded_at"    timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz,
  CONSTRAINT "academic_rule_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "academic_rule_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX "academic_rule_unique_logical_transaction"
  ON "academic_rule" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX "academic_rule_current_version_unique"
  ON "academic_rule" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

ALTER TABLE "academic_rule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "academic_rule" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "academic_rule"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
