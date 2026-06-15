import { text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { w } from './wellbeing-case.js';

/**
 * Disability support case — bitemporal.
 *
 * Records the lifecycle of a disability support engagement: status, support
 * plan, and DSA award reference. History is preserved bitemporally so the
 * support team can reconstruct the state of a case at any point in time
 * (required for Equality Act compliance and retrospective audit).
 *
 * Physical PK: version_id. Logical ID: id (shared across versions).
 */
export const disabilitySupportCases = w.table('disability_support_case', {
  versionId:            uuid('version_id').primaryKey().defaultRandom(),
  id:                   uuid('id').notNull(),
  tenantId:             uuid('tenant_id').notNull(),
  wellbeingCaseId:      uuid('wellbeing_case_id').notNull(),
  personId:             uuid('person_id').notNull(),
  supportTypeCode:      text('support_type_code').notNull(), // dsa | institutional | interim
  statusCode:           text('status_code').notNull(),       // assessment_pending | evidence_pending | active | closed | rejected
  supportPlanStatusCode: text('support_plan_status_code').notNull().default('none'), // none | draft | active | expired
  dsaAwardRef:          text('dsa_award_ref'),
  actorId:              text('actor_id').notNull(),
  validFrom:            timestamp('valid_from',    { withTimezone: true }).notNull(),
  validTo:              timestamp('valid_to',      { withTimezone: true }),
  recordedAt:           timestamp('recorded_at',   { withTimezone: true }).notNull().defaultNow(),
  recordedUntil:        timestamp('recorded_until',{ withTimezone: true }),
});

export type DisabilitySupportCase    = typeof disabilitySupportCases.$inferSelect;
export type NewDisabilitySupportCase = typeof disabilitySupportCases.$inferInsert;

// ---------------------------------------------------------------------------

/**
 * DSA entitlement record — bitemporal.
 *
 * Records the specific support awarded under DSA: equipment, support workers,
 * non-medical helpers, etc. Entitlement scope and dates change as reassessments
 * occur; history is needed for Equality Act retrospective audit.
 */
export const dsaEntitlements = w.table('dsa_entitlement', {
  versionId:            uuid('version_id').primaryKey().defaultRandom(),
  id:                   uuid('id').notNull(),
  tenantId:             uuid('tenant_id').notNull(),
  disabilitySupportCaseId: uuid('disability_support_case_id').notNull(),
  personId:             uuid('person_id').notNull(),
  entitlementTypeCode:  text('entitlement_type_code').notNull(), // equipment | support-worker | non-medical-helper | specialist-mentoring | other
  providerRef:          text('provider_ref'),
  effectiveFrom:        timestamp('effective_from', { withTimezone: true }).notNull(),
  effectiveTo:          timestamp('effective_to',   { withTimezone: true }),
  approvedBy:           text('approved_by').notNull(),
  actorId:              text('actor_id').notNull(),
  validFrom:            timestamp('valid_from',    { withTimezone: true }).notNull(),
  validTo:              timestamp('valid_to',      { withTimezone: true }),
  recordedAt:           timestamp('recorded_at',   { withTimezone: true }).notNull().defaultNow(),
  recordedUntil:        timestamp('recorded_until',{ withTimezone: true }),
});

export type DsaEntitlement    = typeof dsaEntitlements.$inferSelect;
export type NewDsaEntitlement = typeof dsaEntitlements.$inferInsert;

// ---------------------------------------------------------------------------

/**
 * Evidence reference — standard mutable record.
 *
 * Stores metadata and EDRMS reference for a piece of supporting evidence.
 * Document binaries are stored in the EDRMS (or simulator); only the
 * reference, type, and status are stored here. Special-category content is
 * in the EDRMS; this table holds only administrative metadata.
 */
export const evidenceReferences = w.table('evidence_reference', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  tenantId:             uuid('tenant_id').notNull(),
  disabilitySupportCaseId: uuid('disability_support_case_id').notNull(),
  evidenceTypeCode:     text('evidence_type_code').notNull(), // medical | assessment | personal-statement | other
  edrmsDocumentRef:     text('edrms_document_ref'),
  edrmsDocumentUrl:     text('edrms_document_url'),
  statusCode:           text('status_code').notNull().default('pending'), // pending | received | verified | rejected
  receivedAt:           timestamp('received_at', { withTimezone: true }),
  uploadedBy:           text('uploaded_by').notNull(),
  createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type EvidenceReference    = typeof evidenceReferences.$inferSelect;
export type NewEvidenceReference = typeof evidenceReferences.$inferInsert;
