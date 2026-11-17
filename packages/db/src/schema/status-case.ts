import { date, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenant.js';

/**
 * Student status case (BPR-D04; BP-02-006/007/008/009/012), rooted on
 * business_case per ADR-023. Approval applies the change to the enrolment
 * and records the resulting enrolment_status_transition here.
 */
export const studentStatusCases = pgTable('student_status_case', {
  id:                          uuid('id').primaryKey().defaultRandom(),
  tenantId:                    uuid('tenant_id').notNull().references(() => tenants.id),
  businessCaseId:              uuid('business_case_id').notNull(),
  enrolmentId:                 uuid('enrolment_id').notNull(),
  personId:                    uuid('person_id').notNull(),
  caseTypeCode:                text('case_type_code').notNull(),
  initiatedByCode:             text('initiated_by_code').notNull(),
  reasonCategoryCode:          text('reason_category_code'),
  requestedEffectiveDate:      date('requested_effective_date').notNull(),
  expectedReturnDate:          date('expected_return_date'),
  destinationProgrammeId:      uuid('destination_programme_id'),
  destinationModeOfStudyCode:  text('destination_mode_of_study_code'),
  destinationStudyIntensityPercent: smallint('destination_study_intensity_percent'),
  relatedCaseId:               uuid('related_case_id'),
  institutionalOutcomeRef:     text('institutional_outcome_ref'),
  statusCode:                  text('status_code').notNull().default('requested'), // requested | approved | rejected | withdrawn
  decidedBy:                   text('decided_by'),
  decidedAt:                   timestamp('decided_at', { withTimezone: true }),
  decisionReason:              text('decision_reason'),
  approvedEffectiveDate:       date('approved_effective_date'),
  approvedReturnDate:          date('approved_return_date'),
  enrolmentStatusTransitionId: uuid('enrolment_status_transition_id'),
  createdBy:                   text('created_by').notNull(),
  createdAt:                   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:                   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type StudentStatusCase = typeof studentStatusCases.$inferSelect;

/** A reviewer's advice on a status case. Append-only. */
export const statusCaseAssessments = pgTable('status_case_assessment', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         uuid('tenant_id').notNull().references(() => tenants.id),
  statusCaseId:     uuid('status_case_id').notNull().references(() => studentStatusCases.id),
  assessorRoleCode: text('assessor_role_code').notNull(),
  outcomeCode:      text('outcome_code').notNull(),
  note:             text('note'),
  assessedBy:       text('assessed_by').notNull(),
  assessedAt:       timestamp('assessed_at', { withTimezone: true }).notNull().defaultNow(),
});

export type StatusCaseAssessment = typeof statusCaseAssessments.$inferSelect;

/** A condition imposed by a status decision, e.g. a return condition. */
export const statusCaseConditions = pgTable('status_case_condition', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenantId:          uuid('tenant_id').notNull().references(() => tenants.id),
  statusCaseId:      uuid('status_case_id').notNull().references(() => studentStatusCases.id),
  conditionTypeCode: text('condition_type_code').notNull(),
  description:       text('description').notNull(),
  dueDate:           date('due_date'),
  statusCode:        text('status_code').notNull().default('open'), // open | met | waived
  evidenceRef:       text('evidence_ref'),
  resolvedBy:        text('resolved_by'),
  resolvedAt:        timestamp('resolved_at', { withTimezone: true }),
  resolutionNote:    text('resolution_note'),
  createdBy:         text('created_by').notNull(),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type StatusCaseCondition = typeof statusCaseConditions.$inferSelect;
