import { customType, date, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';

import { tenants } from './tenant.js';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

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

// ─────────────────────────────────────────────────────────────────────────────

/**
 * When students may submit module selections (Phase 4 D-29): a window per
 * academic period, optionally narrowed to a programme and/or the student's
 * current FHEQ level. The most specific window applies. Enforced at
 * submission when one applies, or always when the tenant sets
 * moduleSelection.windowEnforcement to 'required'.
 */
export const moduleSelectionWindows = pgTable('module_selection_window', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  tenantId:             uuid('tenant_id').notNull().references(() => tenants.id),
  academicPeriodId:     uuid('academic_period_id').notNull().references(() => academicPeriods.id),
  /** Null: every programme. */
  programmeId:          uuid('programme_id'),
  /** The student's current FHEQ level; null: every level. */
  fheqLevel:            smallint('fheq_level'),
  opensAt:              timestamp('opens_at', { withTimezone: true }).notNull(),
  closesAt:             timestamp('closes_at', { withTimezone: true }).notNull(),
  /** Returned proposals may be resubmitted until then; null: closesAt. */
  resubmissionClosesAt: timestamp('resubmission_closes_at', { withTimezone: true }),
  allocationModeCode:   text('allocation_mode_code').notNull().default('ranked'), // 'first-come' | 'ranked'
  /** Generated once at the window's first allocation preview and never changed (D-30). */
  allocationSeed:       bytea('allocation_seed'),
  createdBy:            text('created_by'),
  createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ModuleSelectionWindow    = typeof moduleSelectionWindows.$inferSelect;
export type NewModuleSelectionWindow = typeof moduleSelectionWindows.$inferInsert;

/** A day that is not a working day for statutory deadlines (Phase 5 D-42): a bank holiday or an institution closure. */
export const nonWorkingDays = pgTable('non_working_day', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull().references(() => tenants.id),
  date:         date('date').notNull(),
  divisionCode: text('division_code').notNull(), // england-and-wales | scotland | northern-ireland | tenant
  description:  text('description').notNull(),
  source:       text('source').notNull(),        // gov-uk-json | manual
  createdBy:    text('created_by').notNull(),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export type NonWorkingDay = typeof nonWorkingDays.$inferSelect;
