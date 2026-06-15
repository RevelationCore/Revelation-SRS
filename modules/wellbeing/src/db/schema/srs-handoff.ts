import { integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { w } from './wellbeing-case.js';

/**
 * SRS handoff outbox — transactional outbox for adjustment approvals.
 *
 * Written atomically with the approved status transition.  The
 * UNIQUE(idempotency_key) constraint is the exactly-once delivery guarantee:
 * even if the approve action is called multiple times, only one handoff record
 * is ever created and only one SRS submission is ever attempted.
 *
 * The background processor (or synchronous post-approve step) reads pending
 * rows and POSTs to the SRS F063 endpoint.
 */
export const srsHandoffOutbox = w.table('srs_handoff_outbox', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenantId:          uuid('tenant_id').notNull(),
  adjustmentCaseId:  uuid('adjustment_case_id').notNull(),
  personId:          uuid('person_id').notNull(),
  idempotencyKey:    text('idempotency_key').notNull().unique(),
  payload:           jsonb('payload').notNull().$type<Record<string, unknown>>().default({}),
  statusCode:        text('status_code').notNull().default('pending'), // pending | sent | failed
  attemptCount:      integer('attempt_count').notNull().default(0),
  lastAttemptedAt:   timestamp('last_attempted_at', { withTimezone: true }),
  sentAt:            timestamp('sent_at',            { withTimezone: true }),
  srsResponse:       jsonb('srs_response').$type<Record<string, unknown>>(),
  errorDetail:       text('error_detail'),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SrsHandoffOutboxEntry    = typeof srsHandoffOutbox.$inferSelect;
export type NewSrsHandoffOutboxEntry = typeof srsHandoffOutbox.$inferInsert;
