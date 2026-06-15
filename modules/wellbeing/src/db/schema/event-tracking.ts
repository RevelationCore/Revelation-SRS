import { bigint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { w } from './wellbeing-case.js';

/**
 * Event log — one row per processed event per consumer group.
 * Append-only; never updated. Enables idempotent event processing:
 * if (eventId, consumerGroup) already exists, the event is a replay and is skipped.
 */
export const eventLog = w.table('event_log', {
  id:             uuid('id').primaryKey().defaultRandom(),
  eventId:        text('event_id').notNull(),
  subject:        text('subject').notNull(),
  tenantId:       uuid('tenant_id').notNull(),
  streamSeq:      bigint('stream_seq', { mode: 'bigint' }),
  consumerGroup:  text('consumer_group').notNull(),
  eventHash:      text('event_hash').notNull(),
  processedAt:    timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
});

export type EventLog    = typeof eventLog.$inferSelect;
export type NewEventLog = typeof eventLog.$inferInsert;

// ---------------------------------------------------------------------------

/**
 * Enrolment → person lookup map.
 * Built from srs.student.enrolled events. Used to resolve personId for
 * enrolment-keyed events (module-registered, status-changed, etc.).
 */
export const enrolmentPersonMap = w.table('enrolment_person_map', {
  tenantId:     uuid('tenant_id').notNull(),
  enrolmentId:  uuid('enrolment_id').notNull(),
  personId:     uuid('person_id').notNull(),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type EnrolmentPersonMap    = typeof enrolmentPersonMap.$inferSelect;
export type NewEnrolmentPersonMap = typeof enrolmentPersonMap.$inferInsert;

// ---------------------------------------------------------------------------

/**
 * Module registration → person lookup map.
 * Built from srs.enrolment.module-registered events. Used to resolve personId
 * for assessment events (mark-received, module-result-ratified).
 */
export const moduleRegPersonMap = w.table('module_reg_person_map', {
  tenantId:             uuid('tenant_id').notNull(),
  moduleRegistrationId: uuid('module_registration_id').notNull(),
  enrolmentId:          uuid('enrolment_id').notNull(),
  personId:             uuid('person_id').notNull(),
  moduleId:             text('module_id').notNull(),
  createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ModuleRegPersonMap    = typeof moduleRegPersonMap.$inferSelect;
export type NewModuleRegPersonMap = typeof moduleRegPersonMap.$inferInsert;
