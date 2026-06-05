import { boolean, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';

import { bitemporalColumns } from '../temporal.js';

import { tenants } from './tenant.js';

/**
 * Progression decision — bitemporal; the year-end outcome for an enrolment.
 *
 * Produced by ProgressionService.evaluateProgression using the rules engine.
 * Locked after board ratification; mutations require an upheld post-ratification case.
 */
export const progressionDecisions = pgTable('progression_decision', {
  ...bitemporalColumns,
  tenantId:      uuid('tenant_id').notNull().references(() => tenants.id),
  enrolmentId:   uuid('enrolment_id').notNull(),
  academicYear:  text('academic_year').notNull(),   // e.g. '2025-26'
  yearOfStudy:   text('year_of_study').notNull(),   // e.g. '1' | '2' | '3'
  decisionCode:  text('decision_code').notNull(),   // progress | resit | repeat-year | withdraw
  examBoardId:   uuid('exam_board_id'),             // set after ratification
  locked:        boolean('locked').notNull().default(false),
  actorId:       text('actor_id').notNull(),
});

export type ProgressionDecision    = typeof progressionDecisions.$inferSelect;
export type NewProgressionDecision = typeof progressionDecisions.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Award — bitemporal; the formal conferral of a qualification.
 *
 * Created by AwardService.conferAward after board ratification.
 * hear_generated_at is set when a structured HEAR document is produced (Stage 10).
 */
export const awards = pgTable('award', {
  ...bitemporalColumns,
  tenantId:            uuid('tenant_id').notNull().references(() => tenants.id),
  enrolmentId:         uuid('enrolment_id').notNull(),
  personId:            uuid('person_id').notNull(),
  examBoardId:         uuid('exam_board_id').notNull(),
  qualificationCode:   text('qualification_code').notNull(),   // e.g. BSc | BA | MEng
  classificationCode:  text('classification_code').notNull(),  // e.g. first | upper-second | lower-second | third | pass
  awardDate:           text('award_date').notNull(),            // ISO date string
  hearGeneratedAt:     timestamp('hear_generated_at', { withTimezone: true }),
  certificateIssuedAt: timestamp('certificate_issued_at', { withTimezone: true }),
  hearDocument:        jsonb('hear_document'),  // structured HEAR JSONB; null until Stage 10 generates it
  actorId:             text('actor_id').notNull(),
});

export type Award    = typeof awards.$inferSelect;
export type NewAward = typeof awards.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Post-ratification case — bitemporal; an appeal or administrative correction request.
 *
 * The only authorised path to amend a locked record is through a case in
 * 'upheld' status. Case status advances through: submitted → under-review →
 * upheld | dismissed | not-eligible.
 */
export const postRatificationCases = pgTable('post_ratification_case', {
  ...bitemporalColumns,
  tenantId:       uuid('tenant_id').notNull().references(() => tenants.id),
  enrolmentId:    uuid('enrolment_id').notNull(),
  caseTypeCode:   text('case_type_code').notNull(),   // appeal | administrative-correction
  statusCode:     text('status_code').notNull().default('submitted'), // submitted | under-review | upheld | dismissed | not-eligible
  reference:      text('reference'),                   // optional external reference
  actorId:        text('actor_id').notNull(),
});

export type PostRatificationCase    = typeof postRatificationCases.$inferSelect;
export type NewPostRatificationCase = typeof postRatificationCases.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Post-ratification amendment — append-only; authorised change to a locked entity.
 *
 * Records the before and after values for full auditability. The targeted entity
 * remains locked after the amendment (the new version has locked = true).
 */
export const postRatificationAmendments = pgTable('post_ratification_amendment', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       uuid('tenant_id').notNull().references(() => tenants.id),
  caseId:         uuid('case_id').notNull(),  // FK to post_ratification_case.id (logical)
  entityType:     text('entity_type').notNull(),  // mark | module_result | progression_decision
  entityId:       uuid('entity_id').notNull(),
  beforeValue:    jsonb('before_value').notNull(),
  afterValue:     jsonb('after_value').notNull(),
  authorisedBy:   text('authorised_by').notNull(),
  amendedAt:      timestamp('amended_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PostRatificationAmendment    = typeof postRatificationAmendments.$inferSelect;
export type NewPostRatificationAmendment = typeof postRatificationAmendments.$inferInsert;
