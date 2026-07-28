import { integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { a } from './attendance-schema.js';

export const engagementPolicyVersions = a.table('engagement_policy_version', {
  versionId:      uuid('version_id').primaryKey().defaultRandom(),
  id:             uuid('id').notNull(),
  tenantId:       uuid('tenant_id').notNull(),
  policyCode:     text('policy_code').notNull(),
  versionNumber:  integer('version_number').notNull(),
  displayName:    text('display_name').notNull(),
  statusCode:     text('status_code').notNull().default('draft'),
  applicability:  jsonb('applicability').notNull().$type<Record<string, unknown>>().default({}),
  evidenceWindow: jsonb('evidence_window').notNull().$type<Record<string, unknown>>().default({}),
  alertRules:     jsonb('alert_rules').notNull().$type<Record<string, unknown>>().default({}),
  reviewDeadline: jsonb('review_deadline').notNull().$type<Record<string, unknown>>().default({}),
  approvedBy:     text('approved_by'),
  approvedAt:     timestamp('approved_at', { withTimezone: true }),
  actorId:        text('actor_id').notNull(),
  validFrom:      timestamp('valid_from', { withTimezone: true }).notNull(),
  validTo:        timestamp('valid_to', { withTimezone: true }),
  recordedAt:     timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  recordedUntil:  timestamp('recorded_until', { withTimezone: true }),
});

export type EngagementPolicyVersion = typeof engagementPolicyVersions.$inferSelect;
