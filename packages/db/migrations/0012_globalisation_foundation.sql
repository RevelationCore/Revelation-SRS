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
