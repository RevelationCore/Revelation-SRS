-- ============================================================
-- Originally: 0011_environment_promotion_hardening.sql
-- ============================================================

-- Revelation SRS — Environment Promotion Hardening
-- Migration: 0011_environment_promotion_hardening
--
-- Stage 9 makes environment identity and integration endpoint safety explicit.

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('integration-endpoint-safety-class', 'Integration endpoint safety class', 'srs-internal', '2026-06-14', 'Safety classification for configured integration endpoints.', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, v.code, v.display_label, v.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('integration-endpoint-safety-class', 'simulator', 'Simulator', 10),
  ('integration-endpoint-safety-class', 'external-test', 'External test endpoint', 20),
  ('integration-endpoint-safety-class', 'external-production', 'External production endpoint', 30)
) AS v(set_code, code, display_label, sort_order)
  ON v.set_code = vs.set_code
ON CONFLICT DO NOTHING;

UPDATE "deployment_environment"
SET "configuration" = "configuration" || jsonb_build_object(
  'defaultEndpointSafetyClass',
  CASE
    WHEN "environment_code" = 'prod' THEN 'external-production'
    WHEN "environment_code" IN ('uat', 'preprod') THEN 'external-test'
    ELSE 'simulator'
  END,
  'requiresLiveTrafficApproval',
  CASE
    WHEN "environment_code" = 'prod' THEN false
    ELSE true
  END
),
"updated_at" = now()
WHERE "environment_code" IN ('local', 'test', 'uat', 'preprod', 'prod');

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('integration_registration.configuration', 'endpointSafetyClass', 'integration-endpoint-safety-class', 'Integration endpoint safety class stored in registration configuration JSON.')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;


-- ============================================================
-- Originally: 0012_globalisation_foundation.sql
-- ============================================================

-- Revelation SRS — Globalisation Foundation
-- Migration: 0012_globalisation_foundation
--
-- Stage 1 of the Clean SRS Convergence: makes locale, time zone, and currency
-- first-class platform concerns rather than implicit GBP/en-GB assumptions.
--
-- New tables:
--   locale_resource_pack         - registry of available BCP-47 locale packs
--   tenant_locale_config         - per-tenant locale and time-zone settings
--   value_set_member_label       - translated display labels for value set members
--   currency                     - ISO 4217 currency registry
--   exchange_rate                - effective-dated, auditable exchange rates
--   tenant_currency_config       - per-tenant currency settings
--
-- Column additions:
--   person_identity.communication_locale_code
--   person_identity.preferred_time_zone
--   fee_liability.currency_code
--   fee_liability.amount_minor_units

-- ── Locale Resource Pack ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "locale_resource_pack" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "locale_code"         text        NOT NULL,
  "display_name"        text        NOT NULL,
  "native_display_name" text        NOT NULL,
  "is_rtl"              boolean     NOT NULL DEFAULT false,
  "is_platform_default" boolean     NOT NULL DEFAULT false,
  "active"              boolean     NOT NULL DEFAULT true,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "locale_resource_pack_code_unique" UNIQUE ("locale_code")
);

-- ── Tenant Locale Configuration ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "tenant_locale_config" (
  "id"                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"          uuid        NOT NULL REFERENCES "tenant"("id"),
  "default_locale"     text        NOT NULL DEFAULT 'en-GB',
  "fallback_locale"    text        NOT NULL DEFAULT 'en-GB',
  "supported_locales"  text[]      NOT NULL DEFAULT '{en-GB}',
  "default_time_zone"  text        NOT NULL DEFAULT 'Europe/London',
  "date_format_code"   text        NOT NULL DEFAULT 'iso',
  "first_day_of_week"  smallint    NOT NULL DEFAULT 1,
  "created_at"         timestamptz NOT NULL DEFAULT now(),
  "updated_at"         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "tenant_locale_config_tenant_unique" UNIQUE ("tenant_id"),
  CONSTRAINT "tenant_locale_config_day_check" CHECK ("first_day_of_week" BETWEEN 1 AND 7)
);

ALTER TABLE "tenant_locale_config" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_locale_config" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tenant_locale_config";
CREATE POLICY tenant_isolation ON "tenant_locale_config"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Translated Value Set Member Labels ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS "value_set_member_label" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "value_set_member_id" uuid        NOT NULL REFERENCES "value_set_member"("id"),
  "locale_code"         text        NOT NULL,
  "display_label"       text        NOT NULL,
  "description"         text,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "value_set_member_label_unique" UNIQUE ("value_set_member_id", "locale_code")
);

CREATE INDEX IF NOT EXISTS "value_set_member_label_member_idx"
  ON "value_set_member_label" ("value_set_member_id");

-- ── Currency Registry ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "currency" (
  "id"           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "currency_code" text       NOT NULL,
  "numeric_code"  text,
  "display_name"  text       NOT NULL,
  "symbol"        text,
  "minor_units"   smallint   NOT NULL DEFAULT 2,
  "active"        boolean    NOT NULL DEFAULT true,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "currency_code_unique" UNIQUE ("currency_code"),
  CONSTRAINT "currency_minor_units_check" CHECK ("minor_units" >= 0 AND "minor_units" <= 4)
);

-- ── Exchange Rates ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "exchange_rate" (
  "id"                 uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  "from_currency_code" text           NOT NULL REFERENCES "currency"("currency_code"),
  "to_currency_code"   text           NOT NULL REFERENCES "currency"("currency_code"),
  "rate"               numeric(20,10) NOT NULL,
  "effective_date"     date           NOT NULL,
  "source"             text           NOT NULL,
  "source_reference"   text,
  "recorded_at"        timestamptz    NOT NULL DEFAULT now(),
  "recorded_by"        text           NOT NULL DEFAULT 'system',
  CONSTRAINT "exchange_rate_different_currencies"
    CHECK ("from_currency_code" <> "to_currency_code"),
  CONSTRAINT "exchange_rate_positive_rate"
    CHECK ("rate" > 0),
  CONSTRAINT "exchange_rate_unique"
    UNIQUE ("from_currency_code", "to_currency_code", "effective_date")
);

CREATE INDEX IF NOT EXISTS "exchange_rate_lookup_idx"
  ON "exchange_rate" ("from_currency_code", "to_currency_code", "effective_date" DESC);

-- ── Tenant Currency Configuration ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "tenant_currency_config" (
  "id"                           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                    uuid        NOT NULL REFERENCES "tenant"("id"),
  "default_currency_code"        text        NOT NULL DEFAULT 'GBP' REFERENCES "currency"("currency_code"),
  "accepted_currencies"          text[]      NOT NULL DEFAULT '{GBP}',
  "requires_conversion_evidence" boolean     NOT NULL DEFAULT false,
  "created_at"                   timestamptz NOT NULL DEFAULT now(),
  "updated_at"                   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "tenant_currency_config_tenant_unique" UNIQUE ("tenant_id")
);

ALTER TABLE "tenant_currency_config" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_currency_config" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tenant_currency_config";
CREATE POLICY tenant_isolation ON "tenant_currency_config"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Person Identity: locale and time-zone preferences ───────────────────────

ALTER TABLE "person_identity"
  ADD COLUMN IF NOT EXISTS "communication_locale_code" text,
  ADD COLUMN IF NOT EXISTS "preferred_time_zone"       text;

-- ── Fee Liability: currency-aware monetary amount ────────────────────────────
-- amount_pence (legacy, GBP-implicit) is retained for backward compatibility.
-- amount_minor_units (new) stores the amount in the minor units of currency_code.
-- Stage 7 removes amount_pence once all fee records are migrated.

ALTER TABLE "fee_liability"
  ADD COLUMN IF NOT EXISTS "currency_code"      text DEFAULT 'GBP' REFERENCES "currency"("currency_code"),
  ADD COLUMN IF NOT EXISTS "amount_minor_units" bigint;

-- Back-fill currency_code and amount_minor_units for existing rows.
-- GBP minor units = pence, so amount_minor_units = amount_pence for existing rows.
UPDATE "fee_liability"
SET
  "currency_code"      = 'GBP',
  "amount_minor_units" = "amount_pence"
WHERE "currency_code" IS NULL OR "amount_minor_units" IS NULL;

-- Make currency_code NOT NULL now that all rows have a value.
ALTER TABLE "fee_liability"
  ALTER COLUMN "currency_code" SET NOT NULL;

-- ── Value Sets for locale and time-zone codes ────────────────────────────────

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible")
VALUES
  ('communication-locale-code', 'Communication Locale', 'srs-internal',
   'BCP-47 locale codes used for student/applicant communication preferences', false),
  ('time-zone-code', 'Time Zone', 'srs-internal',
   'IANA time zone identifiers supported by the platform', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('person_identity', 'communication_locale_code', 'communication-locale-code',
   'BCP-47 locale preference for student-facing communications'),
  ('person_identity', 'preferred_time_zone', 'time-zone-code',
   'IANA time zone preference for deadline and calendar display')
ON CONFLICT DO NOTHING;

-- ── Locale Resource Pack Seed Data ──────────────────────────────────────────

INSERT INTO "locale_resource_pack"
  ("locale_code", "display_name", "native_display_name", "is_rtl", "is_platform_default", "active")
VALUES
  ('en-GB', 'English (United Kingdom)', 'English (United Kingdom)', false, true,  true),
  ('en-US', 'English (United States)',  'English (United States)',  false, false, true),
  ('cy-GB', 'Welsh (United Kingdom)',   'Cymraeg (Y Deyrnas Unedig)', false, false, true),
  ('fr-FR', 'French (France)',          'Français (France)',         false, false, true),
  ('de-DE', 'German (Germany)',         'Deutsch (Deutschland)',     false, false, true),
  ('es-ES', 'Spanish (Spain)',          'Español (España)',          false, false, true),
  ('ar-SA', 'Arabic (Saudi Arabia)',    'العربية (المملكة العربية السعودية)', true, false, true),
  ('zh-CN', 'Chinese (Simplified)',     '中文（简体）',              false, false, true),
  ('hi-IN', 'Hindi (India)',            'हिन्दी (भारत)',             false, false, true),
  ('pt-BR', 'Portuguese (Brazil)',      'Português (Brasil)',        false, false, true)
ON CONFLICT ("locale_code") DO NOTHING;

-- Seed communication-locale-code value set members
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, v.code, v.display_label, v.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('communication-locale-code', 'en-GB', 'English (United Kingdom)', 10),
  ('communication-locale-code', 'en-US', 'English (United States)',  20),
  ('communication-locale-code', 'cy-GB', 'Welsh (United Kingdom)',   30),
  ('communication-locale-code', 'fr-FR', 'French (France)',          40),
  ('communication-locale-code', 'de-DE', 'German (Germany)',         50),
  ('communication-locale-code', 'es-ES', 'Spanish (Spain)',          60),
  ('communication-locale-code', 'ar-SA', 'Arabic (Saudi Arabia)',    70),
  ('communication-locale-code', 'zh-CN', 'Chinese (Simplified)',     80),
  ('communication-locale-code', 'hi-IN', 'Hindi (India)',            90),
  ('communication-locale-code', 'pt-BR', 'Portuguese (Brazil)',      100)
) AS v(set_code, code, display_label, sort_order)
  ON v.set_code = vs.set_code
ON CONFLICT DO NOTHING;

-- Seed time-zone-code value set members
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, v.code, v.display_label, v.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('time-zone-code', 'Europe/London',    'London (GMT/BST)',             10),
  ('time-zone-code', 'Europe/Dublin',    'Dublin (GMT/IST)',             20),
  ('time-zone-code', 'Europe/Paris',     'Paris (CET/CEST)',             30),
  ('time-zone-code', 'Europe/Berlin',    'Berlin (CET/CEST)',            40),
  ('time-zone-code', 'Europe/Madrid',    'Madrid (CET/CEST)',            50),
  ('time-zone-code', 'America/New_York', 'New York (ET)',                60),
  ('time-zone-code', 'America/Chicago',  'Chicago (CT)',                 70),
  ('time-zone-code', 'America/Denver',   'Denver (MT)',                  80),
  ('time-zone-code', 'America/Los_Angeles', 'Los Angeles (PT)',          90),
  ('time-zone-code', 'Asia/Dubai',       'Dubai (GST)',                  100),
  ('time-zone-code', 'Asia/Riyadh',      'Riyadh (AST)',                 110),
  ('time-zone-code', 'Asia/Kolkata',     'India (IST)',                  120),
  ('time-zone-code', 'Asia/Shanghai',    'China (CST)',                  130),
  ('time-zone-code', 'Asia/Singapore',   'Singapore (SGT)',              140),
  ('time-zone-code', 'Asia/Hong_Kong',   'Hong Kong (HKT)',              150),
  ('time-zone-code', 'Asia/Tokyo',       'Tokyo (JST)',                  160),
  ('time-zone-code', 'Australia/Sydney', 'Sydney (AEST/AEDT)',           170),
  ('time-zone-code', 'Pacific/Auckland', 'Auckland (NZST/NZDT)',         180),
  ('time-zone-code', 'Africa/Lagos',     'Lagos (WAT)',                  190),
  ('time-zone-code', 'UTC',              'UTC',                          200)
) AS v(set_code, code, display_label, sort_order)
  ON v.set_code = vs.set_code
ON CONFLICT DO NOTHING;

-- ── ISO 4217 Currency Seed Data ──────────────────────────────────────────────

INSERT INTO "currency" ("currency_code", "numeric_code", "display_name", "symbol", "minor_units", "active")
VALUES
  ('GBP', '826', 'Pound Sterling',        '£',  2, true),
  ('USD', '840', 'US Dollar',             '$',  2, true),
  ('EUR', '978', 'Euro',                  '€',  2, true),
  ('AUD', '036', 'Australian Dollar',     'A$', 2, true),
  ('CAD', '124', 'Canadian Dollar',       'C$', 2, true),
  ('NZD', '554', 'New Zealand Dollar',    'NZ$',2, true),
  ('SGD', '702', 'Singapore Dollar',      'S$', 2, true),
  ('HKD', '344', 'Hong Kong Dollar',      'HK$',2, true),
  ('CNY', '156', 'Chinese Yuan Renminbi', '¥',  2, true),
  ('INR', '356', 'Indian Rupee',          '₹',  2, true),
  ('NGN', '566', 'Nigerian Naira',        '₦',  2, true),
  ('JPY', '392', 'Japanese Yen',          '¥',  0, true),
  ('AED', '784', 'UAE Dirham',            'د.إ',2, true),
  ('SAR', '682', 'Saudi Riyal',           'ر.س',2, true),
  ('CHF', '756', 'Swiss Franc',           'Fr', 2, true),
  ('DKK', '208', 'Danish Krone',          'kr', 2, true),
  ('NOK', '578', 'Norwegian Krone',       'kr', 2, true),
  ('SEK', '752', 'Swedish Krona',         'kr', 2, true),
  ('MYR', '458', 'Malaysian Ringgit',     'RM', 2, true),
  ('THB', '764', 'Thai Baht',             '฿',  2, true)
ON CONFLICT ("currency_code") DO NOTHING;


-- ============================================================
-- Originally: 0013_workflow_coverage_matrix.sql
-- ============================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0013 — Stage 2: Workflow Coverage Matrix
--
-- Adds workflow definitions, versions, steps, decision gateways, and assignment
-- rules for every process-bearing domain not already covered by migration 0009.
-- Also seeds feature flags that govern workflow variant selection per domain.
--
-- Domains covered here (admissions workflows already seeded in 0009):
--   enrolment-change-approval       module-registration-change
--   assessment-mark-review          progression-review
--   award-classification            exam-board-governance
--   correction-case                 appeal-case
--   regulatory-submission-approval  finance-fee-handoff
--   identity-provisioning           communication-dispatch
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Section 1: Workflow Control Feature Flags ─────────────────────────────────

WITH coverage_flags AS (
  INSERT INTO "feature_flag" (
    "flag_key", "display_name", "description",
    "owner_module_code", "status_code", "value_type_code", "default_variant_key", "created_by"
  )
  VALUES
    ('enrolment.change-approval.required',
     'Enrolment change requires approval',
     'When on, enrolment status changes must be approved through the enrolment-change-approval workflow before taking effect.',
     'enrolment', 'active', 'boolean', 'off', 'system'),

    ('module-registration.approval.required',
     'Module registration change requires approval',
     'When on, add/drop/complete registration requests are routed through the module-registration-change approval workflow.',
     'module-registration', 'active', 'boolean', 'off', 'system'),

    ('assessment.moderation.workflow.enabled',
     'Assessment mark moderation uses workflow',
     'When on, marks ingested during a controlled period are routed through the assessment-mark-review workflow for moderation and review.',
     'assessment', 'active', 'boolean', 'off', 'system'),

    ('progression.board-review.enabled',
     'Progression review uses board workflow',
     'When on, discretionary progression decisions are routed through the progression-review board workflow.',
     'progression', 'active', 'boolean', 'off', 'system'),

    ('award.discretionary-review.enabled',
     'Award classification allows discretionary review',
     'When on, classification results in the borderline or exceptional range are routed through the award-classification discretionary review step.',
     'progression', 'active', 'boolean', 'off', 'system'),

    ('exam-board.external-examiner.required',
     'Exam board requires external examiner sign-off',
     'When on, the exam-board-governance workflow requires the external-examiner-review step before chair ratification.',
     'governance', 'active', 'boolean', 'on', 'system'),

    ('correction.panel-review.enabled',
     'Correction cases may require panel review',
     'When on, the correction-case workflow may route eligible cases to a review panel before outcome is decided.',
     'governance', 'active', 'boolean', 'off', 'system'),

    ('appeal.panel-hearing.enabled',
     'Appeals may require a panel hearing',
     'When on, the appeal-case workflow may route admissible appeals to a panel hearing before outcome is decided.',
     'governance', 'active', 'boolean', 'off', 'system'),

    ('regulatory.submission.manual-approval.required',
     'Regulatory submissions require manual approval',
     'When on, regulatory data submissions require an explicit approval step in the regulatory-submission-approval workflow before dispatch.',
     'regulatory', 'active', 'boolean', 'off', 'system'),

    ('finance.fee-handoff.enabled',
     'Finance fee handoff workflow enabled',
     'When on, fee liability events are routed through the finance-fee-handoff workflow for invoicing and external system notification.',
     'finance', 'active', 'boolean', 'off', 'system'),

    ('identity.deduplication.enabled',
     'Identity provisioning uses deduplication check',
     'When on, new person records are subject to a deduplication check and optional merge-review step in the identity-provisioning workflow.',
     'identity', 'active', 'boolean', 'off', 'system'),

    ('communications.locale-aware.enabled',
     'Communications use locale-aware dispatch',
     'When on, communication dispatch resolves locale and selects templates through the communication-dispatch workflow.',
     'communications', 'active', 'boolean', 'on', 'system')
  ON CONFLICT ("flag_key") DO UPDATE SET
    "display_name"       = EXCLUDED."display_name",
    "description"        = EXCLUDED."description",
    "owner_module_code"  = EXCLUDED."owner_module_code",
    "status_code"        = EXCLUDED."status_code",
    "value_type_code"    = EXCLUDED."value_type_code",
    "default_variant_key"= EXCLUDED."default_variant_key",
    "updated_at"         = now()
  RETURNING "id"
)
INSERT INTO "feature_flag_variant" ("flag_id", "variant_key", "display_name", "value", "sort_order")
SELECT f."id", v."variant_key", v."display_name", v."value"::jsonb, v."sort_order"
FROM coverage_flags f
JOIN (VALUES
  ('off', 'Off', 'false', 10),
  ('on',  'On',  'true',  20)
) AS v("variant_key", "display_name", "value", "sort_order") ON true
ON CONFLICT ("flag_id", "variant_key") DO UPDATE SET
  "display_name" = EXCLUDED."display_name",
  "value"        = EXCLUDED."value",
  "sort_order"   = EXCLUDED."sort_order";

-- ── Section 2: Workflow Definitions ──────────────────────────────────────────

INSERT INTO "workflow_definition" (
  "definition_code", "display_name", "owner_module_code",
  "status_code", "current_version_number", "description", "created_by"
)
VALUES
  ('enrolment-change-approval',
   'Enrolment Change Approval',
   'enrolment', 'active', 1,
   'Registry or school-led approval for enrolment status changes such as withdrawal, intermission, and reinstatement.',
   'system'),

  ('module-registration-change',
   'Module Registration Change',
   'module-registration', 'active', 1,
   'Add/drop/complete workflow covering registration window checks, prerequisite checks, capacity, and optional approval.',
   'system'),

  ('assessment-mark-review',
   'Assessment Mark Review',
   'assessment', 'active', 1,
   'Structured review of marks ingested during a controlled period: moderation, late-penalty decisions, result review, and approval before board.',
   'system'),

  ('progression-review',
   'Progression Review',
   'progression', 'active', 1,
   'Algorithm-driven progression decision with optional board review and discretionary decision gateway for boundary and exceptional cases.',
   'system'),

  ('award-classification',
   'Award Classification',
   'progression', 'active', 1,
   'Classification calculation, optional discretionary review, award approval, and graduation trigger for eligible students.',
   'system'),

  ('exam-board-governance',
   'Exam Board Governance',
   'governance', 'active', 1,
   'Board constitution, data-pack preparation, external examiner review, chair ratification, and non-bypassable record lock.',
   'system'),

  ('correction-case',
   'Correction Case',
   'governance', 'active', 1,
   'Academic correction case: eligibility assessment, evidence gathering, optional panel review, outcome decision, and locked-record amendment.',
   'system'),

  ('appeal-case',
   'Academic Appeal Case',
   'governance', 'active', 1,
   'Academic appeal processing: grounds assessment, evidence gathering, optional panel hearing, outcome decision, and optional amendment.',
   'system'),

  ('regulatory-submission-approval',
   'Regulatory Submission Approval',
   'regulatory', 'active', 1,
   'Environment-safe regulatory data submission: validation, optional manual approval, dispatch, and response processing.',
   'system'),

  ('finance-fee-handoff',
   'Finance Fee Handoff',
   'finance', 'active', 1,
   'Fee liability event processing: fee calculation, invoice generation, payment confirmation, and optional external finance system notification.',
   'system'),

  ('identity-provisioning',
   'Identity Provisioning',
   'identity', 'active', 1,
   'New person identity creation with deduplication check and optional merge-review step before confirmation.',
   'system'),

  ('communication-dispatch',
   'Communication Dispatch',
   'communications', 'active', 1,
   'Locale-aware communication dispatch: template selection, locale resolution, channel selection, message dispatch, and optional delivery confirmation.',
   'system')
ON CONFLICT (COALESCE("tenant_id", '00000000-0000-0000-0000-000000000000'::uuid), "definition_code")
DO UPDATE SET
  "display_name"            = EXCLUDED."display_name",
  "status_code"             = EXCLUDED."status_code",
  "current_version_number"  = EXCLUDED."current_version_number",
  "description"             = EXCLUDED."description",
  "updated_at"              = now();

-- ── Section 3: Workflow Definition Versions ───────────────────────────────────

INSERT INTO "workflow_definition_version" (
  "workflow_definition_id", "version_number", "status_code",
  "definition_json", "bpmn_source_id", "effective_from", "created_by"
)
SELECT
  wd."id",
  1,
  'active',
  jsonb_build_object(
    'startEvent',          v."start_event",
    'flagSnapshot',        v."flag_snapshot"::jsonb,
    'serviceInvariants',   v."service_invariants"::jsonb,
    'escalationPolicy',    v."escalation_policy"::jsonb,
    'terminalDataWrites',  v."terminal_data_writes"::jsonb
  ),
  NULL,
  '2026-06-14T00:00:00Z'::timestamptz,
  'system'
FROM "workflow_definition" wd
JOIN (VALUES
  ('enrolment-change-approval',
   'enrolment.status-change-requested',
   '["enrolment.change-approval.required"]',
   '["EnrolmentService.transitionStatus: bitemporal write, valid status, record-lock check"]',
   '{"defaultDeadlineDays": 5, "escalateToRole": "registry-administrator"}',
   '["enrolment.status_code updated bitemporally, audit record written"]'),

  ('module-registration-change',
   'module-registration.add-drop-requested',
   '["module-registration.approval.required"]',
   '["RegistrationService: duplicate check, capacity guard, prerequisite check, credit limit, bitemporal write"]',
   '{"defaultDeadlineDays": 3, "escalateToRole": "registry-administrator"}',
   '["module_registration row updated bitemporally, downstream triggers evaluated"]'),

  ('assessment-mark-review',
   'mark.ingested-on-controlled-period',
   '["assessment.moderation.workflow.enabled"]',
   '["MarkService: record-lock guard, valid-mark range, bitemporal write", "ModuleResultService: recalculation deterministic"]',
   '{"defaultDeadlineDays": 10, "escalateToRole": "exam-board-chair"}',
   '["mark bitemporally confirmed, module_result updated, moderation decision audit written"]'),

  ('progression-review',
   'progression.criteria-met',
   '["progression.board-review.enabled"]',
   '["ProgressionService.decide: valid algorithm, credit/mark thresholds, bitemporal persistence"]',
   '{"defaultDeadlineDays": 14, "escalateToRole": "exam-board-chair"}',
   '["progression_decision written, algorithm key and rule ids recorded, workflow decision audit"]'),

  ('award-classification',
   'award.eligible-signal',
   '["award.discretionary-review.enabled"]',
   '["AwardService: locked results required, valid classification, EnrolmentService.transitionStatus graduation"]',
   '{"defaultDeadlineDays": 14, "escalateToRole": "exam-board-chair"}',
   '["award row created, classification and algorithm evidence recorded, enrolment transitioned to graduated"]'),

  ('exam-board-governance',
   'exam-board.constitution-command',
   '["exam-board.external-examiner.required"]',
   '["BoardService.ratifyBoard: external-examiner signoff guard, record-lock writes for marks/results/progressions"]',
   '{"defaultDeadlineDays": 21, "escalateToRole": "exam-board-chair"}',
   '["board ratified, module results and marks locked, progression decisions locked"]'),

  ('correction-case',
   'correction.eligibility-event',
   '["correction.panel-review.enabled"]',
   '["CorrectionService: locked-record amendment authority, valid correction status transitions"]',
   '{"defaultDeadlineDays": 28, "escalateToRole": "registry-administrator"}',
   '["correction_case status updated, locked-record amended if upheld, amendment audit written"]'),

  ('appeal-case',
   'appeal.submission-command',
   '["appeal.panel-hearing.enabled"]',
   '["CorrectionService: locked-record amendment authority, valid correction status transitions"]',
   '{"defaultDeadlineDays": 28, "escalateToRole": "registry-administrator"}',
   '["appeal_case status updated, locked-record amended if upheld, amendment audit written"]'),

  ('regulatory-submission-approval',
   'regulatory.submission-prepared',
   '["regulatory.submission.manual-approval.required", "regulatory.environment-safety.active"]',
   '["RegulatoryExchangeService: endpoint safety class, environment live-traffic approval"]',
   '{"defaultDeadlineDays": 2, "escalateToRole": "regulatory-officer"}',
   '["regulatory_exchange record status updated, outbound exchange dispatched and logged"]'),

  ('finance-fee-handoff',
   'enrolment.fee-event',
   '["finance.fee-handoff.enabled", "finance.external-system-integration.enabled"]',
   '["EnrolmentService: valid fee liability, currency-aware monetary amount"]',
   '{"defaultDeadlineDays": 5, "escalateToRole": "finance-administrator"}',
   '["fee_liability status updated, invoice reference recorded, finance system notified"]'),

  ('identity-provisioning',
   'person.creation-command',
   '["identity.deduplication.enabled"]',
   '["PersonService: valid identity fields, unique person guard"]',
   '{"defaultDeadlineDays": 1, "escalateToRole": "registry-administrator"}',
   '["person_identity created or merged, deduplication evidence recorded"]'),

  ('communication-dispatch',
   'communication.dispatch-trigger',
   '["communications.locale-aware.enabled"]',
   '[]',
   '{"defaultDeadlineDays": 1, "escalateToRole": "registry-administrator"}',
   '["communication dispatch event published, delivery audit written"]')
) AS v(
  "definition_code", "start_event", "flag_snapshot",
  "service_invariants", "escalation_policy", "terminal_data_writes"
) ON wd."definition_code" = v."definition_code"
WHERE wd."tenant_id" IS NULL
ON CONFLICT ("workflow_definition_id", "version_number") DO NOTHING;

-- ── Section 4: Workflow Steps ──────────────────────────────────────────────────

-- enrolment-change-approval steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('change-requested',   'start',         'Enrolment change requested',          NULL,                    10, '{}'),
  ('registrar-review',   'human-task',    'Registrar review',                    'registry-administrator', 20, '{"flagGuard": "enrolment.change-approval.required"}'),
  ('gateway-approval',   'decision',      'Change approval decision',            NULL,                    30, '{"gatewayKey": "G01"}'),
  ('enrolment-updated',  'integration',   'Enrolment status updated',            NULL,                    40, '{"targetService": "EnrolmentService.transitionStatus"}'),
  ('end',                'end',           'Enrolment change workflow complete',   NULL,                    50, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'enrolment-change-approval' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- module-registration-change steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('registration-requested',        'start',       'Registration change requested',          NULL,                    10, '{}'),
  ('window-and-prerequisite-check', 'system-task', 'Window and prerequisite check',          NULL,                    20, '{"serviceCall": "RegistrationService.checkWindowAndPrerequisites"}'),
  ('approval-review',               'human-task',  'Registration approval review',           'registry-administrator', 30, '{"flagGuard": "module-registration.approval.required"}'),
  ('gateway-approval',              'decision',    'Registration approval decision',          NULL,                    40, '{"gatewayKey": "G01"}'),
  ('registration-updated',          'integration', 'Registration updated',                   NULL,                    50, '{"targetService": "RegistrationService.updateRegistration"}'),
  ('end',                           'end',         'Registration change workflow complete',   NULL,                    60, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'module-registration-change' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- assessment-mark-review steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('mark-ingested',      'start',       'Mark ingested on controlled period',  NULL,                    10, '{}'),
  ('moderation-review',  'human-task',  'Moderation review',                   'module-tutor',          20, '{"flagGuard": "assessment.moderation.workflow.enabled"}'),
  ('late-penalty-review','human-task',  'Late penalty review',                 'registry-administrator', 30, '{}'),
  ('result-review',      'human-task',  'Result review',                       'exam-board-chair',      40, '{}'),
  ('outcome-approved',   'system-task', 'Mark review outcome approved',        NULL,                    50, '{"serviceCall": "MarkService.confirmMark"}'),
  ('end',                'end',         'Mark review workflow complete',        NULL,                    60, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'assessment-mark-review' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- progression-review steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('progression-data-gathered',  'start',       'Progression data gathered',           NULL,                10, '{}'),
  ('algorithm-applied',          'system-task', 'Progression algorithm applied',        NULL,                20, '{"serviceCall": "ProgressionService.decide"}'),
  ('gateway-complexity',         'decision',    'Complexity and discretion gateway',    NULL,                30, '{"gatewayKey": "G01"}'),
  ('board-review',               'human-task',  'Board review',                         'exam-board-chair',  40, '{"flagGuard": "progression.board-review.enabled"}'),
  ('outcome-decided',            'human-task',  'Progression outcome decided',          'exam-board-chair',  50, '{}'),
  ('outcome-notified',           'system-task', 'Progression outcome notified',         NULL,                60, '{"eventType": "srs.progression.outcome-decided"}'),
  ('end',                        'end',         'Progression review workflow complete',  NULL,               70, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'progression-review' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- award-classification steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('results-verified',       'start',       'Award results verified',                 NULL,                10, '{}'),
  ('classification-calculated','system-task','Classification calculated',              NULL,                20, '{"serviceCall": "AwardService.calculateClassification"}'),
  ('gateway-discretionary',  'decision',    'Discretionary review gateway',           NULL,                30, '{"gatewayKey": "G01"}'),
  ('discretionary-review',   'human-task',  'Discretionary classification review',    'exam-board-chair',  40, '{"flagGuard": "award.discretionary-review.enabled"}'),
  ('award-approved',         'human-task',  'Award approved',                         'exam-board-chair',  50, '{}'),
  ('graduation-triggered',   'integration', 'Graduation triggered',                   NULL,                60, '{"targetService": "EnrolmentService.transitionStatus", "targetStatus": "graduated"}'),
  ('end',                    'end',         'Award classification workflow complete',  NULL,                70, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'award-classification' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- exam-board-governance steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('board-constituted',       'start',       'Board constituted',                      NULL,                    10, '{}'),
  ('data-pack-prepared',      'human-task',  'Data pack prepared',                     'registry-administrator', 20, '{}'),
  ('external-examiner-review','human-task',  'External examiner review',               'external-examiner',      30, '{"flagGuard": "exam-board.external-examiner.required"}'),
  ('gateway-concerns',        'decision',    'External examiner concerns gateway',      NULL,                    40, '{"gatewayKey": "G01"}'),
  ('concerns-resolved',       'human-task',  'External examiner concerns resolved',    'exam-board-chair',       50, '{}'),
  ('chair-ratification',      'human-task',  'Chair ratification',                     'exam-board-chair',       60, '{}'),
  ('record-locked',           'integration', 'Records locked after ratification',       NULL,                    70, '{"targetService": "BoardService.ratifyBoard"}'),
  ('end',                     'end',         'Exam board governance workflow complete', NULL,                    80, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'exam-board-governance' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- correction-case steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('case-received',       'start',       'Correction case received',           NULL,                    10, '{}'),
  ('eligibility-assessed','human-task',  'Eligibility assessed',               'registry-administrator', 20, '{}'),
  ('gateway-admissible',  'decision',    'Case admissibility gateway',          NULL,                    30, '{"gatewayKey": "G01"}'),
  ('evidence-gathered',   'human-task',  'Evidence gathered',                  'registry-administrator', 40, '{}'),
  ('gateway-panel',       'decision',    'Panel review required gateway',       NULL,                    50, '{"gatewayKey": "G02", "flagGuard": "correction.panel-review.enabled"}'),
  ('panel-review',        'human-task',  'Panel review',                       'exam-board-chair',       60, '{}'),
  ('outcome-decided',     'human-task',  'Outcome decided',                    'registry-administrator', 70, '{}'),
  ('gateway-upheld',      'decision',    'Case upheld gateway',                 NULL,                    80, '{"gatewayKey": "G03"}'),
  ('amendment-applied',   'integration', 'Locked-record amendment applied',     NULL,                    90, '{"targetService": "CorrectionService.applyAmendment"}'),
  ('case-closed',         'end',         'Correction case closed',              NULL,                   100, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'correction-case' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- appeal-case steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('appeal-received',       'start',       'Appeal received',                    NULL,                    10, '{}'),
  ('grounds-assessed',      'human-task',  'Grounds assessed',                   'registry-administrator', 20, '{}'),
  ('gateway-admissible',    'decision',    'Appeal admissibility gateway',        NULL,                    30, '{"gatewayKey": "G01"}'),
  ('evidence-gathered',     'human-task',  'Evidence gathered',                  'registry-administrator', 40, '{}'),
  ('gateway-hearing',       'decision',    'Panel hearing required gateway',      NULL,                    50, '{"gatewayKey": "G02", "flagGuard": "appeal.panel-hearing.enabled"}'),
  ('panel-hearing',         'human-task',  'Panel hearing',                      'exam-board-chair',       60, '{}'),
  ('outcome-decided',       'human-task',  'Outcome decided',                    'registry-administrator', 70, '{}'),
  ('gateway-upheld',        'decision',    'Appeal upheld gateway',               NULL,                    80, '{"gatewayKey": "G03"}'),
  ('amendment-applied',     'integration', 'Locked-record amendment applied',    NULL,                     90, '{"targetService": "CorrectionService.applyAmendment"}'),
  ('case-closed',           'end',         'Appeal case closed',                  NULL,                   100, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'appeal-case' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- regulatory-submission-approval steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('submission-prepared',    'start',       'Regulatory submission prepared',          NULL,                 10, '{}'),
  ('validation-complete',    'system-task', 'Submission validation complete',          NULL,                 20, '{"serviceCall": "RegulatoryExchangeService.validate"}'),
  ('gateway-approval',       'decision',    'Manual approval required gateway',        NULL,                 30, '{"gatewayKey": "G01", "flagGuard": "regulatory.submission.manual-approval.required"}'),
  ('submission-approved',    'human-task',  'Submission approved',                     'regulatory-officer', 40, '{}'),
  ('submission-dispatched',  'integration', 'Submission dispatched',                   NULL,                 50, '{"targetService": "RegulatoryExchangeService.dispatch", "safetyClassRequired": true}'),
  ('gateway-response',       'decision',    'Response awaited gateway',                NULL,                 60, '{"gatewayKey": "G02"}'),
  ('response-processed',     'system-task', 'Response processed',                      NULL,                 70, '{}'),
  ('end',                    'end',         'Regulatory submission workflow complete',  NULL,                 80, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'regulatory-submission-approval' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- finance-fee-handoff steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('fee-liability-created',   'start',       'Fee liability created',              NULL,                     10, '{}'),
  ('fee-calculated',          'system-task', 'Fee calculated',                     NULL,                     20, '{"serviceCall": "FeeService.calculateFee"}'),
  ('gateway-external-system', 'decision',    'External finance system gateway',    NULL,                     30, '{"gatewayKey": "G01", "flagGuard": "finance.fee-handoff.enabled"}'),
  ('invoice-generated',       'integration', 'Invoice generated',                  NULL,                     40, '{"targetService": "InvoiceService.generate"}'),
  ('payment-confirmed',       'human-task',  'Payment confirmed',                  'finance-administrator',  50, '{}'),
  ('finance-system-notified', 'integration', 'External finance system notified',   NULL,                     60, '{"flagGuard": "finance.external-system-integration.enabled"}'),
  ('end',                     'end',         'Finance fee handoff complete',        NULL,                     70, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'finance-fee-handoff' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- identity-provisioning steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('identity-submitted',    'start',       'Identity submitted',                  NULL,                    10, '{}'),
  ('deduplication-check',   'system-task', 'Deduplication check',                 NULL,                    20, '{"flagGuard": "identity.deduplication.enabled", "serviceCall": "PersonService.checkDuplicates"}'),
  ('gateway-match-found',   'decision',    'Duplicate match gateway',             NULL,                    30, '{"gatewayKey": "G01"}'),
  ('merge-review',          'human-task',  'Merge review',                        'registry-administrator', 40, '{}'),
  ('identity-confirmed',    'system-task', 'Identity confirmed',                  NULL,                    50, '{"serviceCall": "PersonService.confirmIdentity"}'),
  ('end',                   'end',         'Identity provisioning complete',       NULL,                    60, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'identity-provisioning' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- communication-dispatch steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('trigger-received',           'start',       'Communication trigger received',         NULL, 10, '{}'),
  ('template-selected',          'system-task', 'Template selected',                      NULL, 20, '{"serviceCall": "CommunicationService.selectTemplate"}'),
  ('locale-resolved',            'system-task', 'Locale resolved',                        NULL, 30, '{"flagGuard": "communications.locale-aware.enabled", "serviceCall": "LocaleService.resolveLocale"}'),
  ('channel-selected',           'system-task', 'Channel selected',                       NULL, 40, '{"serviceCall": "CommunicationService.selectChannel"}'),
  ('message-dispatched',         'integration', 'Message dispatched',                     NULL, 50, '{}'),
  ('gateway-delivery-confirm',   'decision',    'Delivery confirmation required gateway', NULL, 60, '{"gatewayKey": "G01"}'),
  ('delivery-confirmed',         'system-task', 'Delivery confirmed',                     NULL, 70, '{}'),
  ('end',                        'end',         'Communication dispatch complete',         NULL, 80, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'communication-dispatch' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- ── Section 5: Workflow Decision Gateways ─────────────────────────────────────

-- enrolment-change-approval gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'Change request approved or rejected?', '{"policySource": "Enrolment Policy, status transition rules", "approvedOutcome": "enrolment-updated", "rejectedOutcome": "end"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'enrolment-change-approval' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- module-registration-change gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'Registration change approved or rejected?', '{"policySource": "Registration Window Policy, prerequisite rules", "approvedOutcome": "registration-updated", "rejectedOutcome": "end"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'module-registration-change' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- progression-review gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'Straightforward or discretionary case?', '{"policySource": "Academic progression rules and cohort thresholds", "straightforwardOutcome": "outcome-decided", "discretionaryOutcome": "board-review"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'progression-review' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- award-classification gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'Straightforward or discretionary classification?', '{"policySource": "Classification algorithm and boundary rules", "straightforwardOutcome": "award-approved", "discretionaryOutcome": "discretionary-review"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'award-classification' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- exam-board-governance gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'External examiner concerns raised?', '{"policySource": "External examiner reporting requirements", "noConcernsOutcome": "chair-ratification", "concernsOutcome": "concerns-resolved"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'exam-board-governance' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- correction-case gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'Correction case admissible?',    '{"policySource": "Correction eligibility policy", "admissibleOutcome": "evidence-gathered", "inadmissibleOutcome": "case-closed"}'),
  ('G02', 'Panel review required?',         '{"policySource": "Correction panel review policy", "panelRequiredOutcome": "panel-review", "noPanelOutcome": "outcome-decided"}'),
  ('G03', 'Correction case upheld?',        '{"policySource": "Correction outcome decision", "upheldOutcome": "amendment-applied", "notUpheldOutcome": "case-closed"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'correction-case' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- appeal-case gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'Appeal admissible?',         '{"policySource": "Academic appeals policy and grounds criteria", "admissibleOutcome": "evidence-gathered", "inadmissibleOutcome": "case-closed"}'),
  ('G02', 'Panel hearing required?',    '{"policySource": "Academic appeals panel policy", "hearingRequiredOutcome": "panel-hearing", "noHearingOutcome": "outcome-decided"}'),
  ('G03', 'Appeal upheld?',             '{"policySource": "Academic appeals outcome decision", "upheldOutcome": "amendment-applied", "notUpheldOutcome": "case-closed"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'appeal-case' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- regulatory-submission-approval gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'Manual approval required?',    '{"policySource": "Environment safety class and regulatory submission policy", "approvalRequiredOutcome": "submission-approved", "autoApproveOutcome": "submission-dispatched"}'),
  ('G02', 'Response awaited?',            '{"policySource": "Regulatory exchange protocol", "awaitedOutcome": "response-processed", "noResponseOutcome": "end"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'regulatory-submission-approval' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- finance-fee-handoff gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'External finance system integration enabled?', '{"policySource": "Finance integration configuration", "enabledOutcome": "invoice-generated", "disabledOutcome": "end"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'finance-fee-handoff' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- identity-provisioning gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'Potential duplicate match found?', '{"policySource": "Identity deduplication policy", "matchFoundOutcome": "merge-review", "noMatchOutcome": "identity-confirmed"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'identity-provisioning' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- communication-dispatch gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'Delivery confirmation required?', '{"policySource": "Communication channel configuration", "confirmationRequiredOutcome": "delivery-confirmed", "noConfirmationOutcome": "end"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'communication-dispatch' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- ── Section 6: Workflow Assignment Rules ──────────────────────────────────────

-- Default role assignment rules for all Stage 2 workflows.
-- rule_key must be unique within (workflow_definition_version_id, tenant_id),
-- so each rule key embeds both the workflow short-name and the step key.
INSERT INTO "workflow_assignment_rule" (
  "workflow_definition_version_id", "step_key", "rule_key",
  "priority", "assignee_role_code", "active", "configuration"
)
SELECT wdv."id", r."step_key", r."rule_key", r."priority"::integer, r."assignee_role_code", true, r."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  -- enrolment-change-approval
  ('enrolment-change-approval', 'registrar-review',         'enrolment-change.registrar-review.registry-default',          100, 'registry-administrator', '{}'),

  -- module-registration-change
  ('module-registration-change', 'approval-review',         'module-reg-change.approval-review.registry-default',          100, 'registry-administrator', '{}'),

  -- assessment-mark-review
  ('assessment-mark-review', 'moderation-review',           'mark-review.moderation-review.module-tutor-default',          100, 'module-tutor',           '{}'),
  ('assessment-mark-review', 'late-penalty-review',         'mark-review.late-penalty-review.registry-default',            100, 'registry-administrator', '{}'),
  ('assessment-mark-review', 'result-review',               'mark-review.result-review.board-chair-default',               100, 'exam-board-chair',       '{}'),

  -- progression-review
  ('progression-review', 'board-review',                    'progression.board-review.board-chair-default',                100, 'exam-board-chair',       '{}'),
  ('progression-review', 'outcome-decided',                 'progression.outcome-decided.board-chair-default',             100, 'exam-board-chair',       '{}'),

  -- award-classification
  ('award-classification', 'discretionary-review',          'award.discretionary-review.board-chair-default',              100, 'exam-board-chair',       '{}'),
  ('award-classification', 'award-approved',                'award.award-approved.board-chair-default',                    100, 'exam-board-chair',       '{}'),

  -- exam-board-governance
  ('exam-board-governance', 'data-pack-prepared',           'board.data-pack-prepared.registry-default',                   100, 'registry-administrator', '{}'),
  ('exam-board-governance', 'external-examiner-review',     'board.external-examiner-review.external-examiner-default',    100, 'external-examiner',      '{}'),
  ('exam-board-governance', 'concerns-resolved',            'board.concerns-resolved.chair-default',                       100, 'exam-board-chair',       '{}'),
  ('exam-board-governance', 'chair-ratification',           'board.chair-ratification.chair-default',                      100, 'exam-board-chair',       '{}'),

  -- correction-case
  ('correction-case', 'eligibility-assessed',               'correction.eligibility-assessed.registry-default',            100, 'registry-administrator', '{}'),
  ('correction-case', 'evidence-gathered',                  'correction.evidence-gathered.registry-default',               100, 'registry-administrator', '{}'),
  ('correction-case', 'panel-review',                       'correction.panel-review.panel-chair-default',                 100, 'exam-board-chair',       '{}'),
  ('correction-case', 'outcome-decided',                    'correction.outcome-decided.registry-default',                 100, 'registry-administrator', '{}'),

  -- appeal-case
  ('appeal-case', 'grounds-assessed',                       'appeal.grounds-assessed.registry-default',                    100, 'registry-administrator', '{}'),
  ('appeal-case', 'evidence-gathered',                      'appeal.evidence-gathered.registry-default',                   100, 'registry-administrator', '{}'),
  ('appeal-case', 'panel-hearing',                          'appeal.panel-hearing.panel-chair-default',                    100, 'exam-board-chair',       '{}'),
  ('appeal-case', 'outcome-decided',                        'appeal.outcome-decided.registry-default',                     100, 'registry-administrator', '{}'),

  -- regulatory-submission-approval
  ('regulatory-submission-approval', 'submission-approved', 'regulatory.submission-approved.officer-default',              100, 'regulatory-officer',     '{}'),

  -- finance-fee-handoff
  ('finance-fee-handoff', 'payment-confirmed',              'finance.payment-confirmed.administrator-default',             100, 'finance-administrator',  '{}'),

  -- identity-provisioning
  ('identity-provisioning', 'merge-review',                 'identity.merge-review.registry-default',                      100, 'registry-administrator', '{}')
  -- communication-dispatch: fully automated, no human-task assignment rules required
) AS r(
  "definition_code", "step_key", "rule_key", "priority",
  "assignee_role_code", "configuration"
) ON wd."definition_code" = r."definition_code"
WHERE wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT DO NOTHING;


-- ============================================================
-- Originally: 0014_stage3_assessment_grade_progression.sql
-- ============================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0014 — Stage 3: Assessment, Grade, and Progression Refactor
--
-- Adds:
--   1. Feature flags for assessment policy variants (late-penalty, resit-cap)
--      and board operating-model selection.
--   2. Two additional exam-board workflow definitions for school-led and
--      departmental-staged board governance models (large-institution variants).
--   3. Three append-only calculation evidence tables that satisfy the Stage 3
--      exit criterion: grade and progression calculations are reproducible from
--      rules, workflow decision evidence, and source marks.
--
-- What does NOT change in this migration:
--   - No existing service behaviour is altered by the migration alone; the new
--     flags default to backward-compatible values (late-penalty on, resit-cap
--     off) so existing tenants are unaffected until they opt in.
--   - Hard service guards (locked-record, valid-mark-range, ratification
--     authority) remain enforced in code and are unchanged.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Section 1: Assessment policy and board operating-model feature flags ──────

WITH stage3_flags AS (
  INSERT INTO "feature_flag" (
    "flag_key", "display_name", "description",
    "owner_module_code", "status_code", "value_type_code", "default_variant_key", "created_by"
  )
  VALUES
    ('assessment.late-penalty.enabled',
     'Late submission penalty enabled',
     'When off, late penalty calculation is suppressed for all mark ingestion in the tenant, '
     'regardless of due-date information submitted with the mark. '
     'Useful for institutions using external penalty management or mitigating-circumstances-first policies.',
     'assessment', 'active', 'boolean', 'on', 'system'),

    ('assessment.resit-cap.enabled',
     'Resit mark cap enabled',
     'When on, marks for attempt number 2 or higher are capped at the value configured in the '
     'resit-mark-cap academic rule (default 40 — the standard UK HE resit pass mark cap). '
     'The cap is applied after late penalty calculation.',
     'assessment', 'active', 'boolean', 'off', 'system'),

    ('exam-board.operating-model',
     'Exam board operating model',
     'Selects the workflow definition used for exam board governance. '
     'registry-led uses the standard exam-board-governance workflow seeded in Stage 2. '
     'school-led uses a school-initiated model where departmental chair prepares and school '
     'director ratifies before registry finalises. '
     'departmental-staged uses a three-stage model: department → school → registry for '
     'large multi-faculty institutions.',
     'governance', 'active', 'selection', 'registry-led', 'system')

  ON CONFLICT ("flag_key") DO UPDATE SET
    "display_name"        = EXCLUDED."display_name",
    "description"         = EXCLUDED."description",
    "owner_module_code"   = EXCLUDED."owner_module_code",
    "status_code"         = EXCLUDED."status_code",
    "value_type_code"     = EXCLUDED."value_type_code",
    "default_variant_key" = EXCLUDED."default_variant_key",
    "updated_at"          = now()
  RETURNING "id", "flag_key"
)
INSERT INTO "feature_flag_variant" ("flag_id", "variant_key", "display_name", "value", "sort_order")
SELECT f."id", v."variant_key", v."display_name", v."value"::jsonb, v."sort_order"
FROM stage3_flags f
JOIN (VALUES
  -- assessment.late-penalty.enabled (boolean)
  ('assessment.late-penalty.enabled', 'off', 'Off', 'false', 10),
  ('assessment.late-penalty.enabled', 'on',  'On',  'true',  20),
  -- assessment.resit-cap.enabled (boolean)
  ('assessment.resit-cap.enabled',    'off', 'Off', 'false', 10),
  ('assessment.resit-cap.enabled',    'on',  'On',  'true',  20),
  -- exam-board.operating-model (selection)
  ('exam-board.operating-model', 'registry-led',        'Registry-Led',        '"registry-led"',        10),
  ('exam-board.operating-model', 'school-led',          'School-Led',          '"school-led"',          20),
  ('exam-board.operating-model', 'departmental-staged', 'Departmental-Staged', '"departmental-staged"', 30)
) AS v("flag_key", "variant_key", "display_name", "value", "sort_order")
  ON f."flag_key" = v."flag_key"
ON CONFLICT ("flag_id", "variant_key") DO UPDATE SET
  "display_name" = EXCLUDED."display_name",
  "value"        = EXCLUDED."value",
  "sort_order"   = EXCLUDED."sort_order";

-- ── Section 2: Board operating-model workflow definitions ─────────────────────

-- exam-board-school-led: School-initiated model
--   Department chair prepares data pack → School director reviews and approves
--   → External examiner reviews → Registry finalises and locks.
--   Appropriate for faculty-led universities where the school owns the board.

INSERT INTO "workflow_definition" (
  "definition_code", "display_name", "owner_module_code",
  "status_code", "current_version_number", "description", "created_by"
)
VALUES
  ('exam-board-school-led',
   'Exam Board — School-Led Governance',
   'governance', 'active', 1,
   'School-initiated exam board workflow. Department chair prepares the data pack; '
   'school director approves before external examiner review and registry finalisation.',
   'system'),

  ('exam-board-departmental-staged',
   'Exam Board — Departmental Staged Governance',
   'governance', 'active', 1,
   'Large-institution three-stage board workflow: departmental committee sign-off, '
   'school executive approval, external examiner review, and central registry lock.',
   'system')
ON CONFLICT (COALESCE("tenant_id", '00000000-0000-0000-0000-000000000000'::uuid), "definition_code")
DO UPDATE SET
  "display_name"           = EXCLUDED."display_name",
  "status_code"            = EXCLUDED."status_code",
  "current_version_number" = EXCLUDED."current_version_number",
  "description"            = EXCLUDED."description",
  "updated_at"             = now();

-- Definition versions
INSERT INTO "workflow_definition_version" (
  "workflow_definition_id", "version_number", "status_code",
  "definition_json", "bpmn_source_id", "effective_from", "created_by"
)
SELECT wd."id", 1, 'active',
  jsonb_build_object(
    'startEvent',         v."start_event",
    'flagSnapshot',       v."flag_snapshot"::jsonb,
    'serviceInvariants',  v."service_invariants"::jsonb,
    'escalationPolicy',   v."escalation_policy"::jsonb,
    'terminalDataWrites', v."terminal_data_writes"::jsonb
  ),
  NULL,
  '2026-06-14T00:00:00Z'::timestamptz,
  'system'
FROM "workflow_definition" wd
JOIN (VALUES
  ('exam-board-school-led',
   'exam-board.constitution-command',
   '["exam-board.external-examiner.required", "exam-board.operating-model"]',
   '["BoardService.ratifyBoard: external-examiner signoff guard, record-lock writes for marks/results/progressions"]',
   '{"defaultDeadlineDays": 21, "escalateToRole": "exam-board-chair"}',
   '["board ratified, module results and marks locked, progression decisions locked"]'),

  ('exam-board-departmental-staged',
   'exam-board.constitution-command',
   '["exam-board.external-examiner.required", "exam-board.operating-model"]',
   '["BoardService.ratifyBoard: external-examiner signoff guard, record-lock writes for marks/results/progressions"]',
   '{"defaultDeadlineDays": 28, "escalateToRole": "exam-board-chair"}',
   '["board ratified, module results and marks locked, progression decisions locked"]')
) AS v("definition_code", "start_event", "flag_snapshot", "service_invariants", "escalation_policy", "terminal_data_writes")
  ON wd."definition_code" = v."definition_code"
WHERE wd."tenant_id" IS NULL
ON CONFLICT ("workflow_definition_id", "version_number") DO NOTHING;

-- Steps: exam-board-school-led
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('board-constituted',          'start',       'Board constituted',                               NULL,                     10, '{}'),
  ('data-pack-prepared',         'human-task',  'Department chair prepares data pack',             'department-chair',        20, '{}'),
  ('school-director-review',     'human-task',  'School director approves board pack',             'school-director',         30, '{}'),
  ('external-examiner-review',   'human-task',  'External examiner review',                        'external-examiner',       40, '{"flagGuard": "exam-board.external-examiner.required"}'),
  ('gateway-concerns',           'decision',    'External examiner concerns gateway',              NULL,                     50, '{"gatewayKey": "G01"}'),
  ('concerns-resolved',          'human-task',  'External examiner concerns resolved',             'school-director',         60, '{}'),
  ('registry-finalisation',      'human-task',  'Registry finalisation and lock',                  'registry-administrator',  70, '{}'),
  ('record-locked',              'integration', 'Records locked after finalisation',               NULL,                     80, '{"targetService": "BoardService.ratifyBoard"}'),
  ('end',                        'end',         'School-led board governance complete',            NULL,                     90, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'exam-board-school-led' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- Steps: exam-board-departmental-staged
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('board-constituted',            'start',       'Board constituted',                               NULL,                     10, '{}'),
  ('departmental-committee-review','human-task',  'Departmental committee sign-off',                 'department-chair',        20, '{}'),
  ('school-executive-approval',    'human-task',  'School executive approval',                       'school-director',         30, '{}'),
  ('external-examiner-review',     'human-task',  'External examiner review',                        'external-examiner',       40, '{"flagGuard": "exam-board.external-examiner.required"}'),
  ('gateway-concerns',             'decision',    'External examiner concerns gateway',              NULL,                     50, '{"gatewayKey": "G01"}'),
  ('concerns-resolved',            'human-task',  'External examiner concerns resolved',             'exam-board-chair',        60, '{}'),
  ('central-registry-lock',        'human-task',  'Central registry lock and confirmation',          'registry-administrator',  70, '{}'),
  ('record-locked',                'integration', 'Records locked after central registry sign-off',  NULL,                     80, '{"targetService": "BoardService.ratifyBoard"}'),
  ('end',                          'end',         'Departmental-staged board governance complete',   NULL,                     90, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'exam-board-departmental-staged' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- Decision gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", 'G01', 'External examiner concerns raised?', 'exclusive', NULL,
  '{"policySource": "External examiner reporting requirements", "noConcernsOutcome": "registry-finalisation", "concernsOutcome": "concerns-resolved"}'::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
WHERE wd."definition_code" = 'exam-board-school-led' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", 'G01', 'External examiner concerns raised?', 'exclusive', NULL,
  '{"policySource": "External examiner reporting requirements", "noConcernsOutcome": "central-registry-lock", "concernsOutcome": "concerns-resolved"}'::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
WHERE wd."definition_code" = 'exam-board-departmental-staged' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- Assignment rules
INSERT INTO "workflow_assignment_rule" (
  "workflow_definition_version_id", "step_key", "rule_key",
  "priority", "assignee_role_code", "active", "configuration"
)
SELECT wdv."id", r."step_key", r."rule_key", r."priority"::integer, r."assignee_role_code", true, '{}'::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  -- exam-board-school-led
  ('exam-board-school-led', 'data-pack-prepared',       'school-led.data-pack-prepared.dept-chair-default',   100, 'department-chair'),
  ('exam-board-school-led', 'school-director-review',   'school-led.school-director-review.director-default',  100, 'school-director'),
  ('exam-board-school-led', 'external-examiner-review', 'school-led.external-examiner-review.examiner-default',100, 'external-examiner'),
  ('exam-board-school-led', 'concerns-resolved',        'school-led.concerns-resolved.director-default',       100, 'school-director'),
  ('exam-board-school-led', 'registry-finalisation',    'school-led.registry-finalisation.registry-default',   100, 'registry-administrator'),
  -- exam-board-departmental-staged
  ('exam-board-departmental-staged', 'departmental-committee-review','dept-staged.dept-committee.chair-default',        100, 'department-chair'),
  ('exam-board-departmental-staged', 'school-executive-approval',    'dept-staged.school-exec.director-default',        100, 'school-director'),
  ('exam-board-departmental-staged', 'external-examiner-review',     'dept-staged.external-examiner.examiner-default',  100, 'external-examiner'),
  ('exam-board-departmental-staged', 'concerns-resolved',            'dept-staged.concerns-resolved.chair-default',     100, 'exam-board-chair'),
  ('exam-board-departmental-staged', 'central-registry-lock',        'dept-staged.registry-lock.registry-default',      100, 'registry-administrator')
) AS r("definition_code", "step_key", "rule_key", "priority", "assignee_role_code")
  ON wd."definition_code" = r."definition_code"
WHERE wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT DO NOTHING;

-- ── Section 3: Calculation evidence tables ────────────────────────────────────
--
-- These tables are append-only audit records.  No bitemporal columns — each row
-- is a snapshot of what was calculated, when, and with which rule values.
-- They satisfy the Stage 3 exit criterion:
--   "Grade and progression calculations are reproducible from rules,
--    workflow decision evidence, and source marks."

CREATE TABLE IF NOT EXISTS "mark_calculation_evidence" (
  "id"                       uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                uuid         NOT NULL,
  "mark_id"                  uuid         NOT NULL,
  "attempt_number"           integer      NOT NULL,
  "raw_mark"                 numeric(6,2) NOT NULL,
  "late_penalty_enabled"     boolean      NOT NULL DEFAULT false,
  "late_penalty_percent"     numeric(6,2),
  "late_penalty_cap_applied" boolean      NOT NULL DEFAULT false,
  "late_penalty_cap_percent" numeric(6,2),
  "resit_cap_applied"        boolean      NOT NULL DEFAULT false,
  "resit_cap_mark"           numeric(6,2),
  "adjusted_mark"            numeric(6,2) NOT NULL,
  "rule_snapshot"            jsonb        NOT NULL DEFAULT '{}',
  "calculated_at"            timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "mark_calc_evidence_mark_idx"
  ON "mark_calculation_evidence" ("mark_id");

CREATE INDEX IF NOT EXISTS "mark_calc_evidence_tenant_idx"
  ON "mark_calculation_evidence" ("tenant_id", "calculated_at" DESC);

CREATE TABLE IF NOT EXISTS "progression_calculation_evidence" (
  "id"                           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                    uuid         NOT NULL,
  "progression_decision_id"      uuid         NOT NULL,
  "academic_year"                text         NOT NULL,
  "required_credits"             numeric      NOT NULL,
  "compensation_threshold"       numeric,
  "compensation_credit_limit"    numeric      NOT NULL,
  "condonement_threshold"        numeric,
  "earned_credits"               numeric      NOT NULL,
  "compensation_credits"         numeric      NOT NULL,
  "unresolved_credits"           numeric      NOT NULL,
  "decision_code"                text         NOT NULL,
  "rule_snapshot"                jsonb        NOT NULL DEFAULT '{}',
  "calculated_at"                timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "prog_calc_evidence_decision_idx"
  ON "progression_calculation_evidence" ("progression_decision_id");

CREATE INDEX IF NOT EXISTS "prog_calc_evidence_tenant_idx"
  ON "progression_calculation_evidence" ("tenant_id", "calculated_at" DESC);

CREATE TABLE IF NOT EXISTS "award_calculation_evidence" (
  "id"                    uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid         NOT NULL,
  "award_id"              uuid         NOT NULL,
  "algorithm"             text         NOT NULL,
  "aggregate_mark"        numeric(6,2) NOT NULL,
  "classification_code"   text         NOT NULL,
  "boundaries_applied"    jsonb        NOT NULL DEFAULT '[]',
  "outcome_count"         integer      NOT NULL,
  "total_credit_value"    numeric      NOT NULL,
  "rule_snapshot"         jsonb        NOT NULL DEFAULT '{}',
  "calculated_at"         timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "award_calc_evidence_award_idx"
  ON "award_calculation_evidence" ("award_id");

CREATE INDEX IF NOT EXISTS "award_calc_evidence_tenant_idx"
  ON "award_calculation_evidence" ("tenant_id", "calculated_at" DESC);


-- ============================================================
-- Originally: 0015_stage4_exam_board_governance.sql
-- ============================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0015 — Stage 4: Exam Board and Record Governance Refactor
--
-- Adds:
--   1. Three feature flags for board operating-model variants:
--        exam-board.virtual-board.enabled   — async/virtual board operation
--        exam-board.deferral.enabled        — board may be deferred to next cycle
--        exam-board.quorum.required         — minimum quorum must be recorded
--      Plus: the existing exam-board.external-examiner.required flag is now
--      actually checked in BoardService.ratifyBoard() (it was seeded in Stage 2
--      but not yet wired to the service guard).
--
--   2. exam-board-virtual workflow definition — asynchronous board workflow
--      suitable for institutions that conduct board business by correspondence
--      or distributed async review rather than a fixed physical meeting.
--
--   3. Four new nullable columns on exam_board to capture deferral state and
--      quorum evidence without a full bitemporal table:
--        deferred_at         — when the board was deferred
--        deferral_reason     — free-text or coded reason for deferral
--        quorum_count        — number of members recorded as attending / reviewing
--        quorum_recorded_at  — when the quorum count was recorded
--
-- What does NOT change:
--   - Service-level record-lock guards (ratifyBoard: marks, module results, and
--     progression decisions are locked in the same transaction) are unchanged.
--   - Ratification authority (exam-board:ratify → exam-board-chair role) is
--     unchanged in the permission model.
--   - Correction-case authority (separate correction role guards) is unchanged.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Section 1: Board governance feature flags ─────────────────────────────────

WITH stage4_flags AS (
  INSERT INTO "feature_flag" (
    "flag_key", "display_name", "description",
    "owner_module_code", "status_code", "value_type_code", "default_variant_key", "created_by"
  )
  VALUES
    ('exam-board.virtual-board.enabled',
     'Virtual exam board enabled',
     'When on, the exam board does not require a physical meeting date. '
     'Members and the chair review and approve asynchronously. '
     'The exam-board-virtual workflow definition is used instead of the standard one.',
     'governance', 'active', 'boolean', 'off', 'system'),

    ('exam-board.deferral.enabled',
     'Board deferral enabled',
     'When on, an exam board that has not yet been ratified may be deferred to the '
     'next governance cycle by a registry administrator. A deferred board cannot be '
     'ratified until it is explicitly re-opened.',
     'governance', 'active', 'boolean', 'off', 'system'),

    ('exam-board.quorum.required',
     'Board quorum required',
     'When on, a quorum count must be recorded on the exam board before ratification '
     'is permitted. The quorum threshold is defined in the exam-board-quorum-threshold '
     'academic rule (default 3). Enables institutions that have formal quorum '
     'requirements under their academic regulations.',
     'governance', 'active', 'boolean', 'off', 'system')

  ON CONFLICT ("flag_key") DO UPDATE SET
    "display_name"        = EXCLUDED."display_name",
    "description"         = EXCLUDED."description",
    "owner_module_code"   = EXCLUDED."owner_module_code",
    "status_code"         = EXCLUDED."status_code",
    "value_type_code"     = EXCLUDED."value_type_code",
    "default_variant_key" = EXCLUDED."default_variant_key",
    "updated_at"          = now()
  RETURNING "id", "flag_key"
)
INSERT INTO "feature_flag_variant" ("flag_id", "variant_key", "display_name", "value", "sort_order")
SELECT f."id", v."variant_key", v."display_name", v."value"::jsonb, v."sort_order"
FROM stage4_flags f
JOIN (VALUES
  ('exam-board.virtual-board.enabled', 'off', 'Off', 'false', 10),
  ('exam-board.virtual-board.enabled', 'on',  'On',  'true',  20),
  ('exam-board.deferral.enabled',      'off', 'Off', 'false', 10),
  ('exam-board.deferral.enabled',      'on',  'On',  'true',  20),
  ('exam-board.quorum.required',       'off', 'Off', 'false', 10),
  ('exam-board.quorum.required',       'on',  'On',  'true',  20)
) AS v("flag_key", "variant_key", "display_name", "value", "sort_order")
  ON f."flag_key" = v."flag_key"
ON CONFLICT ("flag_id", "variant_key") DO UPDATE SET
  "display_name" = EXCLUDED."display_name",
  "value"        = EXCLUDED."value",
  "sort_order"   = EXCLUDED."sort_order";

-- ── Section 2: exam-board-virtual workflow definition ─────────────────────────
--
-- Asynchronous board workflow. No fixed meeting date is required. Members review
-- the data pack independently; the chair makes a ratification decision after all
-- required async sign-offs are received.
--
-- Step design:
--   board-constituted        → data-pack-distributed   → async-member-review
--   → async-chair-review     → external-examiner-async (optional via flagGuard)
--   → gateway-concerns       → [concerns-resolved] → record-locked → end

INSERT INTO "workflow_definition" (
  "definition_code", "display_name", "owner_module_code",
  "status_code", "current_version_number", "description", "created_by"
)
VALUES
  ('exam-board-virtual',
   'Exam Board — Virtual / Async Governance',
   'governance', 'active', 1,
   'Async board workflow for institutions where members review and approve '
   'independently without a fixed physical meeting. '
   'Suitable for distributed governance, small institutions, or correspondence boards.',
   'system')
ON CONFLICT (COALESCE("tenant_id", '00000000-0000-0000-0000-000000000000'::uuid), "definition_code")
DO UPDATE SET
  "display_name"           = EXCLUDED."display_name",
  "status_code"            = EXCLUDED."status_code",
  "current_version_number" = EXCLUDED."current_version_number",
  "description"            = EXCLUDED."description",
  "updated_at"             = now();

INSERT INTO "workflow_definition_version" (
  "workflow_definition_id", "version_number", "status_code",
  "definition_json", "bpmn_source_id", "effective_from", "created_by"
)
SELECT wd."id", 1, 'active',
  jsonb_build_object(
    'startEvent',         'exam-board.constitution-command',
    'flagSnapshot',       '["exam-board.virtual-board.enabled", "exam-board.external-examiner.required", "exam-board.quorum.required"]'::jsonb,
    'serviceInvariants',  '["BoardService.ratifyBoard: external-examiner signoff guard (flag controlled), quorum guard (flag controlled), record-lock writes"]'::jsonb,
    'escalationPolicy',   '{"defaultDeadlineDays": 14, "escalateToRole": "exam-board-chair"}'::jsonb,
    'terminalDataWrites', '["board ratified, module results and marks locked, progression decisions locked"]'::jsonb
  ),
  NULL,
  '2026-06-14T00:00:00Z'::timestamptz,
  'system'
FROM "workflow_definition" wd
WHERE wd."definition_code" = 'exam-board-virtual' AND wd."tenant_id" IS NULL
ON CONFLICT ("workflow_definition_id", "version_number") DO NOTHING;

-- Steps: exam-board-virtual
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('board-constituted',        'start',       'Board constituted',                                   NULL,                    10, '{}'),
  ('data-pack-distributed',    'human-task',  'Registry distributes data pack asynchronously',       'registry-administrator', 20, '{}'),
  ('async-member-review',      'human-task',  'Board members review data pack (async)',              'exam-board-member',      30, '{}'),
  ('async-chair-review',       'human-task',  'Chair reviews outcomes and draft decisions (async)',  'exam-board-chair',       40, '{}'),
  ('external-examiner-async',  'human-task',  'External examiner async sign-off',                   'external-examiner',      50, '{"flagGuard": "exam-board.external-examiner.required"}'),
  ('gateway-concerns',         'decision',    'External examiner concerns gateway',                  NULL,                    60, '{"gatewayKey": "G01"}'),
  ('concerns-resolved',        'human-task',  'Concerns resolved by chair (async)',                  'exam-board-chair',       70, '{}'),
  ('record-locked',            'integration', 'Records locked after async ratification',             NULL,                    80, '{"targetService": "BoardService.ratifyBoard"}'),
  ('end',                      'end',         'Virtual board governance complete',                   NULL,                    90, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'exam-board-virtual' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- Decision gateway for virtual board
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", 'G01', 'External examiner concerns raised?', 'exclusive', NULL,
  '{"policySource": "External examiner reporting requirements", "noConcernsOutcome": "record-locked", "concernsOutcome": "concerns-resolved"}'::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
WHERE wd."definition_code" = 'exam-board-virtual' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- Assignment rules for virtual board
INSERT INTO "workflow_assignment_rule" (
  "workflow_definition_version_id", "step_key", "rule_key",
  "priority", "assignee_role_code", "active", "configuration"
)
SELECT wdv."id", r."step_key", r."rule_key", r."priority"::integer, r."assignee_role_code", true, '{}'::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('data-pack-distributed',   'virtual.data-pack.registry-default',         100, 'registry-administrator'),
  ('async-member-review',     'virtual.member-review.member-default',        100, 'exam-board-member'),
  ('async-chair-review',      'virtual.chair-review.chair-default',          100, 'exam-board-chair'),
  ('external-examiner-async', 'virtual.external-examiner.examiner-default',  100, 'external-examiner'),
  ('concerns-resolved',       'virtual.concerns-resolved.chair-default',     100, 'exam-board-chair')
) AS r("step_key", "rule_key", "priority", "assignee_role_code") ON true
WHERE wd."definition_code" = 'exam-board-virtual' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT DO NOTHING;

-- ── Section 3: exam_board schema additions ────────────────────────────────────
--
-- All four columns are nullable. A NULL value for deferred_at means the board
-- is not deferred. A NULL value for quorum_count means quorum has not been
-- recorded (or is not required for this board).

ALTER TABLE "exam_board"
  ADD COLUMN IF NOT EXISTS "deferred_at"        timestamptz,
  ADD COLUMN IF NOT EXISTS "deferral_reason"     text,
  ADD COLUMN IF NOT EXISTS "quorum_count"        integer,
  ADD COLUMN IF NOT EXISTS "quorum_recorded_at"  timestamptz;

CREATE INDEX IF NOT EXISTS "exam_board_deferred_idx"
  ON "exam_board" ("tenant_id", "deferred_at")
  WHERE "deferred_at" IS NOT NULL;


-- ============================================================
-- Originally: 0016_stage5_admissions_communications.sql
-- ============================================================

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


-- ============================================================
-- Originally: 0017_stage6_flag_governance.sql
-- ============================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0017 — Stage 6: Flag Governance and Admin UX
--
-- Adds governance metadata to every feature flag so that flags are governed
-- configuration rather than hidden conditionals.
--
-- New columns on feature_flag:
--   flag_class_code      — category from the governance taxonomy
--   risk_class_code      — change-risk rating
--   owner_contact        — team or email responsible for the flag
--   review_date          — next mandatory review date (ISO date string)
--   retirement_condition — prose condition that triggers flag removal
--   allowed_scope_codes  — array of scopes at which this flag may be assigned
--   non_bypassable       — when true, the 'off' variant may never be assigned
--
-- Flag class taxonomy:
--   migration            — temporary compatibility path during a migration
--   release              — release gate; feature not yet available to all tenants
--   tenant-variant       — institutional operating-model choice
--   environment-safety   — safety or compliance control; restricted assignment
--   module-enablement    — turns a product module on/off for a tenant
--   integration-route    — selects an external integration path
--   kill-switch          — emergency disable for a component; restricted assignment
--
-- Scope codes:
--   global               — applies to all tenants by default
--   tenant               — assigned at tenant level
--   environment          — assigned at deployment environment level
--
-- Existing flag classifications are applied in Section 2.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Section 1: Add governance columns ─────────────────────────────────────────

ALTER TABLE "feature_flag"
  ADD COLUMN IF NOT EXISTS "flag_class_code"       text        NOT NULL DEFAULT 'release',
  ADD COLUMN IF NOT EXISTS "risk_class_code"        text        NOT NULL DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS "owner_contact"          text,
  ADD COLUMN IF NOT EXISTS "review_date"            text,
  ADD COLUMN IF NOT EXISTS "retirement_condition"   text,
  ADD COLUMN IF NOT EXISTS "allowed_scope_codes"    text[]      NOT NULL DEFAULT ARRAY['global','tenant','environment'],
  ADD COLUMN IF NOT EXISTS "non_bypassable"         boolean     NOT NULL DEFAULT false;

-- ── Section 2: Classify all existing flags ────────────────────────────────────
--
-- Every flag is assigned a class, risk level, owner, and (where appropriate)
-- a non_bypassable guard and retirement condition.
--
-- environment-safety flags are restricted to global/environment scope only —
-- they must not be overridden per-tenant because they guard statutory controls.

-- Admissions flags
UPDATE "feature_flag" SET
  "flag_class_code"     = 'migration',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'admissions-team',
  "review_date"         = '2026-12-31',
  "retirement_condition" = 'Remove once all tenants have migrated to AdmissionsService.startHandoff() and no UCAS-to-enrolment auto-creation paths remain in production use.',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'admissions.legacy-ucas-auto-enrolment.enabled';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'module-enablement',
  "risk_class_code"     = 'medium',
  "owner_contact"       = 'admissions-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'admissions.enabled';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'integration-route',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'admissions-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'admissions.ucas-adapter.enabled';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'integration-route',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'admissions-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'admissions.direct-applications.enabled';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'integration-route',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'admissions-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'admissions.agent-applications.enabled';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'integration-route',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'admissions-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'admissions.international-route.enabled';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'environment-safety',
  "risk_class_code"     = 'critical',
  "owner_contact"       = 'compliance-team',
  "retirement_condition" = 'Must not be retired. UKVI CAS pre-check is a statutory requirement for student visa sponsors under the UK Home Office Points-Based System.',
  "allowed_scope_codes" = ARRAY['global','environment'],
  "non_bypassable"      = true
WHERE "flag_key" = 'admissions.cas-precheck.required';

-- Enrolment flags
UPDATE "feature_flag" SET
  "flag_class_code"     = 'tenant-variant',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'registry-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'enrolment.change-approval.required';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'integration-route',
  "risk_class_code"     = 'medium',
  "owner_contact"       = 'registry-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'enrolment.downstream-triggers.configured-mode';

-- Assessment flags
UPDATE "feature_flag" SET
  "flag_class_code"     = 'tenant-variant',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'assessment-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'assessment.late-penalty.enabled';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'tenant-variant',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'assessment-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'assessment.resit-cap.enabled';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'module-enablement',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'assessment-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'assessment.moderation.workflow.enabled';

-- Progression flags
UPDATE "feature_flag" SET
  "flag_class_code"     = 'tenant-variant',
  "risk_class_code"     = 'medium',
  "owner_contact"       = 'registry-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'progression.board-review.enabled';

-- Exam board flags
UPDATE "feature_flag" SET
  "flag_class_code"     = 'tenant-variant',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'governance-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'exam-board.operating-model';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'tenant-variant',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'governance-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'exam-board.virtual-board.enabled';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'tenant-variant',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'governance-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'exam-board.deferral.enabled';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'environment-safety',
  "risk_class_code"     = 'high',
  "owner_contact"       = 'governance-team',
  "retirement_condition" = 'Must not be retired. Board quorum verification is a governance requirement for degree-awarding institutions under PSRB and QAA expectations.',
  "allowed_scope_codes" = ARRAY['global','environment'],
  "non_bypassable"      = true
WHERE "flag_key" = 'exam-board.quorum.required';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'environment-safety',
  "risk_class_code"     = 'high',
  "owner_contact"       = 'governance-team',
  "retirement_condition" = 'Must not be retired. External examiner oversight is required under QAA Quality Code Chapter B7 and OfS conditions for degree-awarding powers.',
  "allowed_scope_codes" = ARRAY['global','environment'],
  "non_bypassable"      = true
WHERE "flag_key" = 'exam-board.external-examiner.required';

-- Communications flags
UPDATE "feature_flag" SET
  "flag_class_code"     = 'module-enablement',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'platform-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'communications.locale-aware.enabled';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'integration-route',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'platform-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'communications.channel.email.enabled';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'integration-route',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'platform-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'communications.channel.crm-handoff.enabled';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'integration-route',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'platform-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'communications.channel.integration-event.enabled';

-- ── Section 3: Seed flag class and risk class value sets ──────────────────────

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('feature-flag-class',      'Feature Flag Class',      'srs-internal', '1.0', 'Governance taxonomy for feature flags (migration, release, tenant-variant, etc.)', false),
  ('feature-flag-risk-class', 'Feature Flag Risk Class', 'srs-internal', '1.0', 'Change-risk rating for a feature flag',                                           false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('migration',          'Migration',          10),
  ('release',            'Release gate',       20),
  ('tenant-variant',     'Tenant variant',     30),
  ('environment-safety', 'Environment safety', 40),
  ('module-enablement',  'Module enablement',  50),
  ('integration-route',  'Integration route',  60),
  ('kill-switch',        'Kill switch',        70)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'feature-flag-class'
ON CONFLICT DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('low',      'Low',      10),
  ('medium',   'Medium',   20),
  ('high',     'High',     30),
  ('critical', 'Critical', 40)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'feature-flag-risk-class'
ON CONFLICT DO NOTHING;


-- ============================================================
-- Originally: 0018_stage7_legacy_removal.sql
-- ============================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0018 — Stage 7: Legacy Removal and Schema Simplification
--
-- Removes the amount_pence column from fee_liability.
--
-- History:
--   Migration 0000 created fee_liability with amount_pence (integer, GBP-implicit).
--   Migration 0012 added amount_minor_units (bigint) and currency_code (text, default GBP)
--   as currency-aware replacements. All new records written after 0012 use
--   amount_minor_units; amount_pence has been set to NULL on every new insert
--   since migration 0012 was applied. The enrolment service never writes
--   amount_pence for records created in this codebase.
--
-- No data migration is required: this column has been null on all newly created
-- fee liabilities since migration 0012. Historical non-null values in production
-- must be migrated via a one-off data script before this migration runs on prod.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "fee_liability" DROP COLUMN IF EXISTS "amount_pence";


-- ============================================================
-- Originally: 0019_phase7_integration_registry.sql
-- ============================================================

-- Phase 7 Stage 4 — Plugin Registry Runtime APIs
-- Adds the OfS regulatory extracts contract to the integration contract catalogue.
-- All other integration_contract, integration_registration, and integration_exchange
-- tables were created in 0006_phase6_regulatory_schema.sql.

INSERT INTO "integration_contract" (
  "contract_id",
  "display_name",
  "owner_module_code",
  "direction_code",
  "pattern_type",
  "current_contract_version",
  "data_classification_code"
) VALUES (
  'ofs-regulatory-extracts.v1',
  'OfS Regulatory Extracts',
  'regulatory',
  'outbound',
  'api-and-file',
  '1.0.0',
  'regulatory'
) ON CONFLICT ("contract_id") DO NOTHING;


-- ============================================================
-- Originally: 0020_phase7_contract_deprecation.sql
-- ============================================================

-- Phase 7 Stage 4 completions — contract deprecation fields and constraint correction

-- 1. Deprecation and minimum version support on integration_contract.
--    deprecated_at: when the contract was deprecated (NULL = still active).
--    minimum_supported_version: oldest registration contractVersion still accepted.
ALTER TABLE "integration_contract"
  ADD COLUMN "deprecated_at"             TIMESTAMP WITH TIME ZONE,
  ADD COLUMN "minimum_supported_version" TEXT;

-- 2. Drop the overly restrictive unique constraint on (tenant_id, integration_code).
--    Tenants legitimately need multiple registrations for the same contract type
--    (e.g. multiple VLE instances, staging vs live endpoints, different transports).
ALTER TABLE "integration_registration"
  DROP CONSTRAINT IF EXISTS "integration_registration_tenant_code_unique";


-- ============================================================
-- Originally: 0021_phase9_vle_contracts.sql
-- ============================================================

-- Phase 9 — VLE Connector integration contracts
-- Registers the three contracts consumed and produced by the VLE Connector adapter.
-- F015: VLE Course Provisioning (outbound event-driven)
-- F016: VLE Assessment Results  (inbound API)
-- F059: VLE Adjustment Distribution (outbound event-driven)

INSERT INTO "integration_contract" (
  "contract_id",
  "display_name",
  "owner_module_code",
  "direction_code",
  "pattern_type",
  "current_contract_version",
  "data_classification_code"
) VALUES
  (
    'vle-course-provisioning.v1',
    'VLE Course Provisioning',
    'vle',
    'outbound',
    'event-driven',
    '1.0.0',
    'internal'
  ),
  (
    'vle-assessment-results.v1',
    'VLE Assessment Results',
    'vle',
    'inbound',
    'api',
    '1.0.0',
    'confidential'
  ),
  (
    'vle-adjustments.v1',
    'VLE Adjustment Distribution',
    'vle',
    'outbound',
    'event-driven',
    '1.0.0',
    'special-category'
  )
ON CONFLICT ("contract_id") DO NOTHING;

