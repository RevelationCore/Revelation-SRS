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
