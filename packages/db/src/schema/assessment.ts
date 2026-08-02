import { boolean, integer, jsonb, numeric, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';

import { bitemporalColumns } from '../temporal.js';

import { tenants } from './tenant.js';

/**
 * Assessment component — one row per examinable component of a module offering.
 *
 * Components carry weightings (must sum to 100 across a module offering), pass
 * marks, and type codes. They are the structural configuration that drives
 * mark aggregation in ModuleResultService.
 *
 * Immutable once marks have been ingested against them.
 */
export const assessmentComponents = pgTable('assessment_component', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenantId:          uuid('tenant_id').notNull().references(() => tenants.id),
  moduleOfferingId:  uuid('module_offering_id').notNull(),  // FK to module_offering.id (logical)
  componentTypeCode: text('component_type_code').notNull(), // exam | coursework | practical | portfolio | presentation
  title:             text('title').notNull(),
  weighting:         integer('weighting').notNull(),         // percentage; all components for an offering must sum to 100
  passMarkOverride:  numeric('pass_mark_override', { precision: 5, scale: 2 }), // if null, uses rules-engine pass-mark
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AssessmentComponent    = typeof assessmentComponents.$inferSelect;
export type NewAssessmentComponent = typeof assessmentComponents.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assessment submission — append-only intake record from source systems.
 *
 * Each submission event from a source system (e.g. VLE, exam office) produces
 * one row. A mark row is created or updated from a submission;
 * mark.assessment_submission_id links the two. Superseded submissions keep
 * their row; the active mark always reflects the latest non-superseded submission.
 */
export const assessmentSubmissions = pgTable('assessment_submission', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  tenantId:              uuid('tenant_id').notNull().references(() => tenants.id),
  assessmentComponentId: uuid('assessment_component_id').notNull(),
  moduleRegistrationId:  uuid('module_registration_id').notNull(),
  sourceSystem:          text('source_system').notNull(),
  sourceReference:       text('source_reference'),
  submittedAt:           timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  supersededAt:          timestamp('superseded_at', { withTimezone: true }),
  rawPayload:            jsonb('raw_payload'),
});

export type AssessmentSubmission    = typeof assessmentSubmissions.$inferSelect;
export type NewAssessmentSubmission = typeof assessmentSubmissions.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mark — bitemporal; the authoritative assessment mark for a component/registration.
 *
 * raw_mark is what the source system reported. adjusted_mark is what is used
 * for aggregation — it may differ due to late penalties or misconduct penalties.
 * locked = true after board ratification; further mutations require an upheld
 * post-ratification case.
 */
export const marks = pgTable('mark', {
  ...bitemporalColumns,
  tenantId:              uuid('tenant_id').notNull().references(() => tenants.id),
  moduleRegistrationId:  uuid('module_registration_id').notNull(),
  assessmentComponentId: uuid('assessment_component_id').notNull(),
  assessmentSubmissionId: uuid('assessment_submission_id'), // FK to assessment_submission.id; nullable for manually ingested marks
  attemptNumber:         integer('attempt_number').notNull().default(1),
  rawMark:               numeric('raw_mark', { precision: 5, scale: 2 }).notNull(),
  adjustedMark:          numeric('adjusted_mark', { precision: 5, scale: 2 }).notNull(),
  penaltyApplied:        boolean('penalty_applied').notNull().default(false),
  penaltyPercent:        numeric('penalty_percent', { precision: 5, scale: 2 }),
  locked:                boolean('locked').notNull().default(false),
  sourceSystem:          text('source_system'),
  actorId:               text('actor_id').notNull(),
});

export type Mark    = typeof marks.$inferSelect;
export type NewMark = typeof marks.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Module result — bitemporal; aggregate outcome for a module registration.
 *
 * Derived from marks via ModuleResultService.recalculate — never written directly
 * by API routes. locked = true after board ratification.
 */
export const moduleResults = pgTable('module_result', {
  ...bitemporalColumns,
  tenantId:             uuid('tenant_id').notNull().references(() => tenants.id),
  moduleRegistrationId: uuid('module_registration_id').notNull(),
  aggregateMark:        numeric('aggregate_mark', { precision: 5, scale: 2 }).notNull(),
  resultCode:           text('result_code').notNull(), // pass | fail | compensated | condoned | deferred | resit-required
  locked:               boolean('locked').notNull().default(false),
  calculatedAt:         timestamp('calculated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ModuleResult    = typeof moduleResults.$inferSelect;
export type NewModuleResult = typeof moduleResults.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// BPR-D10 — assessment candidate attempt & moderation (Stage 3, migration 0004_business_process_foundations).
//
// mark.attempt_number stays as the legacy source column. A candidate attempt
// row is created from it (createdFromMarkId bridges to the mark that
// produced it) so moderation can operate over a stable attempt identity
// rather than the mark row itself, which may be superseded.

export const assessmentCandidateAttempts = pgTable('assessment_candidate_attempt', {
  ...bitemporalColumns,
  tenantId:              uuid('tenant_id').notNull().references(() => tenants.id),
  moduleRegistrationId:  uuid('module_registration_id').notNull(),
  assessmentComponentId: uuid('assessment_component_id').notNull(),
  attemptNumber:         integer('attempt_number').notNull(),
  attemptTypeCode:       text('attempt_type_code').notNull(), // first-sit | resit | repeat
  createdFromMarkId:     uuid('created_from_mark_id'),         // legacy bridge -> mark.id, nullable
  actorId:               text('actor_id').notNull(),
});

export type AssessmentCandidateAttempt    = typeof assessmentCandidateAttempts.$inferSelect;
export type NewAssessmentCandidateAttempt = typeof assessmentCandidateAttempts.$inferInsert;

export const markSets = pgTable('mark_set', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  tenantId:              uuid('tenant_id').notNull().references(() => tenants.id),
  assessmentComponentId: uuid('assessment_component_id').notNull(),
  generatedAt:           timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  generatedBy:           text('generated_by').notNull(),
  sourceQueryHash:       text('source_query_hash').notNull(),
});

export type MarkSet    = typeof markSets.$inferSelect;
export type NewMarkSet = typeof markSets.$inferInsert;

export const markSetMembers = pgTable('mark_set_member', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenantId:           uuid('tenant_id').notNull().references(() => tenants.id),
  markSetId:          uuid('mark_set_id').notNull(),
  markId:             uuid('mark_id').notNull(),             // legacy bridge -> mark.id
  candidateAttemptId: uuid('candidate_attempt_id').notNull(), // FK -> assessment_candidate_attempt.id
});

export type MarkSetMember    = typeof markSetMembers.$inferSelect;
export type NewMarkSetMember = typeof markSetMembers.$inferInsert;

export const moderationReviews = pgTable('moderation_review', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         uuid('tenant_id').notNull().references(() => tenants.id),
  markSetId:        uuid('mark_set_id').notNull(),
  moderatorActorId: text('moderator_actor_id').notNull(),
  ruleVersion:      text('rule_version').notNull(),
  startedAt:        timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt:      timestamp('completed_at', { withTimezone: true }),
  outcomeCode:      text('outcome_code'), // no-change | adjusted | escalated
});

export type ModerationReview    = typeof moderationReviews.$inferSelect;
export type NewModerationReview = typeof moderationReviews.$inferInsert;

export const moderationSamples = pgTable('moderation_sample', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  tenantId:            uuid('tenant_id').notNull().references(() => tenants.id),
  moderationReviewId:  uuid('moderation_review_id').notNull(),
  markId:              uuid('mark_id').notNull(), // legacy bridge -> mark.id
  sampleReasonCode:    text('sample_reason_code').notNull(), // random | boundary | first-marker-flag | outlier
  originalMark:        numeric('original_mark', { precision: 5, scale: 2 }).notNull(),
  moderatedMark:       numeric('moderated_mark', { precision: 5, scale: 2 }),
  changeReasonCode:    text('change_reason_code'),
});

export type ModerationSample    = typeof moderationSamples.$inferSelect;
export type NewModerationSample = typeof moderationSamples.$inferInsert;
