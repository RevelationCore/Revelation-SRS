import {
  boolean,
  date,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { tenants } from './tenant.js';
import { valueSetMembers } from './value-sets.js';

/**
 * Registry of available BCP-47 locale packs.
 *
 * Platform-managed; not tenant-extensible. The platform default (en-GB) is
 * always available. Institutions select from active locale packs when
 * configuring their supported locales.
 */
export const localeResourcePacks = pgTable('locale_resource_pack', {
  id:                uuid('id').primaryKey().defaultRandom(),
  localeCode:        text('locale_code').notNull().unique(),
  displayName:       text('display_name').notNull(),
  nativeDisplayName: text('native_display_name').notNull(),
  isRtl:             boolean('is_rtl').notNull().default(false),
  isPlatformDefault: boolean('is_platform_default').notNull().default(false),
  active:            boolean('active').notNull().default(true),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type LocaleResourcePack    = typeof localeResourcePacks.$inferSelect;
export type NewLocaleResourcePack = typeof localeResourcePacks.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-tenant locale and time-zone configuration.
 *
 * One row per tenant. RLS enforces tenant isolation.
 * Administrators configure the institution's default locale, supported
 * locales, time zone, and display format preferences.
 */
export const tenantLocaleConfigs = pgTable('tenant_locale_config', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         uuid('tenant_id').notNull().references(() => tenants.id).unique(),
  defaultLocale:    text('default_locale').notNull().default('en-GB'),
  fallbackLocale:   text('fallback_locale').notNull().default('en-GB'),
  supportedLocales: text('supported_locales').array().notNull().default(['en-GB']),
  defaultTimeZone:  text('default_time_zone').notNull().default('Europe/London'),
  dateFormatCode:   text('date_format_code').notNull().default('iso'),
  firstDayOfWeek:   smallint('first_day_of_week').notNull().default(1),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type TenantLocaleConfig    = typeof tenantLocaleConfigs.$inferSelect;
export type NewTenantLocaleConfig = typeof tenantLocaleConfigs.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Translated display labels for value set members.
 *
 * Keyed by (value_set_member_id, locale_code). The application resolves
 * labels by requesting the target locale then falling back to the tenant's
 * fallback locale and finally to the platform default (en-GB).
 *
 * The en-GB label is the value_set_member.display_label column on the member
 * itself; entries here are supplementary translations.
 */
export const valueSetMemberLabels = pgTable('value_set_member_label', {
  id:               uuid('id').primaryKey().defaultRandom(),
  valueSetMemberId: uuid('value_set_member_id').notNull().references(() => valueSetMembers.id),
  localeCode:       text('locale_code').notNull(),
  displayLabel:     text('display_label').notNull(),
  description:      text('description'),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ValueSetMemberLabel    = typeof valueSetMemberLabels.$inferSelect;
export type NewValueSetMemberLabel = typeof valueSetMemberLabels.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * ISO 4217 currency registry.
 *
 * Platform-managed; not tenant-extensible. minor_units records how many
 * decimal places the currency uses (e.g. GBP=2, JPY=0, KWD=3).
 * All monetary storage uses integer minor units; this table provides the
 * scale for formatting and conversion.
 */
export const currencies = pgTable('currency', {
  id:           uuid('id').primaryKey().defaultRandom(),
  currencyCode: text('currency_code').notNull().unique(),
  numericCode:  text('numeric_code'),
  displayName:  text('display_name').notNull(),
  symbol:       text('symbol'),
  minorUnits:   smallint('minor_units').notNull().default(2),
  active:       boolean('active').notNull().default(true),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Currency    = typeof currencies.$inferSelect;
export type NewCurrency = typeof currencies.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Effective-dated, auditable exchange rates.
 *
 * Rates are immutable once recorded; a correction is a new row with the same
 * effective_date and a later recorded_at. The most recently recorded row for
 * a (from, to, effective_date) triple wins. source identifies the rate
 * provider (ecb | boe | manual | test) and source_reference carries the
 * provider's document or feed reference.
 */
export const exchangeRates = pgTable('exchange_rate', {
  id:               uuid('id').primaryKey().defaultRandom(),
  fromCurrencyCode: text('from_currency_code').notNull(),
  toCurrencyCode:   text('to_currency_code').notNull(),
  rate:             numeric('rate', { precision: 20, scale: 10 }).notNull(),
  effectiveDate:    date('effective_date').notNull(),
  source:           text('source').notNull(),
  sourceReference:  text('source_reference'),
  recordedAt:       timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  recordedBy:       text('recorded_by').notNull().default('system'),
});

export type ExchangeRate    = typeof exchangeRates.$inferSelect;
export type NewExchangeRate = typeof exchangeRates.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-tenant currency configuration.
 *
 * One row per tenant. RLS enforces tenant isolation.
 * default_currency_code is the institution's functional currency for
 * financial records and statutory outputs. accepted_currencies lists all
 * ISO 4217 codes the tenant may receive or record in financial transactions.
 * requires_conversion_evidence mandates that a recorded exchange rate exists
 * before a non-default-currency amount can be submitted.
 */
export const tenantCurrencyConfigs = pgTable('tenant_currency_config', {
  id:                         uuid('id').primaryKey().defaultRandom(),
  tenantId:                   uuid('tenant_id').notNull().references(() => tenants.id).unique(),
  defaultCurrencyCode:        text('default_currency_code').notNull().default('GBP'),
  acceptedCurrencies:         text('accepted_currencies').array().notNull().default(['GBP']),
  requiresConversionEvidence: boolean('requires_conversion_evidence').notNull().default(false),
  createdAt:                  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:                  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type TenantCurrencyConfig    = typeof tenantCurrencyConfigs.$inferSelect;
export type NewTenantCurrencyConfig = typeof tenantCurrencyConfigs.$inferInsert;
