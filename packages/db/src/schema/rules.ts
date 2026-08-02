import { jsonb, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenant.js';

/**
 * Configuration-driven institutional business rules - bitemporal.
 *
 * Programme-specific rules take precedence over tenant-wide defaults
 * (programme_id IS NOT NULL > programme_id IS NULL).
 *
 * See docs/architecture/configuration-rules-framework.md.
 */
export const academicRules = pgTable('academic_rule', {
  versionId:      uuid('version_id').primaryKey().defaultRandom(),
  id:             uuid('id').notNull(),
  tenantId:       uuid('tenant_id').notNull().references(() => tenants.id),
  programmeId:    uuid('programme_id'),  // null = tenant-wide default
  ruleTypeCode:   text('rule_type_code').notNull(),
  ruleKey:        text('rule_key').notNull(),
  ruleValue:      jsonb('rule_value').notNull().$type<Record<string, unknown>>(),
  description:    text('description'),
  appliesToLevel: smallint('applies_to_level'),
  // Bitemporal columns (constraints in migration DDL)
  validFrom:      timestamp('valid_from',    { withTimezone: true }).notNull(),
  validTo:        timestamp('valid_to',      { withTimezone: true }),
  recordedAt:     timestamp('recorded_at',   { withTimezone: true }).notNull().defaultNow(),
  recordedUntil:  timestamp('recorded_until',{ withTimezone: true }),
});
// UNIQUE INDEX (tenant_id, id, recorded_at) and partial UNIQUE on current version
// plus RLS policy are all in migration 0000_platform_foundations.sql

export type AcademicRule    = typeof academicRules.$inferSelect;
export type NewAcademicRule = typeof academicRules.$inferInsert;
