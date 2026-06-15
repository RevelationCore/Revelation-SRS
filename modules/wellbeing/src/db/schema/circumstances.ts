import { jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { w } from './wellbeing-case.js';

/**
 * EC claim — bitemporal. Tracks the W003 workflow lifecycle.
 *
 * Represents a single extenuating circumstances claim. Bitemporal so that
 * the full claim history can be reconstructed for appeals and regulatory
 * reporting (OfS condition B3 accountability).
 */
export const ecClaims = w.table('ec_claim', {
  versionId:             uuid('version_id').primaryKey().defaultRandom(),
  id:                    uuid('id').notNull(),
  tenantId:              uuid('tenant_id').notNull(),
  wellbeingCaseId:       uuid('wellbeing_case_id').notNull(),
  personId:              uuid('person_id').notNull(),
  enrolmentId:           uuid('enrolment_id').notNull(),
  assessmentPeriodRef:   text('assessment_period_ref').notNull(),
  affectedModuleCodes:   jsonb('affected_module_codes').notNull().default([]),
  statusCode:            text('status_code').notNull(),          // submitted | evidence_pending | under_review | upheld | not_upheld | closed
  circumstancesNarrative: text('circumstances_narrative'),
  submittedAt:           timestamp('submitted_at', { withTimezone: true }).notNull(),
  evidenceDeadline:      timestamp('evidence_deadline', { withTimezone: true }),
  actorId:               text('actor_id').notNull(),
  validFrom:             timestamp('valid_from',    { withTimezone: true }).notNull(),
  validTo:               timestamp('valid_to',      { withTimezone: true }),
  recordedAt:            timestamp('recorded_at',   { withTimezone: true }).notNull().defaultNow(),
  recordedUntil:         timestamp('recorded_until',{ withTimezone: true }),
});

export type EcClaim    = typeof ecClaims.$inferSelect;
export type NewEcClaim = typeof ecClaims.$inferInsert;

// ---------------------------------------------------------------------------

/**
 * EC evidence review — standard mutable record.
 *
 * Records the review of evidence submitted with an EC claim. One record per
 * review event; multiple may exist where evidence is submitted in stages.
 */
export const ecEvidenceReviews = w.table('ec_evidence_review', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  tenantId:              uuid('tenant_id').notNull(),
  ecClaimId:             uuid('ec_claim_id').notNull(),
  reviewerId:            text('reviewer_id').notNull(),
  reviewedAt:            timestamp('reviewed_at', { withTimezone: true }).notNull(),
  evidenceStatusCode:    text('evidence_status_code').notNull(), // sufficient | insufficient | not-required
  reviewNotes:           text('review_notes'),
  createdAt:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type EcEvidenceReview    = typeof ecEvidenceReviews.$inferSelect;
export type NewEcEvidenceReview = typeof ecEvidenceReviews.$inferInsert;

// ---------------------------------------------------------------------------

/**
 * EC determination — standard mutable record.
 *
 * Records the final determination on an EC claim: outcome, authorising
 * officer, and the set of module-level outcomes applied. One per claim per
 * determination event (i.e., one initial + one per appeal round).
 */
export const ecDeterminations = w.table('ec_determination', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  tenantId:              uuid('tenant_id').notNull(),
  ecClaimId:             uuid('ec_claim_id').notNull(),
  authorisedById:        text('authorised_by_id').notNull(),
  determinationCode:     text('determination_code').notNull(),   // upheld | not_upheld | partially_upheld
  determinationRationale: text('determination_rationale'),
  moduleOutcomes:        jsonb('module_outcomes').notNull().default([]),
  determinedAt:          timestamp('determined_at', { withTimezone: true }).notNull(),
  createdAt:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type EcDetermination    = typeof ecDeterminations.$inferSelect;
export type NewEcDetermination = typeof ecDeterminations.$inferInsert;
