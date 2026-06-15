import { integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { w } from './wellbeing-case.js';

/**
 * SRS EC handoff outbox — transactional outbox for upheld EC determinations.
 *
 * Written atomically with the 'upheld' status transition.  Only created for
 * claims whose determination_code is 'upheld' or 'partially_upheld'.
 * Claims that are 'not_upheld' or 'withdrawn' never produce an outbox record
 * and therefore never reach SRS board preparation data.
 */
export const srsEcHandoffOutbox = w.table('srs_ec_handoff_outbox', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         uuid('tenant_id').notNull(),
  ecClaimId:        uuid('ec_claim_id').notNull(),
  personId:         uuid('person_id').notNull(),
  idempotencyKey:   text('idempotency_key').notNull().unique(),
  payload:          jsonb('payload').notNull().$type<Record<string, unknown>>().default({}),
  statusCode:       text('status_code').notNull().default('pending'),
  attemptCount:     integer('attempt_count').notNull().default(0),
  lastAttemptedAt:  timestamp('last_attempted_at', { withTimezone: true }),
  sentAt:           timestamp('sent_at',            { withTimezone: true }),
  srsResponse:      jsonb('srs_response').$type<Record<string, unknown>>(),
  errorDetail:      text('error_detail'),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SrsEcHandoffOutboxEntry    = typeof srsEcHandoffOutbox.$inferSelect;
export type NewSrsEcHandoffOutboxEntry = typeof srsEcHandoffOutbox.$inferInsert;
