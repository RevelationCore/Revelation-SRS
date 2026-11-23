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
  // ADR-033: the authority this adjustment was recorded under. NOT NULL with
  // no default, so every writer must name one; a CHECK ties each code to its
  // reference (value set adjustment-provenance-code).
  provenanceCode:    text('provenance_code').notNull(), // wellbeing-case | manual-approved | migrated | legacy-direct
  manualProposalId:  uuid('manual_proposal_id'),
  migrationBatchId:  uuid('migration_batch_id'),
  migrationSourceReference: text('migration_source_reference'),
  // ADR-034: set on the version that ended the adjustment early, naming the
  // authority and reason; a CHECK ties each authority to its reference.
  withdrawalAuthorityCode:  text('withdrawal_authority_code'), // wellbeing-case | approved-withdrawal | enrolment-ended
  withdrawalReasonCode:     text('withdrawal_reason_code'),    // value set adjustment-withdrawal-reason-code
  withdrawalId:             uuid('withdrawal_id'),
  withdrawalEnrolmentTransitionId: uuid('withdrawal_enrolment_transition_id'),
  replacementAdjustmentId:  uuid('replacement_adjustment_id'),
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

/**
 * A manual adjustment proposal (ADR-033 item 2, migration 0009): a core
 * adjustment with no wellbeing case behind it, held here until an adjustment
 * approver who did not propose it decides it. Not bitemporal: a governed
 * decision record, like ec_determination. Readers of reasonable_adjustment
 * never see a proposal; approval writes the adjustment (provenance
 * 'manual-approved') and sets adjustmentId. There is no notes field: free
 * text must not reach the targets (BL-243).
 */
export const adjustmentProposals = pgTable('adjustment_proposal', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  tenantId:            uuid('tenant_id').notNull().references(() => tenants.id),
  personId:            uuid('person_id').notNull(),
  enrolmentId:         uuid('enrolment_id').notNull(),
  adjustmentTypeCode:  text('adjustment_type_code').notNull(),
  scopeCode:           text('scope_code').notNull(),
  amountValue:         numeric('amount_value', { precision: 8, scale: 2 }),
  amountUnitCode:      text('amount_unit_code'),
  validFrom:           timestamp('valid_from', { withTimezone: true }).notNull(),
  validTo:             timestamp('valid_to', { withTimezone: true }),
  manualReasonCode:    text('manual_reason_code').notNull(),   // value set adjustment-manual-reason-code
  externalReference:   text('external_reference').notNull(),   // where the decision is held; 1-100 chars
  statusCode:          text('status_code').notNull().default('proposed'), // proposed | approved | rejected
  proposedBy:          text('proposed_by').notNull(),
  proposedByPersonId:  uuid('proposed_by_person_id'),
  proposedAt:          timestamp('proposed_at', { withTimezone: true }).notNull().defaultNow(),
  workflowInstanceId:  uuid('workflow_instance_id'),
  decidedBy:           text('decided_by'),
  decidedByPersonId:   uuid('decided_by_person_id'),
  decidedAt:           timestamp('decided_at', { withTimezone: true }),
  decisionReason:      text('decision_reason'),
  adjustmentId:        uuid('adjustment_id'),
});

export type AdjustmentProposal = typeof adjustmentProposals.$inferSelect;

/**
 * A proposal to end a manual, migrated or legacy adjustment early (ADR-034
 * item 5, migration 0012), decided by an adjustment approver who did not
 * propose it. Until it is approved the adjustment is unchanged. An adjustment
 * from a wellbeing case is withdrawn through its case instead.
 */
export const adjustmentWithdrawals = pgTable('adjustment_withdrawal', {
  id:                      uuid('id').primaryKey().defaultRandom(),
  tenantId:                uuid('tenant_id').notNull().references(() => tenants.id),
  adjustmentId:            uuid('adjustment_id').notNull(),   // the logical id; not a FK, it repeats across versions
  personId:                uuid('person_id').notNull(),
  withdrawalReasonCode:    text('withdrawal_reason_code').notNull(),
  externalReference:       text('external_reference').notNull(),
  replacementAdjustmentId: uuid('replacement_adjustment_id'),
  statusCode:              text('status_code').notNull().default('proposed'), // proposed | approved | rejected
  proposedBy:              text('proposed_by').notNull(),
  proposedByPersonId:      uuid('proposed_by_person_id'),
  proposedAt:              timestamp('proposed_at', { withTimezone: true }).notNull().defaultNow(),
  workflowInstanceId:      uuid('workflow_instance_id'),
  decidedBy:               text('decided_by'),
  decidedByPersonId:       uuid('decided_by_person_id'),
  decidedAt:               timestamp('decided_at', { withTimezone: true }),
  decisionReason:          text('decision_reason'),
  withdrawnAt:             timestamp('withdrawn_at', { withTimezone: true }),
});

export type AdjustmentWithdrawal = typeof adjustmentWithdrawals.$inferSelect;

/**
 * The release of one migrated adjustment for distribution (ADR-033 item 7,
 * migration 0010). Append-only; its presence is what makes a repeated batch
 * release a no-op, including for adjustments every target ignores.
 */
export const adjustmentMigrationReleases = pgTable('adjustment_migration_release', {
  tenantId:                uuid('tenant_id').notNull().references(() => tenants.id),
  adjustmentId:            uuid('adjustment_id').notNull(),
  migrationBatchId:        uuid('migration_batch_id').notNull(),
  reconciliationReference: text('reconciliation_reference').notNull(),
  releasedBy:              text('released_by').notNull(),
  releasedAt:              timestamp('released_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.tenantId, table.adjustmentId] })]);

// ─────────────────────────────────────────────────────────────────────────────
// BPR-D09 note: an earlier `support_outcome`/shared distribution_item table
// (originally migration 0046_support_outcome_distribution, since squashed
// into 0000_baseline (section 0004_business_process_foundations)) was intended to replace
// adjustment_distribution above. It never reached parity — no route ever
// drove a distribution_item past creation (no acknowledge/reconcile path),
// it published no domain events, and no writer ever superseded one — while
// adjustment_distribution remained the live, tested, externally-contracted
// path (two documented adapters, VLE and attendance, key their idempotency
// on it). Retired in migration 0000_baseline.sql (section 0006_adjustments_integration_and_support / 0022_retire_support_outcome) rather than
// finished and migrated onto, given it was unused and untested end to end.
// See docs/user-guides/wellbeing-and-revelation-srs.md for the full account.
