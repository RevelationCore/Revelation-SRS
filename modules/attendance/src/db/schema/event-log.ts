import { bigint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { a } from './attendance-schema.js';

/**
 * Event log — one row per processed event per consumer group.
 * Append-only; never updated. Enables idempotent event processing.
 */
export const eventLog = a.table('event_log', {
  id:            uuid('id').primaryKey().defaultRandom(),
  eventId:       text('event_id').notNull(),
  subject:       text('subject').notNull(),
  tenantId:      uuid('tenant_id').notNull(),
  streamSeq:     bigint('stream_seq', { mode: 'bigint' }),
  consumerGroup: text('consumer_group').notNull(),
  eventHash:     text('event_hash').notNull(),
  processedAt:   timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
});

export type EventLog = typeof eventLog.$inferSelect;

// ---------------------------------------------------------------------------

/**
 * Enrolment → person lookup map, built from srs.student.enrolled events.
 * Replaces the live "enrolments" table join the core service used to do.
 */
export const enrolmentPersonMap = a.table('enrolment_person_map', {
  tenantId:    uuid('tenant_id').notNull(),
  enrolmentId: uuid('enrolment_id').notNull(),
  personId:    uuid('person_id').notNull(),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type EnrolmentPersonMap = typeof enrolmentPersonMap.$inferSelect;

/**
 * Module registration lookup map, built from srs.enrolment.module-registered
 * events. Gives expected-event creation a way to validate/attach a
 * moduleRegistrationId without a live cross-service query.
 */
export const moduleRegistrationMap = a.table('module_registration_map', {
  tenantId:             uuid('tenant_id').notNull(),
  moduleRegistrationId: uuid('module_registration_id').notNull(),
  enrolmentId:          uuid('enrolment_id').notNull(),
  personId:             uuid('person_id').notNull(),
  moduleId:             text('module_id').notNull(),
  statusCode:           text('status_code').notNull().default('registered'),
  createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ModuleRegistrationMap = typeof moduleRegistrationMap.$inferSelect;
