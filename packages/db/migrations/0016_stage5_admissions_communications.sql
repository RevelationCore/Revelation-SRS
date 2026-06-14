-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0016 — Stage 5: Admissions and Communications Clean Cut
--
-- Adds:
--   1. Three feature flags for communication channel strategy:
--        communications.channel.email.enabled         — email dispatch
--        communications.channel.crm-handoff.enabled   — CRM integration handoff
--        communications.channel.integration-event.enabled — integration event publish
--
--   2. communication_template — locale-aware message templates, one row per
--      (template_key, channel_code, locale_code, tenant_id/system).
--      System-level templates are seeded here; tenants may override.
--
--   3. communication_dispatch_log — append-only audit record for every
--      communication dispatch attempt, whether sent, suppressed, or failed.
--
--   4. Two seed system templates (en-GB defaults):
--        admissions.application-received / integration-event
--        enrolment.welcome              / integration-event
--
--   5. Two active workflow trigger rules replacing the Stage 2 placeholder:
--        admissions.handoff-started      → communication-dispatch
--        enrolment.created.welcome       → communication-dispatch
--
-- What does NOT change:
--   - Admissions workflow definitions (all 5 routes seeded in 0009).
--   - UCAS is already an adapter: admissions.legacy-ucas-auto-enrolment.enabled
--     is retired (seeded as status='retired' in 0009). No change needed here.
--   - communications.locale-aware.enabled already exists from 0013; not re-seeded.
--   - enrolment downstream triggers (ucas-confirmation, slc-confirmation,
--     ukvi-cas) are unchanged — they are regulatory, not communication.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Section 1: Communication channel strategy flags ───────────────────────────

WITH stage5_flags AS (
  INSERT INTO "feature_flag" (
    "flag_key", "display_name", "description",
    "owner_module_code", "status_code", "value_type_code", "default_variant_key", "created_by"
  )
  VALUES
    ('communications.channel.email.enabled',
     'Email channel enabled',
     'When on, the communication dispatch service delivers messages via email. '
     'When off, email dispatch is suppressed and recorded with status suppressed.',
     'communications', 'active', 'boolean', 'off', 'system'),

    ('communications.channel.crm-handoff.enabled',
     'CRM handoff channel enabled',
     'When on, the communication dispatch service forwards communication context '
     'to the configured CRM integration endpoint for external delivery. '
     'When off, CRM handoff is suppressed.',
     'communications', 'active', 'boolean', 'off', 'system'),

    ('communications.channel.integration-event.enabled',
     'Integration event channel enabled',
     'When on, the communication dispatch service publishes a structured '
     'integration event that external consumers can act on. '
     'When off, event publication is suppressed.',
     'communications', 'active', 'boolean', 'off', 'system')

  ON CONFLICT ("flag_key") DO UPDATE SET
    "display_name"        = EXCLUDED."display_name",
    "description"         = EXCLUDED."description",
    "status_code"         = EXCLUDED."status_code",
    "default_variant_key" = EXCLUDED."default_variant_key",
    "updated_at"          = now()
  RETURNING "id", "flag_key"
)
INSERT INTO "feature_flag_variant" ("flag_id", "variant_key", "display_name", "value", "sort_order")
SELECT f."id", v."variant_key", v."display_name", v."value"::jsonb, v."sort_order"
FROM stage5_flags f
JOIN (VALUES
  ('communications.channel.email.enabled',              'off', 'Off', 'false', 10),
  ('communications.channel.email.enabled',              'on',  'On',  'true',  20),
  ('communications.channel.crm-handoff.enabled',        'off', 'Off', 'false', 10),
  ('communications.channel.crm-handoff.enabled',        'on',  'On',  'true',  20),
  ('communications.channel.integration-event.enabled',  'off', 'Off', 'false', 10),
  ('communications.channel.integration-event.enabled',  'on',  'On',  'true',  20)
) AS v("flag_key", "variant_key", "display_name", "value", "sort_order")
  ON f."flag_key" = v."flag_key"
ON CONFLICT ("flag_id", "variant_key") DO UPDATE SET
  "display_name" = EXCLUDED."display_name",
  "value"        = EXCLUDED."value",
  "sort_order"   = EXCLUDED."sort_order";

-- ── Section 2: communication_template table ───────────────────────────────────
--
-- Locale resolution order for dispatch:
--   1. Exact match: (template_key, channel_code, preferredLocale, tenant_id)
--   2. Tenant fallback locale: (template_key, channel_code, fallbackLocale, tenant_id)
--   3. System preferred: (template_key, channel_code, preferredLocale, NULL)
--   4. System fallback: (template_key, channel_code, fallbackLocale, NULL)
--   5. System en-GB: (template_key, channel_code, 'en-GB', NULL)
--
-- body_template and subject_template support simple {key} placeholder
-- substitution resolved in CommunicationService.dispatch().

CREATE TABLE IF NOT EXISTS "communication_template" (
  "id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        uuid        REFERENCES "tenant"("id"),
  "template_key"     text        NOT NULL,
  "channel_code"     text        NOT NULL,
  "locale_code"      text        NOT NULL DEFAULT 'en-GB',
  "subject_template" text,
  "body_template"    text        NOT NULL,
  "version"          integer     NOT NULL DEFAULT 1,
  "active"           boolean     NOT NULL DEFAULT true,
  "created_by"       text        NOT NULL DEFAULT 'system',
  "created_at"       timestamptz NOT NULL DEFAULT now()
);

-- System-level templates (tenant_id IS NULL): one per (key, channel, locale)
CREATE UNIQUE INDEX IF NOT EXISTS "comm_template_system_unique_idx"
  ON "communication_template" ("template_key", "channel_code", "locale_code")
  WHERE "tenant_id" IS NULL;

-- Tenant-specific templates: one per (key, channel, locale, tenant)
CREATE UNIQUE INDEX IF NOT EXISTS "comm_template_tenant_unique_idx"
  ON "communication_template" ("template_key", "channel_code", "locale_code", "tenant_id")
  WHERE "tenant_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "comm_template_lookup_idx"
  ON "communication_template" ("template_key", "channel_code", "locale_code")
  WHERE "active" = true;

-- ── Section 3: communication_dispatch_log table ───────────────────────────────
--
-- Append-only. Every dispatch attempt — including suppressed and failed — is
-- recorded. This is the audit evidence for the exit criterion
-- "communications are workflow-triggered and auditable".

CREATE TABLE IF NOT EXISTS "communication_dispatch_log" (
  "id"                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"            uuid        NOT NULL REFERENCES "tenant"("id"),
  "template_key"         text        NOT NULL,
  "channel_code"         text        NOT NULL,
  "locale_code"          text        NOT NULL,
  "subject_entity_type"  text        NOT NULL,
  "subject_entity_id"    uuid        NOT NULL,
  "recipient_ref"        text,
  "payload"              jsonb       NOT NULL DEFAULT '{}',
  "workflow_instance_id" uuid,
  "status_code"          text        NOT NULL DEFAULT 'dispatched',
  "suppression_reason"   text,
  "dispatched_at"        timestamptz NOT NULL DEFAULT now(),
  "dispatched_by"        text        NOT NULL
);

CREATE INDEX IF NOT EXISTS "comm_dispatch_log_tenant_idx"
  ON "communication_dispatch_log" ("tenant_id", "dispatched_at" DESC);

CREATE INDEX IF NOT EXISTS "comm_dispatch_log_subject_idx"
  ON "communication_dispatch_log" ("tenant_id", "subject_entity_type", "subject_entity_id");

-- ── Section 4: Seed system-level communication templates (en-GB) ─────────────
--
-- These are the minimum templates needed to prove locale-aware dispatch
-- works end-to-end. They use the integration-event channel — the SRS
-- publishes a structured event; external systems consume and render.

INSERT INTO "communication_template" (
  "id", "tenant_id", "template_key", "channel_code", "locale_code",
  "subject_template", "body_template", "version", "active", "created_by"
)
VALUES
  (gen_random_uuid(), NULL,
   'admissions.application-received', 'integration-event', 'en-GB',
   NULL,
   '{"eventType": "admissions.application-received", "message": "Your application has been received and is being reviewed. Reference: {sourceApplicationReference}.", "locale": "en-GB"}',
   1, true, 'system'),

  (gen_random_uuid(), NULL,
   'enrolment.welcome', 'integration-event', 'en-GB',
   NULL,
   '{"eventType": "enrolment.welcome", "message": "Welcome to {institutionName}. Your enrolment for {academicYear} has been confirmed.", "locale": "en-GB"}',
   1, true, 'system'),

  (gen_random_uuid(), NULL,
   'enrolment.welcome', 'email', 'en-GB',
   'Welcome to your studies at {institutionName}',
   'Dear {studentName},\n\nWelcome to {institutionName}! Your enrolment for {academicYear} has been confirmed.\n\nIf you have any questions, please contact the registry.\n\nBest regards,\nRegistry Team',
   1, true, 'system')

ON CONFLICT DO NOTHING;

-- ── Section 5: Activate communication workflow trigger rules ──────────────────
--
-- Replace the Stage 2 placeholder (enrolment-created-future-communication,
-- target_workflow_code='future-communication-endpoint', active=false) with
-- real trigger rules that route to the communication-dispatch workflow.
--
-- Note: these rules are seeded globally (tenant_id IS NULL) so they apply
-- to all tenants by default. Tenants can override via tenant-scoped rules.

UPDATE "workflow_trigger_rule"
SET "active" = false
WHERE "trigger_key" = 'enrolment-created-future-communication';

INSERT INTO "workflow_trigger_rule" (
  "trigger_key", "event_type", "target_workflow_code",
  "condition_expression", "active", "configuration"
)
VALUES
  ('admissions.handoff-started.application-received-comms',
   'admissions.handoff-started',
   'communication-dispatch',
   'always',
   true,
   '{"templateKey": "admissions.application-received", "channelCode": "integration-event", "subjectEntityType": "ucas_application", "note": "Triggered when any admissions source starts a workflow handoff. CommunicationService resolves the channel via flag."}'),

  ('enrolment.created.welcome-comms',
   'enrolment.created',
   'communication-dispatch',
   'always',
   true,
   '{"templateKey": "enrolment.welcome", "channelCode": "integration-event", "subjectEntityType": "enrolment", "note": "Welcome communication dispatched on enrolment creation for all new students."}')

ON CONFLICT DO NOTHING;
