import { date, smallint, text, uuid } from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';

import { tenants } from './tenant.js';

/**
 * Academic periods — the canonical time divisions within an academic year
 * (semesters, terms, full-year delivery).
 *
 * Non-bitemporal: periods are treated as fixed institutional calendar facts.
 * Corrections are made by inserting a replacement row after deleting the
 * original (captured in audit_record).
 */
export const academicPeriods = pgTable('academic_period', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       uuid('tenant_id').notNull().references(() => tenants.id),
  academicYear:   text('academic_year').notNull(),    // e.g. '2025-26'
  periodCode:     text('period_code').notNull(),      // e.g. 'SEM1', 'TERM2', 'FULL-YEAR'
  periodTypeCode: text('period_type_code').notNull(), // 'semester' | 'term' | 'year'
  startDate:      date('start_date').notNull(),
  endDate:        date('end_date').notNull(),
});

export type AcademicPeriod    = typeof academicPeriods.$inferSelect;
export type NewAcademicPeriod = typeof academicPeriods.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Module delivery instances — a module offered in a specific academic period.
 * Non-bitemporal; capacity and delivery mode are set when the offering is created
 * and updated by replacing the row (captured in audit_record).
 */
export const moduleOfferings = pgTable('module_offering', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         uuid('tenant_id').notNull().references(() => tenants.id),
  moduleId:         uuid('module_id').notNull(),  // logical FK → modules.id
  academicPeriodId: uuid('academic_period_id').notNull().references(() => academicPeriods.id),
  deliveryModeCode: text('delivery_mode_code'),
  capacity:         smallint('capacity'),
});

export type ModuleOffering    = typeof moduleOfferings.$inferSelect;
export type NewModuleOffering = typeof moduleOfferings.$inferInsert;
