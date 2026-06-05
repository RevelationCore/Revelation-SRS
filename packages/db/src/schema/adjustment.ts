import { text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';

import { bitemporalColumns } from '../temporal.js';

import { tenants } from './tenant.js';

/**
 * Reasonable adjustment — bitemporal; disability/wellbeing accommodation.
 *
 * Records the type and scope of accommodation, and its valid period. Multiple
 * adjustments can be active simultaneously for one student (e.g. extra time
 * AND separate room).
 *
 * Downstream systems receive notifications via adjustment_distribution rows.
 */
export const reasonableAdjustments = pgTable('reasonable_adjustment', {
  ...bitemporalColumns,
  tenantId:          uuid('tenant_id').notNull().references(() => tenants.id),
  enrolmentId:       uuid('enrolment_id').notNull(),
  personId:          uuid('person_id').notNull(),
  adjustmentTypeCode: text('adjustment_type_code').notNull(), // extra-time | separate-room | deadline-extension | reader | scribe | rest-breaks
  scopeCode:         text('scope_code').notNull(),             // all | exam | coursework | attendance
  notes:             text('notes'),
  actorId:           text('actor_id').notNull(),
});

export type ReasonableAdjustment    = typeof reasonableAdjustments.$inferSelect;
export type NewReasonableAdjustment = typeof reasonableAdjustments.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Adjustment distribution ledger — append-only; tracks delivery to downstream systems.
 *
 * One row per target system per adjustment, created with status 'pending' when
 * an adjustment is recorded. Integration services acknowledge via the
 * POST /adjustments/:id/distributions/:distributionId/acknowledge route,
 * which advances the row to 'distributed' and publishes adjustment.distributed.
 */
export const adjustmentDistributions = pgTable('adjustment_distribution', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  tenantId:            uuid('tenant_id').notNull().references(() => tenants.id),
  adjustmentId:        uuid('adjustment_id').notNull(),  // FK to reasonable_adjustment.id (logical)
  targetSystem:        text('target_system').notNull(),  // vle | attendance | exams
  statusCode:          text('status_code').notNull().default('pending'), // pending | distributed | failed | superseded
  distributedAt:       timestamp('distributed_at', { withTimezone: true }),
  failureReason:       text('failure_reason'),
  createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AdjustmentDistribution    = typeof adjustmentDistributions.$inferSelect;
export type NewAdjustmentDistribution = typeof adjustmentDistributions.$inferInsert;
