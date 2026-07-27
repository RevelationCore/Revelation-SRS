import { boolean, integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';

import { bitemporalColumns } from '../temporal.js';

import { tenants } from './tenant.js';

export const engagementPolicyVersions = pgTable('engagement_policy_version', {
  ...bitemporalColumns,
  tenantId:              uuid('tenant_id').notNull().references(() => tenants.id),
  policyCode:            text('policy_code').notNull(),
  versionNumber:         integer('version_number').notNull(),
  displayName:           text('display_name').notNull(),
  statusCode:            text('status_code').notNull().default('draft'),
  applicability:         jsonb('applicability').notNull().$type<Record<string, unknown>>().default({}),
  evidenceWindow:        jsonb('evidence_window').notNull().$type<Record<string, unknown>>().default({}),
  alertRules:            jsonb('alert_rules').notNull().$type<Record<string, unknown>>().default({}),
  reviewDeadline:        jsonb('review_deadline').notNull().$type<Record<string, unknown>>().default({}),
  approvedBy:            text('approved_by'),
  approvedAt:            timestamp('approved_at', { withTimezone: true }),
  actorId:               text('actor_id').notNull(),
});

export const expectedEngagementEvents = pgTable('expected_engagement_event', {
  ...bitemporalColumns,
  tenantId:              uuid('tenant_id').notNull().references(() => tenants.id),
  personId:              uuid('person_id').notNull(),
  enrolmentId:           uuid('enrolment_id').notNull(),
  activityTypeCode:      text('activity_type_code').notNull(),
  activityReference:     text('activity_reference'),
  eventModeCode:         text('event_mode_code').notNull(),
  scheduledFrom:         timestamp('scheduled_from', { withTimezone: true }).notNull(),
  scheduledTo:           timestamp('scheduled_to', { withTimezone: true }),
  locationReference:     text('location_reference'),
  sourceSystemCode:      text('source_system_code').notNull(),
  sourceEventId:         text('source_event_id').notNull(),
  sourceVersion:         text('source_version').notNull(),
  statusCode:            text('status_code').notNull().default('expected'),
  actorId:               text('actor_id').notNull().default('system'),
});

export const engagementObservations = pgTable('engagement_observation', {
  ...bitemporalColumns,
  tenantId:              uuid('tenant_id').notNull().references(() => tenants.id),
  expectedEventId:       uuid('expected_event_id'),
  personId:              uuid('person_id').notNull(),
  enrolmentId:           uuid('enrolment_id').notNull(),
  sourceSystemCode:      text('source_system_code').notNull(),
  sourceEventId:         text('source_event_id').notNull(),
  sourceVersion:         text('source_version').notNull(),
  idempotencyKey:        text('idempotency_key').notNull(),
  captureMethodCode:     text('capture_method_code').notNull(),
  outcomeCode:           text('outcome_code').notNull(),
  dataQualityCode:       text('data_quality_code').notNull().default('valid'),
  eventTime:             timestamp('event_time', { withTimezone: true }).notNull(),
  receivedAt:            timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  deviceReference:       text('device_reference'),
  operationalReference: text('operational_reference'),
  actorId:               text('actor_id').notNull(),
});

export const engagementObservationRevisions = pgTable('engagement_observation_revision', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  tenantId:              uuid('tenant_id').notNull().references(() => tenants.id),
  observationId:         uuid('observation_id').notNull(),
  supersededVersionId:   uuid('superseded_version_id').notNull(),
  replacementVersionId:  uuid('replacement_version_id').notNull(),
  correctionReasonCode:  text('correction_reason_code').notNull(),
  correctionReason:      text('correction_reason'),
  disputed:              boolean('disputed').notNull().default(false),
  authorisedBy:          text('authorised_by').notNull(),
  recordedAt:            timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  correlationId:         uuid('correlation_id'),
});

export const engagementAlerts = pgTable('engagement_alert', {
  ...bitemporalColumns,
  tenantId:              uuid('tenant_id').notNull().references(() => tenants.id),
  personId:              uuid('person_id').notNull(),
  enrolmentId:           uuid('enrolment_id').notNull(),
  policyVersionId:       uuid('policy_version_id').notNull(),
  evidenceWindowFrom:    timestamp('evidence_window_from', { withTimezone: true }).notNull(),
  evidenceWindowTo:      timestamp('evidence_window_to', { withTimezone: true }).notNull(),
  evidenceSnapshot:      jsonb('evidence_snapshot').notNull().$type<Record<string, unknown>>().default({}),
  evidenceHash:          text('evidence_hash').notNull(),
  explanation:           jsonb('explanation').notNull().$type<Record<string, unknown>>().default({}),
  severityCode:          text('severity_code').notNull(),
  statusCode:            text('status_code').notNull().default('open'),
  reevaluationRequired:  boolean('reevaluation_required').notNull().default(false),
  actorId:               text('actor_id').notNull().default('system'),
});

export const engagementInterventionCases = pgTable('engagement_intervention_case', {
  ...bitemporalColumns,
  tenantId:              uuid('tenant_id').notNull().references(() => tenants.id),
  alertId:               uuid('alert_id').notNull(),
  personId:              uuid('person_id').notNull(),
  enrolmentId:           uuid('enrolment_id').notNull(),
  statusCode:            text('status_code').notNull().default('open'),
  outcomeCode:           text('outcome_code'),
  assignedRoleCode:      text('assigned_role_code'),
  assignedActorId:       text('assigned_actor_id'),
  workflowInstanceId:    uuid('workflow_instance_id'),
  correlationId:         uuid('correlation_id').notNull(),
  openedAt:              timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  reviewAt:              timestamp('review_at', { withTimezone: true }),
  dueAt:                 timestamp('due_at', { withTimezone: true }),
  closedAt:              timestamp('closed_at', { withTimezone: true }),
  actorId:               text('actor_id').notNull(),
  idempotencyKey:        text('idempotency_key'),
});

export const engagementContactAttempts = pgTable('engagement_contact_attempt', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  tenantId:              uuid('tenant_id').notNull().references(() => tenants.id),
  interventionCaseId:    uuid('intervention_case_id').notNull(),
  channelCode:           text('channel_code').notNull(),
  attemptedAt:           timestamp('attempted_at', { withTimezone: true }).notNull(),
  outcomeCode:           text('outcome_code').notNull(),
  communicationLocale:   text('communication_locale'),
  operationalNote:       text('operational_note'),
  dataClassification:    text('data_classification').notNull().default('sensitive-personal'),
  actorId:               text('actor_id').notNull(),
  idempotencyKey:        text('idempotency_key').notNull(),
  createdAt:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const engagementActions = pgTable('engagement_action', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  tenantId:              uuid('tenant_id').notNull().references(() => tenants.id),
  interventionCaseId:    uuid('intervention_case_id').notNull(),
  actionTypeCode:        text('action_type_code').notNull(),
  operationalInstruction: text('operational_instruction'),
  ownerRoleCode:         text('owner_role_code'),
  ownerActorId:          text('owner_actor_id'),
  dueAt:                 timestamp('due_at', { withTimezone: true }),
  completedAt:           timestamp('completed_at', { withTimezone: true }),
  completedBy:           text('completed_by'),
  createdBy:             text('created_by').notNull(),
  idempotencyKey:        text('idempotency_key').notNull(),
  createdAt:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const engagementReferrals = pgTable('engagement_referral', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  tenantId:              uuid('tenant_id').notNull().references(() => tenants.id),
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

export type EngagementPolicyVersion = typeof engagementPolicyVersions.$inferSelect;
export type ExpectedEngagementEvent = typeof expectedEngagementEvents.$inferSelect;
export type EngagementObservation = typeof engagementObservations.$inferSelect;
export type EngagementObservationRevision = typeof engagementObservationRevisions.$inferSelect;
export type EngagementAlert = typeof engagementAlerts.$inferSelect;
export type EngagementInterventionCase = typeof engagementInterventionCases.$inferSelect;
export type EngagementContactAttempt = typeof engagementContactAttempts.$inferSelect;
export type EngagementAction = typeof engagementActions.$inferSelect;
export type EngagementReferral = typeof engagementReferrals.$inferSelect;
