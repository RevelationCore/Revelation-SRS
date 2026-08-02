import { date, integer, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';

import { persons } from './identity.js';
import { tenants } from './tenant.js';

/**
 * Individual rights, retention & disposal (BPR-D18, Stage 8, migration
 * 0052). `individual_rights_request` extends the shared `business_case`
 * primitive via `businessCaseId`. FOI stays a separate model (`foi_request`
 * in regulatory.ts) — a DSAR/individual-rights request is broader (GDPR
 * Art. 15-21) than an FOI request, but either can reference the other via
 * `sourceCaseId` at the application layer.
 */

export const individualRightsRequests = pgTable('individual_rights_request', {
  id:                     uuid('id').primaryKey().defaultRandom(),
  tenantId:               uuid('tenant_id').notNull().references(() => tenants.id),
  businessCaseId:         uuid('business_case_id').notNull(), // FK -> business_case.id (logical)
  personId:               uuid('person_id').notNull().references(() => persons.id),
  requestTypeCode:        text('request_type_code').notNull(), // access | rectification | erasure | restriction | portability | objection
  receivedAt:             timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  statutoryDeadlineDate:  date('statutory_deadline_date').notNull(),
});

export type IndividualRightsRequest    = typeof individualRightsRequests.$inferSelect;
export type NewIndividualRightsRequest = typeof individualRightsRequests.$inferInsert;

export const rightsRequestScopes = pgTable('rights_request_scope', {
  id:                     uuid('id').primaryKey().defaultRandom(),
  tenantId:               uuid('tenant_id').notNull().references(() => tenants.id),
  individualRightsRequestId: uuid('individual_rights_request_id').notNull().references(() => individualRightsRequests.id),
  scopeEntityType:        text('scope_entity_type').notNull(),
  scopeDescription:       text('scope_description'),
});

export type RightsRequestScope    = typeof rightsRequestScopes.$inferSelect;
export type NewRightsRequestScope = typeof rightsRequestScopes.$inferInsert;

export const rightsSearchManifests = pgTable('rights_search_manifest', {
  id:                     uuid('id').primaryKey().defaultRandom(),
  tenantId:               uuid('tenant_id').notNull().references(() => tenants.id),
  individualRightsRequestId: uuid('individual_rights_request_id').notNull().references(() => individualRightsRequests.id),
  searchedSystem:         text('searched_system').notNull(),
  searchedAt:             timestamp('searched_at', { withTimezone: true }).notNull().defaultNow(),
  recordCount:            integer('record_count').notNull().default(0),
});

export type RightsSearchManifest    = typeof rightsSearchManifests.$inferSelect;
export type NewRightsSearchManifest = typeof rightsSearchManifests.$inferInsert;

export const rightsDecisions = pgTable('rights_decision', {
  id:                     uuid('id').primaryKey().defaultRandom(),
  tenantId:               uuid('tenant_id').notNull().references(() => tenants.id),
  individualRightsRequestId: uuid('individual_rights_request_id').notNull().references(() => individualRightsRequests.id),
  decisionTypeCode:       text('decision_type_code').notNull(), // granted | partially-granted | refused
  legalBasis:             text('legal_basis'),
  decidedBy:              text('decided_by').notNull(),
  decidedAt:              timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
});

export type RightsDecision    = typeof rightsDecisions.$inferSelect;
export type NewRightsDecision = typeof rightsDecisions.$inferInsert;

export const processingRestrictions = pgTable('processing_restriction', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenantId:          uuid('tenant_id').notNull().references(() => tenants.id),
  personId:          uuid('person_id').notNull().references(() => persons.id),
  rightsDecisionId:  uuid('rights_decision_id').references(() => rightsDecisions.id),
  restrictionTypeCode: text('restriction_type_code').notNull(), // no-marketing | no-automated-decision | processing-paused
  appliedBy:         text('applied_by').notNull(),
  appliedAt:         timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
  liftedAt:          timestamp('lifted_at', { withTimezone: true }),
});

export type ProcessingRestriction    = typeof processingRestrictions.$inferSelect;
export type NewProcessingRestriction = typeof processingRestrictions.$inferInsert;

export const retentionSchedules = pgTable('retention_schedule', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  tenantId:              uuid('tenant_id').notNull().references(() => tenants.id),
  entityType:            text('entity_type').notNull(),
  retentionPeriodMonths: text('retention_period_months').notNull(), // text to allow 'permanent'
  triggerEventCode:      text('trigger_event_code').notNull(), // end-of-study | award-conferred | request-closed
  description:           text('description'),
});

export type RetentionSchedule    = typeof retentionSchedules.$inferSelect;
export type NewRetentionSchedule = typeof retentionSchedules.$inferInsert;

export const retentionAssignments = pgTable('retention_assignment', {
  id:                     uuid('id').primaryKey().defaultRandom(),
  tenantId:               uuid('tenant_id').notNull().references(() => tenants.id),
  retentionScheduleId:    uuid('retention_schedule_id').notNull().references(() => retentionSchedules.id),
  entityType:             text('entity_type').notNull(),
  entityId:               uuid('entity_id').notNull(),
  assignedAt:             timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  scheduledDisposalDate:  date('scheduled_disposal_date'),
});

export type RetentionAssignment    = typeof retentionAssignments.$inferSelect;
export type NewRetentionAssignment = typeof retentionAssignments.$inferInsert;

export const recordHolds = pgTable('record_hold', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  tenantId:              uuid('tenant_id').notNull().references(() => tenants.id),
  retentionAssignmentId: uuid('retention_assignment_id').notNull().references(() => retentionAssignments.id),
  holdReasonCode:        text('hold_reason_code').notNull(), // litigation | foi-request | dsar-in-progress | audit
  appliedBy:             text('applied_by').notNull(),
  appliedAt:             timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
  liftedAt:              timestamp('lifted_at', { withTimezone: true }),
});

export type RecordHold    = typeof recordHolds.$inferSelect;
export type NewRecordHold = typeof recordHolds.$inferInsert;

export const recordDispositions = pgTable('record_disposition', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  tenantId:              uuid('tenant_id').notNull().references(() => tenants.id),
  retentionAssignmentId: uuid('retention_assignment_id').notNull().references(() => retentionAssignments.id),
  dispositionTypeCode:   text('disposition_type_code').notNull(), // anonymised | deleted | transferred
  executedAt:            timestamp('executed_at', { withTimezone: true }).notNull().defaultNow(),
  executedBy:            text('executed_by').notNull(),
  evidenceRef:           text('evidence_ref'),
});

export type RecordDisposition    = typeof recordDispositions.$inferSelect;
export type NewRecordDisposition = typeof recordDispositions.$inferInsert;
