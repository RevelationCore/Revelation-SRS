import { boolean, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { a } from './attendance-schema.js';

export const engagementAlerts = a.table('engagement_alert', {
  versionId:           uuid('version_id').primaryKey().defaultRandom(),
  id:                  uuid('id').notNull(),
  tenantId:            uuid('tenant_id').notNull(),
  personId:            uuid('person_id').notNull(),
  enrolmentId:         uuid('enrolment_id').notNull(),
  policyVersionId:     uuid('policy_version_id').notNull(),
  evidenceWindowFrom:  timestamp('evidence_window_from', { withTimezone: true }).notNull(),
  evidenceWindowTo:    timestamp('evidence_window_to', { withTimezone: true }).notNull(),
  evidenceSnapshot:    jsonb('evidence_snapshot').notNull().$type<Record<string, unknown>>().default({}),
  evidenceHash:        text('evidence_hash').notNull(),
  explanation:         jsonb('explanation').notNull().$type<Record<string, unknown>>().default({}),
  severityCode:        text('severity_code').notNull(),
  statusCode:          text('status_code').notNull().default('open'),
  reevaluationRequired: boolean('reevaluation_required').notNull().default(false),
  actorId:             text('actor_id').notNull().default('system'),
  validFrom:           timestamp('valid_from', { withTimezone: true }).notNull(),
  validTo:             timestamp('valid_to', { withTimezone: true }),
  recordedAt:          timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  recordedUntil:       timestamp('recorded_until', { withTimezone: true }),
});

export type EngagementAlert = typeof engagementAlerts.$inferSelect;
