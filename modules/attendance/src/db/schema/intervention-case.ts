import { text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { a } from './attendance-schema.js';

export const engagementInterventionCases = a.table('engagement_intervention_case', {
  versionId:           uuid('version_id').primaryKey().defaultRandom(),
  id:                  uuid('id').notNull(),
  tenantId:            uuid('tenant_id').notNull(),
  alertId:             uuid('alert_id').notNull(),
  personId:            uuid('person_id').notNull(),
  enrolmentId:         uuid('enrolment_id').notNull(),
  statusCode:          text('status_code').notNull().default('open'),
  outcomeCode:         text('outcome_code'),
  assignedRoleCode:    text('assigned_role_code'),
  assignedActorId:     text('assigned_actor_id'),
  workflowInstanceId:  uuid('workflow_instance_id'),
  correlationId:       uuid('correlation_id').notNull(),
  openedAt:            timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  reviewAt:            timestamp('review_at', { withTimezone: true }),
  dueAt:               timestamp('due_at', { withTimezone: true }),
  closedAt:            timestamp('closed_at', { withTimezone: true }),
  actorId:             text('actor_id').notNull(),
  idempotencyKey:      text('idempotency_key'),
  validFrom:           timestamp('valid_from', { withTimezone: true }).notNull(),
  validTo:             timestamp('valid_to', { withTimezone: true }),
  recordedAt:          timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  recordedUntil:       timestamp('recorded_until', { withTimezone: true }),
});

export const engagementContactAttempts = a.table('engagement_contact_attempt', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  tenantId:            uuid('tenant_id').notNull(),
  interventionCaseId:  uuid('intervention_case_id').notNull(),
  channelCode:         text('channel_code').notNull(),
  attemptedAt:         timestamp('attempted_at', { withTimezone: true }).notNull(),
  outcomeCode:         text('outcome_code').notNull(),
  communicationLocale: text('communication_locale'),
  operationalNote:     text('operational_note'),
  dataClassification:  text('data_classification').notNull().default('sensitive-personal'),
  actorId:             text('actor_id').notNull(),
  idempotencyKey:      text('idempotency_key').notNull(),
  createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const engagementActions = a.table('engagement_action', {
  id:                     uuid('id').primaryKey().defaultRandom(),
  tenantId:               uuid('tenant_id').notNull(),
  interventionCaseId:     uuid('intervention_case_id').notNull(),
  actionTypeCode:         text('action_type_code').notNull(),
  operationalInstruction: text('operational_instruction'),
  ownerRoleCode:          text('owner_role_code'),
  ownerActorId:           text('owner_actor_id'),
  dueAt:                  timestamp('due_at', { withTimezone: true }),
  completedAt:            timestamp('completed_at', { withTimezone: true }),
  completedBy:            text('completed_by'),
  createdBy:              text('created_by').notNull(),
  idempotencyKey:         text('idempotency_key').notNull(),
  createdAt:              timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const engagementReferrals = a.table('engagement_referral', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  tenantId:              uuid('tenant_id').notNull(),
  interventionCaseId:    uuid('intervention_case_id').notNull(),
  targetServiceCode:     text('target_service_code').notNull(),
  referralTypeCode:      text('referral_type_code').notNull(),
  statusCode:            text('status_code').notNull().default('pending'),
  externalReference:     text('external_reference'),
  integrationExchangeId: uuid('integration_exchange_id'),
  correlationId:         uuid('correlation_id').notNull(),
  referredBy:            text('referred_by').notNull(),
  referredAt:            timestamp('referred_at', { withTimezone: true }).notNull().defaultNow(),
  acknowledgedAt:        timestamp('acknowledged_at', { withTimezone: true }),
  idempotencyKey:        text('idempotency_key').notNull(),
});

export type EngagementInterventionCase = typeof engagementInterventionCases.$inferSelect;
export type EngagementContactAttempt = typeof engagementContactAttempts.$inferSelect;
export type EngagementAction = typeof engagementActions.$inferSelect;
export type EngagementReferral = typeof engagementReferrals.$inferSelect;
