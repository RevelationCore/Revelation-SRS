import { boolean, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { w } from './wellbeing-case.js';

/**
 * Adjustment case — bitemporal. Tracks the full W002 workflow lifecycle.
 *
 * Represents a single request for a reasonable adjustment: scope, status,
 * DSA entitlement link, and the recommended adjustment. Bitemporal so
 * that retrospective audit can reconstruct what the adjustment was at the
 * point it was applied to an assessment (Equality Act requirement).
 *
 * Writes to SRS are only via F-WELL-SIS-01 (disability adjustments) and F-WELL-SIS-02
 * (assessment venue), never directly to SRS tables.
 */
export const adjustmentCases = w.table('adjustment_case', {
  versionId:             uuid('version_id').primaryKey().defaultRandom(),
  id:                    uuid('id').notNull(),
  tenantId:              uuid('tenant_id').notNull(),
  wellbeingCaseId:       uuid('wellbeing_case_id').notNull(),
  disabilitySupportCaseId: uuid('disability_support_case_id').notNull(),
  personId:              uuid('person_id').notNull(),
  adjustmentTypeCode:    text('adjustment_type_code').notNull(), // exam-time | venue | coursework | placement | other
  statusCode:            text('status_code').notNull(),          // referral_received | assessment_pending | under_assessment | determination_made | approved | rejected | under_review | review_complete | closed
  recommendedAdjustment: text('recommended_adjustment'),
  rationale:             text('rationale'),
  dsaEntitlementId:      uuid('dsa_entitlement_id'),
  srsApplicationRef:     text('srs_application_ref'),           // ref returned by F-WELL-SIS-01/F-WELL-SIS-02 after approval
  actorId:               text('actor_id').notNull(),
  validFrom:             timestamp('valid_from',    { withTimezone: true }).notNull(),
  validTo:               timestamp('valid_to',      { withTimezone: true }),
  recordedAt:            timestamp('recorded_at',   { withTimezone: true }).notNull().defaultNow(),
  recordedUntil:         timestamp('recorded_until',{ withTimezone: true }),
});

export type AdjustmentCase    = typeof adjustmentCases.$inferSelect;
export type NewAdjustmentCase = typeof adjustmentCases.$inferInsert;

// ---------------------------------------------------------------------------

/**
 * Adjustment assessment — standard mutable record.
 *
 * Records a needs assessment event within an adjustment case: assessor, date,
 * outcome, and supporting notes. Multiple assessments can exist for a case
 * (e.g., on review). Not bitemporal: outcomes are appended, not corrected.
 */
export const adjustmentAssessments = w.table('adjustment_assessment', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  tenantId:              uuid('tenant_id').notNull(),
  adjustmentCaseId:      uuid('adjustment_case_id').notNull(),
  assessorId:            text('assessor_id').notNull(),
  assessedAt:            timestamp('assessed_at', { withTimezone: true }).notNull(),
  outcomeCode:           text('outcome_code'),                   // recommended | not-recommended | deferred | referred-to-panel
  findings:              text('findings'),
  recommendedAction:     text('recommended_action'),
  createdAt:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AdjustmentAssessment    = typeof adjustmentAssessments.$inferSelect;
export type NewAdjustmentAssessment = typeof adjustmentAssessments.$inferInsert;

// ---------------------------------------------------------------------------

/**
 * Adjustment panel decision — standard mutable record.
 *
 * Records the outcome of a formal review panel for an adjustment case.
 * One-per-panel-meeting; distinct from advisor assessments.
 */
export const adjustmentPanelDecisions = w.table('adjustment_panel_decision', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  tenantId:              uuid('tenant_id').notNull(),
  adjustmentCaseId:      uuid('adjustment_case_id').notNull(),
  panelChairId:          text('panel_chair_id').notNull(),
  panelDate:             timestamp('panel_date', { withTimezone: true }).notNull(),
  decisionCode:          text('decision_code').notNull(),        // upheld | modified | rejected
  decisionRationale:     text('decision_rationale'),
  distributedToSrs:      boolean('distributed_to_srs').notNull().default(false),
  distributedAt:         timestamp('distributed_at', { withTimezone: true }),
  createdAt:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AdjustmentPanelDecision    = typeof adjustmentPanelDecisions.$inferSelect;
export type NewAdjustmentPanelDecision = typeof adjustmentPanelDecisions.$inferInsert;

// ---------------------------------------------------------------------------

/**
 * Evidence attached to an adjustment case (DSA medical letters, specialist
 * assessor reports, etc.). The binary content lives in the `documents`
 * schema (see @revelation-srs/documents, installed alongside this module's
 * own tables — schema/index.ts re-exports it into this database) — this
 * row is the case-scoped pointer plus the evidence's business meaning.
 * `documentId` is not a foreign key to `documents.document` because that
 * table is owned by a separate package's schema module, not this one;
 * same "opaque cross-boundary reference" convention used for
 * `srsApplicationRef` above.
 */
export const adjustmentCaseEvidence = w.table('adjustment_case_evidence', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenantId:          uuid('tenant_id').notNull(),
  adjustmentCaseId:  uuid('adjustment_case_id').notNull(),
  documentId:        uuid('document_id').notNull(),
  evidenceTypeCode:  text('evidence_type_code').notNull(), // medical-letter | assessor-report | dsa-award-letter | other
  uploadedBy:        text('uploaded_by').notNull(),
  uploadedAt:        timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:         timestamp('deleted_at', { withTimezone: true }),
});

export type AdjustmentCaseEvidence    = typeof adjustmentCaseEvidence.$inferSelect;
export type NewAdjustmentCaseEvidence = typeof adjustmentCaseEvidence.$inferInsert;
