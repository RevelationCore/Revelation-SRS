import { boolean, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { a } from './attendance-schema.js';

export const engagementObservations = a.table('engagement_observation', {
  versionId:            uuid('version_id').primaryKey().defaultRandom(),
  id:                   uuid('id').notNull(),
  tenantId:             uuid('tenant_id').notNull(),
  expectedEventId:      uuid('expected_event_id'),
  personId:             uuid('person_id').notNull(),
  enrolmentId:          uuid('enrolment_id').notNull(),
  sourceSystemCode:     text('source_system_code').notNull(),
  sourceEventId:        text('source_event_id').notNull(),
  sourceVersion:        text('source_version').notNull(),
  idempotencyKey:       text('idempotency_key').notNull(),
  captureMethodCode:    text('capture_method_code').notNull(),
  outcomeCode:          text('outcome_code').notNull(),
  dataQualityCode:      text('data_quality_code').notNull().default('valid'),
  eventTime:            timestamp('event_time', { withTimezone: true }).notNull(),
  receivedAt:           timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  deviceReference:      text('device_reference'),
  operationalReference: text('operational_reference'),
  actorId:              text('actor_id').notNull(),
  validFrom:            timestamp('valid_from', { withTimezone: true }).notNull(),
  validTo:              timestamp('valid_to', { withTimezone: true }),
  recordedAt:           timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  recordedUntil:        timestamp('recorded_until', { withTimezone: true }),
});

export const engagementObservationRevisions = a.table('engagement_observation_revision', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  tenantId:             uuid('tenant_id').notNull(),
  observationId:        uuid('observation_id').notNull(),
  supersededVersionId:  uuid('superseded_version_id').notNull(),
  replacementVersionId: uuid('replacement_version_id').notNull(),
  correctionReasonCode: text('correction_reason_code').notNull(),
  correctionReason:     text('correction_reason'),
  disputed:             boolean('disputed').notNull().default(false),
  authorisedBy:         text('authorised_by').notNull(),
  recordedAt:           timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  correlationId:        uuid('correlation_id'),
});

export type EngagementObservation = typeof engagementObservations.$inferSelect;
export type EngagementObservationRevision = typeof engagementObservationRevisions.$inferSelect;
