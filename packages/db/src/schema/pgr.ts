import { boolean, date, integer, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';

import { bitemporalColumns } from '../temporal.js';

import { persons } from './identity.js';
import { tenants } from './tenant.js';

/**
 * PGR supervision and research context (BP-03-007, BPR-D07).
 *
 * `pgrSupervisionCase` extends the shared `business_case` primitive
 * (packages/db/src/schema/business-case.ts) via `businessCaseId` — see
 * ADR-023. Nominations are working data attached to the case only —
 * BP-03-007 step 6 creates `staffAssignment` rows solely once the PGR
 * Director/Committee approves, so an incomplete or unapproved team is never
 * representable as current. A change of supervisor end-dates the superseded
 * assignment (recordedUntil) and creates a new one rather than overwriting
 * it (BP-03-007's explicit history requirement).
 */

export const pgrSupervisionCases = pgTable('pgr_supervision_case', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenantId:          uuid('tenant_id').notNull().references(() => tenants.id),
  businessCaseId:    uuid('business_case_id').notNull(), // FK -> business_case.id (logical)
  enrolmentId:       uuid('enrolment_id').notNull(),      // logical FK -> enrolment.id
  degreeAim:         text('degree_aim'),
  researchArea:      text('research_area'),
  schoolOwner:       text('school_owner'),
  intendedStartDate: date('intended_start_date'),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PgrSupervisionCase    = typeof pgrSupervisionCases.$inferSelect;
export type NewPgrSupervisionCase = typeof pgrSupervisionCases.$inferInsert;

/**
 * Proposed nominee for a supervision case — working data only, never
 * consulted as a source of current supervisory authority. Becomes a
 * `staffAssignment` row only once the case is approved.
 */
export const pgrSupervisorNominations = pgTable('pgr_supervisor_nomination', {
  id:                     uuid('id').primaryKey().defaultRandom(),
  tenantId:               uuid('tenant_id').notNull().references(() => tenants.id),
  supervisionCaseId:      uuid('supervision_case_id').notNull().references(() => pgrSupervisionCases.id),
  personId:               uuid('person_id').notNull().references(() => persons.id),
  roleDetailCode:         text('role_detail_code').notNull(),        // value set: pgr-supervisor-role-code (principal | additional | external)
  orgOwner:               text('org_owner'),
  externalOrganisation:   text('external_organisation'),             // set when role_detail_code = 'external'
  contractualStatusCode:  text('contractual_status_code'),           // set for external/collaborative supervisors
  accessLevelCode:        text('access_level_code'),
  eligibilityCheckedAt:   timestamp('eligibility_checked_at', { withTimezone: true }),
  nominatedBy:            text('nominated_by').notNull(),
  nominatedAt:            timestamp('nominated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PgrSupervisorNomination    = typeof pgrSupervisorNominations.$inferSelect;
export type NewPgrSupervisorNomination = typeof pgrSupervisorNominations.$inferInsert;

export const staffAssignments = pgTable('staff_assignment', {
  ...bitemporalColumns,
  tenantId:              uuid('tenant_id').notNull().references(() => tenants.id),
  enrolmentId:           uuid('enrolment_id').notNull(),  // logical FK -> enrolment.id
  supervisionCaseId:     uuid('supervision_case_id').notNull().references(() => pgrSupervisionCases.id),
  personId:              uuid('person_id').notNull().references(() => persons.id),
  assignmentTypeCode:    text('assignment_type_code').notNull(),    // value set: staff-assignment-type (always 'supervisor' for PGR)
  roleDetailCode:        text('role_detail_code').notNull(),        // value set: pgr-supervisor-role-code (principal | additional | external)
  orgOwner:              text('org_owner'),
  externalOrganisation:  text('external_organisation'),             // set when role_detail_code = 'external'
  contractualStatusCode: text('contractual_status_code'),           // set for external/collaborative supervisors
  accessLevelCode:       text('access_level_code'),
  actorId:               text('actor_id').notNull(),
});

export type StaffAssignment    = typeof staffAssignments.$inferSelect;
export type NewStaffAssignment = typeof staffAssignments.$inferInsert;

/**
 * PGR progress review and milestones (BP-04-003, BPR-D07 part 2).
 *
 * `pgrProgressReview` extends `business_case` the same way
 * `pgrSupervisionCase` does — each review (initial, annual, upgrade,
 * return-from-interruption) is its own case instance, not a version of a
 * prior one. `pgrReviewMember` mirrors `board_member_conflict`'s shape
 * (packages/db/src/schema/governance.ts) for panel composition and
 * conflict/recusal tracking. `researchMilestone` is append-only: an
 * unsatisfactory outcome never alters candidature until the case is
 * decided, and a milestone is only published once a decision exists.
 */

export const pgrProgressReviews = pgTable('pgr_progress_review', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenantId:          uuid('tenant_id').notNull().references(() => tenants.id),
  businessCaseId:    uuid('business_case_id').notNull(), // FK -> business_case.id (logical)
  enrolmentId:       uuid('enrolment_id').notNull(),      // logical FK -> enrolment.id
  supervisionCaseId: uuid('supervision_case_id').references(() => pgrSupervisionCases.id),
  reviewTypeCode:    text('review_type_code').notNull(), // value set: pgr-review-type-code
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PgrProgressReview    = typeof pgrProgressReviews.$inferSelect;
export type NewPgrProgressReview = typeof pgrProgressReviews.$inferInsert;

export const pgrReviewMembers = pgTable('pgr_review_member', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         uuid('tenant_id').notNull().references(() => tenants.id),
  reviewId:         uuid('review_id').notNull().references(() => pgrProgressReviews.id),
  personId:         uuid('person_id').notNull().references(() => persons.id),
  roleCode:         text('role_code').notNull(), // value set: pgr-review-member-role-code (chair | independent-reviewer | panel-member)
  conflictTypeCode: text('conflict_type_code'),  // value set: board-conflict-type-code (reused — same nature of conflict)
  declaredAt:       timestamp('declared_at', { withTimezone: true }),
  recusedAt:        timestamp('recused_at', { withTimezone: true }),
  addedBy:          text('added_by').notNull(),
  addedAt:          timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PgrReviewMember    = typeof pgrReviewMembers.$inferSelect;
export type NewPgrReviewMember = typeof pgrReviewMembers.$inferInsert;

export const researchMilestones = pgTable('research_milestone', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         uuid('tenant_id').notNull().references(() => tenants.id),
  enrolmentId:      uuid('enrolment_id').notNull(), // logical FK -> enrolment.id
  reviewId:         uuid('review_id').references(() => pgrProgressReviews.id),
  milestoneTypeCode: text('milestone_type_code').notNull(), // value set: research-milestone-type
  achievedDate:     date('achieved_date').notNull(),
  publishedAt:      timestamp('published_at', { withTimezone: true }),
  actorId:          text('actor_id').notNull(),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ResearchMilestone    = typeof researchMilestones.$inferSelect;
export type NewResearchMilestone = typeof researchMilestones.$inferInsert;

/**
 * PGR thesis submission and examination (BP-05-010, BPR-D12).
 *
 * `pgrExaminationCase` extends `business_case` the same way the other PGR
 * cases do. Follows ADR-020's staged-authority pattern: immutable submitted
 * thesis version (`thesisSubmission`, append-only) → examiner nomination
 * and chair approval → examiner reports (append-only) → viva (`vivaEvent`)
 * → ratified, immutable outcome (`pgrExaminationOutcome`, append-only — the
 * case's own business_case.statusCode is advanced to the outcome code
 * itself, mirroring how the progress-review case's status becomes its
 * outcome). Corrections/revisions are deadlined follow-up requirements
 * linked to the ratified outcome, never an edit to it.
 */

export const pgrExaminationCases = pgTable('pgr_examination_case', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       uuid('tenant_id').notNull().references(() => tenants.id),
  businessCaseId: uuid('business_case_id').notNull(), // FK -> business_case.id (logical)
  enrolmentId:    uuid('enrolment_id').notNull(),      // logical FK -> enrolment.id
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PgrExaminationCase    = typeof pgrExaminationCases.$inferSelect;
export type NewPgrExaminationCase = typeof pgrExaminationCases.$inferInsert;

/** Append-only — each submission is an immutable version, never edited in place. */
export const thesisSubmissions = pgTable('thesis_submission', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  tenantId:              uuid('tenant_id').notNull().references(() => tenants.id),
  examinationCaseId:     uuid('examination_case_id').notNull().references(() => pgrExaminationCases.id),
  versionNumber:         integer('version_number').notNull(),
  formatCode:            text('format_code').notNull(), // value set: pgr-thesis-format-code (traditional | practice-based | published-work)
  declarationConfirmed:  boolean('declaration_confirmed').notNull(),
  restricted:            boolean('restricted').notNull().default(false),
  restrictionReasonText: text('restriction_reason_text'),
  restrictionReviewDate: date('restriction_review_date'),
  storageRef:            text('storage_ref').notNull(), // opaque pointer into the repository — content is never held in SRS
  submittedBy:           text('submitted_by').notNull(),
  submittedAt:           timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ThesisSubmission    = typeof thesisSubmissions.$inferSelect;
export type NewThesisSubmission = typeof thesisSubmissions.$inferInsert;

export const examinerAppointments = pgTable('examiner_appointment', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  tenantId:             uuid('tenant_id').notNull().references(() => tenants.id),
  examinationCaseId:    uuid('examination_case_id').notNull().references(() => pgrExaminationCases.id),
  personId:             uuid('person_id').notNull().references(() => persons.id),
  examinerRoleCode:     text('examiner_role_code').notNull(), // value set: pgr-examiner-role-code (internal | external)
  independenceCheckedAt: timestamp('independence_checked_at', { withTimezone: true }),
  conflictTypeCode:     text('conflict_type_code'), // value set: board-conflict-type-code (reused)
  recusedAt:            timestamp('recused_at', { withTimezone: true }),
  confirmedAt:          timestamp('confirmed_at', { withTimezone: true }), // set once the Independent Chair approves the panel
  nominatedBy:          text('nominated_by').notNull(),
  nominatedAt:          timestamp('nominated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ExaminerAppointment    = typeof examinerAppointments.$inferSelect;
export type NewExaminerAppointment = typeof examinerAppointments.$inferInsert;

/** Append-only — an examiner's preliminary report, never edited in place. */
export const examinerReports = pgTable('examiner_report', {
  id:                     uuid('id').primaryKey().defaultRandom(),
  tenantId:               uuid('tenant_id').notNull().references(() => tenants.id),
  examinationCaseId:      uuid('examination_case_id').notNull().references(() => pgrExaminationCases.id),
  examinerAppointmentId:  uuid('examiner_appointment_id').notNull().references(() => examinerAppointments.id),
  reportRef:              text('report_ref').notNull(), // opaque pointer — content held in the examiner workspace
  recommendationCode:     text('recommendation_code'), // value set: pgr-examination-outcome-code (reused — preliminary, non-binding)
  submittedAt:            timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ExaminerReport    = typeof examinerReports.$inferSelect;
export type NewExaminerReport = typeof examinerReports.$inferInsert;

/** Append-only — the held viva and its joint recommendation. */
export const vivaEvents = pgTable('viva_event', {
  id:                     uuid('id').primaryKey().defaultRandom(),
  tenantId:               uuid('tenant_id').notNull().references(() => tenants.id),
  examinationCaseId:      uuid('examination_case_id').notNull().references(() => pgrExaminationCases.id),
  heldAt:                 timestamp('held_at', { withTimezone: true }).notNull(),
  jointRecommendationText: text('joint_recommendation_text').notNull(),
  recordedBy:             text('recorded_by').notNull(),
  recordedAt:             timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
});

export type VivaEvent    = typeof vivaEvents.$inferSelect;
export type NewVivaEvent = typeof vivaEvents.$inferInsert;

/** Append-only, immutable — the ratified outcome. Amend only via a linked correction case, never in place. */
export const pgrExaminationOutcomes = pgTable('pgr_examination_outcome', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenantId:          uuid('tenant_id').notNull().references(() => tenants.id),
  examinationCaseId: uuid('examination_case_id').notNull().references(() => pgrExaminationCases.id),
  outcomeCode:       text('outcome_code').notNull(), // value set: pgr-examination-outcome-code
  decidedBy:         text('decided_by').notNull(),
  decidedAt:         timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PgrExaminationOutcome    = typeof pgrExaminationOutcomes.$inferSelect;
export type NewPgrExaminationOutcome = typeof pgrExaminationOutcomes.$inferInsert;

export const thesisCorrectionRequirements = pgTable('thesis_correction_requirement', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      uuid('tenant_id').notNull().references(() => tenants.id),
  outcomeId:     uuid('outcome_id').notNull().references(() => pgrExaminationOutcomes.id),
  deadlineDate:  date('deadline_date').notNull(),
  completedAt:   timestamp('completed_at', { withTimezone: true }),
  completedBy:   text('completed_by'),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ThesisCorrectionRequirement    = typeof thesisCorrectionRequirements.$inferSelect;
export type NewThesisCorrectionRequirement = typeof thesisCorrectionRequirements.$inferInsert;

/**
 * PGR completion and award conferral (BP-06-006, BPR-D14).
 *
 * `pgrCompletionCase` extends `business_case` the same way the other PGR
 * cases do, and links back to the examination case whose ratified,
 * corrections-complete outcome authorises completion. `finalThesisDeposit`
 * confirms repository deposit and IP declarations (BP-06-006 step 3) before
 * completion can be recorded — a missing deposit holds completion, it never
 * silently proceeds.
 */

export const pgrCompletionCases = pgTable('pgr_completion_case', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenantId:          uuid('tenant_id').notNull().references(() => tenants.id),
  businessCaseId:    uuid('business_case_id').notNull(), // FK -> business_case.id (logical)
  enrolmentId:       uuid('enrolment_id').notNull(),      // logical FK -> enrolment.id
  examinationCaseId: uuid('examination_case_id').notNull().references(() => pgrExaminationCases.id),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PgrCompletionCase    = typeof pgrCompletionCases.$inferSelect;
export type NewPgrCompletionCase = typeof pgrCompletionCases.$inferInsert;

export const finalThesisDeposits = pgTable('final_thesis_deposit', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  tenantId:              uuid('tenant_id').notNull().references(() => tenants.id),
  completionCaseId:      uuid('completion_case_id').notNull().references(() => pgrCompletionCases.id),
  depositRef:            text('deposit_ref').notNull(), // opaque pointer into the repository
  ipDeclarationConfirmed: boolean('ip_declaration_confirmed').notNull(),
  confirmedBy:           text('confirmed_by').notNull(),
  confirmedAt:           timestamp('confirmed_at', { withTimezone: true }).notNull().defaultNow(),
});

export type FinalThesisDeposit    = typeof finalThesisDeposits.$inferSelect;
export type NewFinalThesisDeposit = typeof finalThesisDeposits.$inferInsert;
