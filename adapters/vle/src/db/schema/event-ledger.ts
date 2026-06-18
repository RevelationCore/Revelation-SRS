import { bigint, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const v = pgSchema('vle_connector');

/**
 * Event ledger — one row per processed (or attempted) event.
 *
 * Idempotency: query for (tenant_id, event_id, status_code = 'processed').
 * Multiple 'failed' rows may exist for the same event — one per retry attempt.
 * This allows full observability of retry history without blocking re-processing.
 *
 * status_code values:
 *   processed — handler completed successfully
 *   failed    — handler threw; this row records the error detail for that attempt
 *   skipped   — event subject not in the VLE's handled set (should not occur with subject filters)
 */
export const eventLedger = v.table('vle_event_ledger', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull(),
  eventId:      text('event_id').notNull(),
  subject:      text('subject').notNull(),
  statusCode:   text('status_code').notNull().default('processed'),
  errorDetail:  text('error_detail'),
  streamSeq:    bigint('stream_seq', { mode: 'bigint' }),
  eventHash:    text('event_hash'),
  attemptCount: integer('attempt_count').notNull().default(1),
  processedAt:  timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
});
