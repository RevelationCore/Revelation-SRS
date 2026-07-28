import { text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { a } from './attendance-schema.js';

export const expectedEngagementEvents = a.table('expected_engagement_event', {
  versionId:          uuid('version_id').primaryKey().defaultRandom(),
  id:                 uuid('id').notNull(),
  tenantId:           uuid('tenant_id').notNull(),
  personId:           uuid('person_id').notNull(),
  enrolmentId:        uuid('enrolment_id').notNull(),
  // Hook for recording attendance against the outcome of module selection.
  // No FK constraint — matches the loose-coupling style already used for
  // enrolmentId throughout this schema. Nullable until a real timetable
  // session identifier exists to populate it.
  moduleRegistrationId: uuid('module_registration_id'),
  activityTypeCode:  text('activity_type_code').notNull(),
  activityReference: text('activity_reference'),
  eventModeCode:     text('event_mode_code').notNull(),
  scheduledFrom:     timestamp('scheduled_from', { withTimezone: true }).notNull(),
  scheduledTo:       timestamp('scheduled_to', { withTimezone: true }),
  locationReference: text('location_reference'),
  sourceSystemCode:  text('source_system_code').notNull(),
  sourceEventId:     text('source_event_id').notNull(),
  sourceVersion:     text('source_version').notNull(),
  statusCode:        text('status_code').notNull().default('expected'),
  actorId:           text('actor_id').notNull().default('system'),
  validFrom:         timestamp('valid_from', { withTimezone: true }).notNull(),
  validTo:           timestamp('valid_to', { withTimezone: true }),
  recordedAt:        timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  recordedUntil:     timestamp('recorded_until', { withTimezone: true }),
});

export type ExpectedEngagementEvent = typeof expectedEngagementEvents.$inferSelect;
