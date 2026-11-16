import { boolean, date, jsonb, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenant.js';

/** Every application payload as received; append-only (BPR-D01; BP-01-001). */
export const applicationReceivedPayloads = pgTable('application_received_payload', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        uuid('tenant_id').notNull().references(() => tenants.id),
  channelCode:     text('channel_code').notNull(),
  sourceReference: text('source_reference').notNull(),
  cycle:           text('cycle').notNull(),
  payload:         jsonb('payload').notNull().$type<Record<string, unknown>>(),
  payloadHash:     text('payload_hash').notNull(),
  receivedBy:      text('received_by').notNull(),
  receivedAt:      timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});
export type ApplicationReceivedPayload = typeof applicationReceivedPayloads.$inferSelect;

/** The channel-neutral working application. */
export const studentApplications = pgTable('student_application', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  tenantId:             uuid('tenant_id').notNull().references(() => tenants.id),
  channelCode:          text('channel_code').notNull(),
  sourceReference:      text('source_reference').notNull(),
  cycle:                text('cycle').notNull(),
  personId:             uuid('person_id'),
  identityMatchCode:    text('identity_match_code').notNull(), // matched | created | needs-review
  programmeId:          uuid('programme_id').notNull(),
  intakeCode:           text('intake_code').notNull(),
  modeOfStudyCode:      text('mode_of_study_code').notNull(),
  latestPayloadId:      uuid('latest_payload_id').notNull().references(() => applicationReceivedPayloads.id),
  ucasApplicationId:    uuid('ucas_application_id'),
  statusCode:           text('status_code').notNull().default('received'),
  routingReasonCode:    text('routing_reason_code'),
  recommendationCode:   text('recommendation_code'),
  recommendationReason: text('recommendation_reason'),
  recommendedBy:        text('recommended_by'),
  recommendedAt:        timestamp('recommended_at', { withTimezone: true }),
  createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export type StudentApplication = typeof studentApplications.$inferSelect;

/** Each assessment outcome with its assessor and evidence version; append-only (BP-01-002). */
export const applicationAssessments = pgTable('application_assessment', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenantId:           uuid('tenant_id').notNull().references(() => tenants.id),
  applicationId:      uuid('application_id').notNull().references(() => studentApplications.id),
  assessmentTypeCode: text('assessment_type_code').notNull(),
  outcomeCode:        text('outcome_code').notNull(),
  evidenceRef:        text('evidence_ref'),
  evidenceVersion:    text('evidence_version'),
  note:               text('note'),
  assessedBy:         text('assessed_by').notNull(),
  assessedAt:         timestamp('assessed_at', { withTimezone: true }).notNull().defaultNow(),
});
export type ApplicationAssessment = typeof applicationAssessments.$inferSelect;

/** The authorised offer; a change is a new version (BPR-D02; BP-01-003). */
export const admissionsOffers = pgTable('admissions_offer', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenantId:           uuid('tenant_id').notNull().references(() => tenants.id),
  applicationId:      uuid('application_id').notNull().references(() => studentApplications.id),
  version:            smallint('version').notNull(),
  previousOfferId:    uuid('previous_offer_id'),
  programmeId:        uuid('programme_id').notNull(),
  intakeCode:         text('intake_code').notNull(),
  modeOfStudyCode:    text('mode_of_study_code').notNull(),
  feeStatusBasisCode: text('fee_status_basis_code'),
  offerTypeCode:      text('offer_type_code').notNull(), // conditional | unconditional
  statusCode:         text('status_code').notNull().default('made'),
  expiresOn:          date('expires_on'),
  decidedBy:          text('decided_by').notNull(),
  decidedAt:          timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  changeReason:       text('change_reason'),
  responseCode:       text('response_code'),
  responseSourceAt:   timestamp('response_source_at', { withTimezone: true }),
  respondedAt:        timestamp('responded_at', { withTimezone: true }),
});
export type AdmissionsOffer = typeof admissionsOffers.$inferSelect;

export const offerConditions = pgTable('offer_condition', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenantId:          uuid('tenant_id').notNull().references(() => tenants.id),
  offerId:           uuid('offer_id').notNull().references(() => admissionsOffers.id),
  conditionTypeCode: text('condition_type_code').notNull(),
  description:       text('description').notNull(),
  requiredValue:     text('required_value'),
  statusCode:        text('status_code').notNull().default('pending'), // pending | met | waived | unmet
  decidedBy:         text('decided_by'),
  decidedAt:         timestamp('decided_at', { withTimezone: true }),
  decisionNote:      text('decision_note'),
});
export type OfferCondition = typeof offerConditions.$inferSelect;

export const conditionEvidence = pgTable('condition_evidence', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       uuid('tenant_id').notNull().references(() => tenants.id),
  conditionId:    uuid('condition_id').notNull().references(() => offerConditions.id),
  provenanceCode: text('provenance_code').notNull(),
  evidenceRef:    text('evidence_ref').notNull(),
  reportedValue:  text('reported_value'),
  verified:       boolean('verified').notNull().default(false),
  receivedBy:     text('received_by').notNull(),
  receivedAt:     timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});
export type ConditionEvidence = typeof conditionEvidence.$inferSelect;

/** The overall confirmation decision, with the frozen conditions it tested; append-only (BP-01-004). */
export const offerConfirmationDecisions = pgTable('offer_confirmation_decision', {
  id:                        uuid('id').primaryKey().defaultRandom(),
  tenantId:                  uuid('tenant_id').notNull().references(() => tenants.id),
  offerId:                   uuid('offer_id').notNull().references(() => admissionsOffers.id),
  decisionCode:              text('decision_code').notNull(), // confirmed | confirmed-alternative | unsuccessful
  alternativeProgrammeId:    uuid('alternative_programme_id'),
  conditionSnapshot:         jsonb('condition_snapshot').notNull().$type<unknown[]>(),
  reason:                    text('reason'),
  handoffWorkflowInstanceId: uuid('handoff_workflow_instance_id'),
  decidedBy:                 text('decided_by').notNull(),
  decidedAt:                 timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
});
export type OfferConfirmationDecision = typeof offerConfirmationDecisions.$inferSelect;
