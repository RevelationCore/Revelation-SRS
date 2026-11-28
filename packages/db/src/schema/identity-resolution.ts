import { boolean, integer, jsonb, numeric, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';

import { persons } from './identity.js';
import { tenants } from './tenant.js';

/**
 * Identity resolution & correction case (BPR-D17, Stage 7, migration 0000_baseline (section 0004_business_process_foundations)).
 *
 * These aggregates extend the shared `business_case` primitive
 * (packages/db/src/schema/business-case.ts) via `businessCaseId` rather than
 * re-implementing case status/ownership. Candidate generation only —
 * per the migration plan, a merge decision is never auto-created from a
 * match score; it always requires an explicit actor action.
 */

export const identityResolutionCases = pgTable('identity_resolution_case', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       uuid('tenant_id').notNull().references(() => tenants.id),
  businessCaseId: uuid('business_case_id').notNull(), // FK -> business_case.id (logical)
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type IdentityResolutionCase    = typeof identityResolutionCases.$inferSelect;
export type NewIdentityResolutionCase = typeof identityResolutionCases.$inferInsert;

export const identityResolutionCandidates = pgTable('identity_resolution_candidate', {
  id:                      uuid('id').primaryKey().defaultRandom(),
  tenantId:                uuid('tenant_id').notNull().references(() => tenants.id),
  identityResolutionCaseId: uuid('identity_resolution_case_id').notNull().references(() => identityResolutionCases.id),
  candidatePersonId:       uuid('candidate_person_id').notNull().references(() => persons.id),
  matchScore:              numeric('match_score', { precision: 5, scale: 4 }).notNull(),
  matchReasonCode:         text('match_reason_code').notNull(), // name-dob | email | student-number | manual-flag
  addedBy:                 text('added_by'), // ADR-031: who added it may not decide the case
  createdAt:               timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type IdentityResolutionCandidate    = typeof identityResolutionCandidates.$inferSelect;
export type NewIdentityResolutionCandidate = typeof identityResolutionCandidates.$inferInsert;

export const identityResolutionDecisions = pgTable('identity_resolution_decision', {
  id:                      uuid('id').primaryKey().defaultRandom(),
  tenantId:                uuid('tenant_id').notNull().references(() => tenants.id),
  identityResolutionCaseId: uuid('identity_resolution_case_id').notNull().references(() => identityResolutionCases.id),
  decisionTypeCode:        text('decision_type_code').notNull(), // merge | reject | link
  survivorPersonId:        uuid('survivor_person_id').references(() => persons.id),
  decidedBy:               text('decided_by').notNull(),
  decidedAt:               timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  proposalId:              uuid('proposal_id'),
  reason:                  text('reason'),
});

/** ADR-031: a versioned merge proposal; a decision must name its current version. */
export const identityMergeProposals = pgTable('identity_merge_proposal', {
  id:                       uuid('id').primaryKey().defaultRandom(),
  tenantId:                 uuid('tenant_id').notNull().references(() => tenants.id),
  identityResolutionCaseId: uuid('identity_resolution_case_id').notNull().references(() => identityResolutionCases.id),
  version:                  integer('version').notNull(),
  survivorPersonId:         uuid('survivor_person_id').notNull().references(() => persons.id),
  mergedPersonId:           uuid('merged_person_id').notNull().references(() => persons.id),
  factChoices:              jsonb('fact_choices').notNull().$type<Record<string, 'survivor' | 'merged'>>().default({}),
  identifierResolutions:    jsonb('identifier_resolutions').notNull().$type<Record<string, { keep: 'survivor' | 'merged'; reason: string }>>().default({}),
  twoAccountsConfirmed:     boolean('two_accounts_confirmed').notNull().default(false),
  proposedBy:               text('proposed_by').notNull(),
  proposedAt:               timestamp('proposed_at', { withTimezone: true }).notNull().defaultNow(),
});

export type IdentityMergeProposal = typeof identityMergeProposals.$inferSelect;

/** ADR-031: a statutory identifier value not kept by a merge still finds the survivor. */
export const personIdentifierAliases = pgTable('person_identifier_alias', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        uuid('tenant_id').notNull().references(() => tenants.id),
  personId:        uuid('person_id').notNull().references(() => persons.id),
  identifierClass: text('identifier_class').notNull(),
  value:           text('value').notNull(),
  sourcePersonId:  uuid('source_person_id').notNull().references(() => persons.id),
  decisionId:      uuid('decision_id').notNull().references(() => identityResolutionDecisions.id),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type IdentityResolutionDecision    = typeof identityResolutionDecisions.$inferSelect;
export type NewIdentityResolutionDecision = typeof identityResolutionDecisions.$inferInsert;

export const personIdentityLinks = pgTable('person_identity_link', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       uuid('tenant_id').notNull().references(() => tenants.id),
  sourcePersonId: uuid('source_person_id').notNull().references(() => persons.id),
  targetPersonId: uuid('target_person_id').notNull().references(() => persons.id),
  linkTypeCode:   text('link_type_code').notNull(), // merged-into | duplicate-of | related-record
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PersonIdentityLink    = typeof personIdentityLinks.$inferSelect;
export type NewPersonIdentityLink = typeof personIdentityLinks.$inferInsert;

export const identityRedirects = pgTable('identity_redirect', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      uuid('tenant_id').notNull().references(() => tenants.id),
  oldPersonId:   uuid('old_person_id').notNull().references(() => persons.id),
  newPersonId:   uuid('new_person_id').notNull().references(() => persons.id),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
  /** Core moves done and the event queued, in the decision's transaction (ADR-031 item 5). */
  propagatedAt:  timestamp('propagated_at', { withTimezone: true }),
  mergeId:       uuid('merge_id'),
  endedAt:       timestamp('ended_at', { withTimezone: true }),
  endedByMergeId: uuid('ended_by_merge_id'),
});

/** An executed merge (ADR-031 item 5, migration 0013); unmerge sets unmergedAt (BL-359). */
export const identityMerges = pgTable('identity_merge', {
  id:                       uuid('id').primaryKey().defaultRandom(),
  tenantId:                 uuid('tenant_id').notNull().references(() => tenants.id),
  identityResolutionCaseId: uuid('identity_resolution_case_id').notNull(),
  decisionId:               uuid('decision_id').notNull(),
  proposalVersion:          integer('proposal_version').notNull(),
  survivorPersonId:         uuid('survivor_person_id').notNull(),
  mergedPersonId:           uuid('merged_person_id').notNull(),
  effectiveAt:              timestamp('effective_at', { withTimezone: true }).notNull(),
  decidedBy:                text('decided_by').notNull(),
  unmergedAt:               timestamp('unmerged_at', { withTimezone: true }),
  unmergeDecisionId:        uuid('unmerge_decision_id'),
  /** The merged person's status before the merge, restored by an unmerge (0014). */
  mergedPersonStatusCode:   text('merged_person_status_code'),
});

/** An unmerge case (ADR-031 item 10, migration 0014): prepared by one officer, decided by another. */
export const identityUnmergeCases = pgTable('identity_unmerge_case', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        uuid('tenant_id').notNull().references(() => tenants.id),
  mergeId:         uuid('merge_id').notNull(),
  businessCaseId:  uuid('business_case_id').notNull(),
  statusCode:      text('status_code').notNull().default('open'), // open | proposed | unmerged | rejected
  openedBy:        text('opened_by').notNull(),
  openedAt:        timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  proposalVersion: integer('proposal_version').notNull().default(0),
  allocations:     jsonb('allocations').notNull().$type<Record<string, 'survivor' | 'restored'>>().default({}),
  proposedBy:      text('proposed_by'),
  proposedAt:      timestamp('proposed_at', { withTimezone: true }),
  decidedBy:       text('decided_by'),
  decidedAt:       timestamp('decided_at', { withTimezone: true }),
  decisionReason:  text('decision_reason'),
});
export type IdentityUnmergeCase = typeof identityUnmergeCases.$inferSelect;

export type IdentityMerge = typeof identityMerges.$inferSelect;

/** One row moved by a merge, so unmerge can reverse exactly what it did. */
export const identityMergeMoves = pgTable('identity_merge_move', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        uuid('tenant_id').notNull().references(() => tenants.id),
  mergeId:         uuid('merge_id').notNull(),
  tableName:       text('table_name').notNull(),
  columnName:      text('column_name').notNull(),
  rowKey:          text('row_key').notNull(),
  mode:            text('mode').notNull(),
  fromPersonId:    uuid('from_person_id').notNull(),
  toPersonId:      uuid('to_person_id').notNull(),
  closedVersionId: uuid('closed_version_id'),
  newVersionId:    uuid('new_version_id'),
});

export type IdentityRedirect    = typeof identityRedirects.$inferSelect;
export type NewIdentityRedirect = typeof identityRedirects.$inferInsert;

export const dataCorrectionCases = pgTable('data_correction_case', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  tenantId:             uuid('tenant_id').notNull().references(() => tenants.id),
  businessCaseId:       uuid('business_case_id').notNull(), // FK -> business_case.id (logical)
  personId:             uuid('person_id').notNull().references(() => persons.id),
  correctedEntityType:  text('corrected_entity_type').notNull(),
  correctedFieldName:   text('corrected_field_name').notNull(),
  createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type DataCorrectionCase    = typeof dataCorrectionCases.$inferSelect;
export type NewDataCorrectionCase = typeof dataCorrectionCases.$inferInsert;
