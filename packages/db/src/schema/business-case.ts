import { jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';

import { bitemporalColumns } from '../temporal.js';

import { tenants } from './tenant.js';

/**
 * Business case — bitemporal; shared structural primitive for any governed
 * process instance (BPR-D01–D19 case-shaped capabilities all root here).
 *
 * Not a universal table holding domain-specific JSON: domain aggregates
 * (cas_case, individual_rights_request, identity_resolution_case, ...) own
 * typed extension tables and reference businessCase.id for shared case
 * identity, subject, process and lifecycle status.
 *
 * See docs/architecture/business-process-target-data-model.md "Shared primitives".
 */
export const businessCases = pgTable('business_case', {
  ...bitemporalColumns,
  tenantId:    uuid('tenant_id').notNull().references(() => tenants.id),
  subjectType: text('subject_type').notNull(),   // person | enrolment | module_registration | ...
  subjectId:   uuid('subject_id').notNull(),
  processId:   text('process_id').notNull(),     // BP-nn-nnn reference, e.g. BP-08-003
  statusCode:  text('status_code').notNull(),    // open | under-review | decided | closed | withdrawn
  ownerId:     text('owner_id').notNull(),
  actorId:     text('actor_id').notNull(),
});

export type BusinessCase    = typeof businessCases.$inferSelect;
export type NewBusinessCase = typeof businessCases.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Case evidence reference — append-only; opaque pointer to evidence held in
 * its specialist store. SRS never stores the evidence content itself, only
 * enough to prove it was received and what classification governs its access.
 */
export const caseEvidenceReferences = pgTable('case_evidence_reference', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenantId:           uuid('tenant_id').notNull().references(() => tenants.id),
  businessCaseId:     uuid('business_case_id').notNull(), // FK to business_case.id (logical)
  evidenceRef:        text('evidence_ref').notNull(),     // opaque pointer into the specialist store
  classificationCode: text('classification_code').notNull(), // restricted-case | sensitive-academic | regulatory | personal | operational
  sourceSystem:       text('source_system').notNull(),
  sourceReference:    text('source_reference'),
  contentHash:        text('content_hash'),
  receivedAt:         timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  receivedBy:         text('received_by').notNull(),
});

export type CaseEvidenceReference    = typeof caseEvidenceReferences.$inferSelect;
export type NewCaseEvidenceReference = typeof caseEvidenceReferences.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Case decision — append-only; an authoritative outcome reached on a
 * business case, referencing the policy/rule version applied.
 */
export const caseDecisions = pgTable('case_decision', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         uuid('tenant_id').notNull().references(() => tenants.id),
  businessCaseId:   uuid('business_case_id').notNull(), // FK to business_case.id (logical)
  decisionTypeCode: text('decision_type_code').notNull(),
  authorityActorId: text('authority_actor_id').notNull(),
  policyVersion:    text('policy_version'),
  reasonCode:       text('reason_code'),
  reasonText:       text('reason_text'),
  effectiveAt:      timestamp('effective_at', { withTimezone: true }).notNull(),
  decidedAt:        timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CaseDecision    = typeof caseDecisions.$inferSelect;
export type NewCaseDecision = typeof caseDecisions.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Source version reference — append-only; the exact logical/version IDs a
 * decision or generated artefact relied on, so it can be reproduced later.
 */
export const sourceVersionReferences = pgTable('source_version_reference', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       uuid('tenant_id').notNull().references(() => tenants.id),
  caseDecisionId: uuid('case_decision_id'), // FK to case_decision.id, nullable (also used by non-case artefacts)
  entityType:     text('entity_type').notNull(),
  entityId:       uuid('entity_id').notNull(),
  versionId:      uuid('version_id').notNull(),
  purposeCode:    text('purpose_code').notNull(), // decision-basis | published-artefact | submission-source | ...
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SourceVersionReference    = typeof sourceVersionReferences.$inferSelect;
export type NewSourceVersionReference = typeof sourceVersionReferences.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Distribution item — durable mutable state; one target and authoritative
 * source version requiring application downstream. Replaces the simpler
 * flat status-per-target pattern (e.g. adjustment_distribution) for new
 * capabilities that need attempt/acknowledgement history.
 */
export const distributionItems = pgTable('distribution_item', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         uuid('tenant_id').notNull().references(() => tenants.id),
  sourceDecisionId: uuid('source_decision_id'), // FK to case_decision.id, nullable
  targetSystemCode: text('target_system_code').notNull(),
  contentRef:       text('content_ref').notNull(),
  statusCode:       text('status_code').notNull().default('pending'), // pending | sent | acknowledged | failed | superseded
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type DistributionItem    = typeof distributionItems.$inferSelect;
export type NewDistributionItem = typeof distributionItems.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Distribution attempt — append-only; one transport attempt for a
 * distribution item.
 */
export const distributionAttempts = pgTable('distribution_attempt', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenantId:           uuid('tenant_id').notNull().references(() => tenants.id),
  distributionItemId: uuid('distribution_item_id').notNull(), // FK to distribution_item.id
  attemptedAt:        timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
  transportCode:      text('transport_code').notNull(),
  payloadHash:        text('payload_hash'),
  responseCode:       text('response_code'),
  errorDetail:        text('error_detail'),
});

export type DistributionAttempt    = typeof distributionAttempts.$inferSelect;
export type NewDistributionAttempt = typeof distributionAttempts.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Distribution acknowledgement — append-only; a target's application or
 * rejection of a distribution item, or a snapshot-reconciliation result.
 */
export const distributionAcknowledgements = pgTable('distribution_acknowledgement', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenantId:           uuid('tenant_id').notNull().references(() => tenants.id),
  distributionItemId: uuid('distribution_item_id').notNull(), // FK to distribution_item.id
  acknowledgedAt:     timestamp('acknowledged_at', { withTimezone: true }).notNull().defaultNow(),
  resultCode:         text('result_code').notNull(), // applied | rejected | reconciled | mismatch
  reconciliationRef:  text('reconciliation_ref'),
  detail:             jsonb('detail'),
});

export type DistributionAcknowledgement    = typeof distributionAcknowledgements.$inferSelect;
export type NewDistributionAcknowledgement = typeof distributionAcknowledgements.$inferInsert;
