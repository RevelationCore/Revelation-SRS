import { numeric, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';

import { persons } from './identity.js';
import { tenants } from './tenant.js';

/**
 * Identity resolution & correction case (BPR-D17, Stage 7, migration 0004_business_process_foundations).
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
  propagatedAt:  timestamp('propagated_at', { withTimezone: true }),
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
