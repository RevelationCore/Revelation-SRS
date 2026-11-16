import { date, numeric, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenant.js';

/** The next attempt an authorised progression decision creates (BPR-D14; BP-06-002). */
export const reassessmentPlans = pgTable('reassessment_plan', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  tenantId:              uuid('tenant_id').notNull().references(() => tenants.id),
  enrolmentId:           uuid('enrolment_id').notNull(),
  progressionDecisionId: uuid('progression_decision_id').notNull(),
  planTypeCode:          text('plan_type_code').notNull(),
  moduleRegistrationId:  uuid('module_registration_id'),
  assessmentComponentId: uuid('assessment_component_id'),
  academicPeriodId:      uuid('academic_period_id'),
  attemptNumber:         smallint('attempt_number').notNull(),
  markCap:               smallint('mark_cap'),
  dueDate:               date('due_date'),
  statusCode:            text('status_code').notNull().default('planned'), // planned | completed | expired | cancelled
  outcomeNote:           text('outcome_note'),
  createdBy:             text('created_by').notNull(),
  createdAt:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  closedBy:              text('closed_by'),
  closedAt:              timestamp('closed_at', { withTimezone: true }),
});

export type ReassessmentPlan = typeof reassessmentPlans.$inferSelect;

/** A board's award recommendation, bound to the calculated classification (BP-06-003). */
export const awardRecommendations = pgTable('award_recommendation', {
  id:                           uuid('id').primaryKey().defaultRandom(),
  tenantId:                     uuid('tenant_id').notNull().references(() => tenants.id),
  enrolmentId:                  uuid('enrolment_id').notNull(),
  personId:                     uuid('person_id').notNull(),
  examBoardId:                  uuid('exam_board_id'),
  awardTypeCode:                text('award_type_code').notNull(),
  qualificationCode:            text('qualification_code').notNull(),
  classificationCode:           text('classification_code').notNull(),
  calculatedClassificationCode: text('calculated_classification_code'),
  aggregateMark:                numeric('aggregate_mark', { precision: 6, scale: 2, mode: 'number' }),
  discretionReason:             text('discretion_reason'),
  authorityRef:                 text('authority_ref'),
  statusCode:                   text('status_code').notNull().default('recommended'), // recommended | conferred | withdrawn
  recommendedBy:                text('recommended_by').notNull(),
  recommendedAt:                timestamp('recommended_at', { withTimezone: true }).notNull().defaultNow(),
  withdrawnReason:              text('withdrawn_reason'),
});

export type AwardRecommendation = typeof awardRecommendations.$inferSelect;

/** Immutable conferment by a delegated authority; creates the award. */
export const awardConferments = pgTable('award_conferment', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         uuid('tenant_id').notNull().references(() => tenants.id),
  recommendationId: uuid('recommendation_id').notNull().references(() => awardRecommendations.id),
  awardId:          uuid('award_id').notNull(),
  confermentDate:   date('conferment_date').notNull(),
  authorityRef:     text('authority_ref').notNull(),
  conferredBy:      text('conferred_by').notNull(),
  conferredAt:      timestamp('conferred_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AwardConferment = typeof awardConferments.$inferSelect;
