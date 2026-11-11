import { text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';
import { documents } from '@revelation-srs/documents';

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
  // Opaque cross-service reference to the wellbeing module's adjustment_case
  // logical id, when this record originated from that module's referral ->
  // assessment -> approve workflow. Not a foreign key — the wellbeing
  // module's database is entirely separate from this one. Null when a
  // registry administrator recorded the adjustment directly (a manual/
  // legacy entry with no wellbeing case behind it).
  sourceCaseId:      uuid('source_case_id'),
  // Detail document expanding on the coded adjustment (e.g. a specific
  // seating/equipment/software specification) when the type/scope/notes
  // fields aren't expressive enough on their own. Stored via this
  // service's own `packages/documents` install — a real FK, unlike
  // sourceCaseId above, since both tables live in this same database.
  outcomeDocumentId: uuid('outcome_document_id').references(() => documents.id),
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

// ─────────────────────────────────────────────────────────────────────────────
// BPR-D09 note: an earlier `support_outcome`/shared distribution_item table
// (originally migration 0046_support_outcome_distribution, since squashed
// into 0004_business_process_foundations) was intended to replace
// adjustment_distribution above. It never reached parity — no route ever
// drove a distribution_item past creation (no acknowledge/reconcile path),
// it published no domain events, and no writer ever superseded one — while
// adjustment_distribution remained the live, tested, externally-contracted
// path (two documented adapters, VLE and attendance, key their idempotency
// on it). Retired in migration 0022_retire_support_outcome.sql rather than
// finished and migrated onto, given it was unused and untested end to end.
// See docs/user-guides/wellbeing-and-revelation-srs.md for the full account.
