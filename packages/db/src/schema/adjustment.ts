import { integer, numeric, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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
  // Structured amount, so a target system can compute a concrete value per
  // assessment (e.g. 25 percent-of-duration on a 120-minute exam = 30 minutes)
  // rather than parse notes. Both null when the type has no amount (reader,
  // scribe, separate room) or none was recorded. Unit is value-set backed
  // (adjustment-amount-unit-code): percent-of-duration | minutes-per-hour | days.
  amountValue:       numeric('amount_value', { precision: 8, scale: 2 }),
  amountUnitCode:    text('amount_unit_code'),
});

export type ReasonableAdjustment    = typeof reasonableAdjustments.$inferSelect;
export type NewReasonableAdjustment = typeof reasonableAdjustments.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Adjustment distribution ledger — append-only; tracks delivery to downstream systems.
 *
 * One row per target system per adjustment, created with status 'pending' when
 * an adjustment is recorded. The row doubles as the outbox for the instruction
 * sent to that target (srs.adjustment.distribution-requested.<target>): the
 * dispatcher publishes it and stamps request_published_at. The target's
 * integration layer acknowledges via
 * POST /adjustments/:id/distributions/:distributionId/acknowledge, which
 * advances the row to 'distributed' and publishes adjustment.distributed, or
 * reports it cannot apply it via .../failure.
 *
 * When the adjustment expires, rows whose instruction was published move to
 * 'withdrawal-requested' (a withdrawal instruction is dispatched the same
 * way) and to 'withdrawn' when the target confirms removal. Rows never
 * published are simply 'superseded'.
 */
export const adjustmentDistributions = pgTable('adjustment_distribution', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  tenantId:            uuid('tenant_id').notNull().references(() => tenants.id),
  adjustmentId:        uuid('adjustment_id').notNull(),  // FK to reasonable_adjustment.id (logical)
  targetSystem:        text('target_system').notNull(),  // vle | attendance | exams
  // pending | distributed | failed | superseded | withdrawal-requested | withdrawn
  statusCode:          text('status_code').notNull().default('pending'),
  distributedAt:       timestamp('distributed_at', { withTimezone: true }),
  failureReason:       text('failure_reason'),
  createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // Outbox for the per-target instruction events. The event ids are fixed
  // per row so every republish carries the same id (JetStream de-duplicates
  // on it, and consumers on distributionId).
  requestEventId:        uuid('request_event_id').notNull().defaultRandom(),
  requestPublishedAt:    timestamp('request_published_at', { withTimezone: true }),
  withdrawalEventId:     uuid('withdrawal_event_id'),
  withdrawalRequestedAt: timestamp('withdrawal_requested_at', { withTimezone: true }),
  withdrawalPublishedAt: timestamp('withdrawal_published_at', { withTimezone: true }),
  withdrawnAt:           timestamp('withdrawn_at', { withTimezone: true }),
  // How this distribution is fulfilled (copied from adjustment_target_config
  // at creation): connected | manual | file. Only 'connected' rows are
  // published as events; 'manual' rows are tasks in the staff queue; 'file'
  // rows are delivered by an SRS file exchange (exam entries).
  fulfilmentModeCode:    text('fulfilment_mode_code').notNull().default('connected'),
});

/**
 * Per-tenant fulfilment mode for each adjustment target. No row: the
 * platform default for that target applies (DEFAULT_FULFILMENT_MODES).
 */
export const adjustmentTargetConfigs = pgTable('adjustment_target_config', {
  tenantId:           uuid('tenant_id').notNull().references(() => tenants.id),
  targetSystem:       text('target_system').notNull(),
  fulfilmentModeCode: text('fulfilment_mode_code').notNull(), // connected | manual | file | not-used
  ownerDescription:   text('owner_description'),
  alertAfterHours:    integer('alert_after_hours').notNull().default(72),
  // Team mailbox sent an overdue digest (at most daily); null: no notices.
  notifyEmail:        text('notify_email'),
  lastOverdueNoticeAt: timestamp('last_overdue_notice_at', { withTimezone: true }),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy:          text('updated_by').notNull(),
}, (table) => [primaryKey({ columns: [table.tenantId, table.targetSystem] })]);

export type AdjustmentTargetConfig = typeof adjustmentTargetConfigs.$inferSelect;

export type AdjustmentDistribution    = typeof adjustmentDistributions.$inferSelect;
export type NewAdjustmentDistribution = typeof adjustmentDistributions.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Accepted adjustment-recording requests, keyed by the caller's idempotency
 * key. A retry with the same key and payload returns the original adjustment
 * (for example after the response to the wellbeing module's handoff was
 * lost); the same key with a different payload is a conflict. Kept apart
 * from reasonable_adjustment because the key belongs to the logical
 * request, not to any one bitemporal version.
 */
export const adjustmentRequests = pgTable('adjustment_request', {
  tenantId:       uuid('tenant_id').notNull().references(() => tenants.id),
  idempotencyKey: text('idempotency_key').notNull(),
  payloadHash:    text('payload_hash').notNull(),
  adjustmentId:   uuid('adjustment_id').notNull(),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.tenantId, table.idempotencyKey] })]);

export type AdjustmentRequest = typeof adjustmentRequests.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// BPR-D09 note: an earlier `support_outcome`/shared distribution_item table
// (originally migration 0046_support_outcome_distribution, since squashed
// into 0004_business_process_foundations) was intended to replace
// adjustment_distribution above. It never reached parity — no route ever
// drove a distribution_item past creation (no acknowledge/reconcile path),
// it published no domain events, and no writer ever superseded one — while
// adjustment_distribution remained the live, tested, externally-contracted
// path (two documented adapters, VLE and attendance, key their idempotency
// on it). Retired in migration 0006_adjustments_integration_and_support.sql (section 0022_retire_support_outcome) rather than
// finished and migrated onto, given it was unused and untested end to end.
// See docs/user-guides/wellbeing-and-revelation-srs.md for the full account.
