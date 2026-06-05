import { date, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';

import { bitemporalColumns } from '../temporal.js';

import { tenants } from './tenant.js';

/**
 * Exceptional circumstances — bitemporal; ad-hoc, time-bound flags for board consideration.
 *
 * EC flags are distinct from reasonable adjustments: they are episodic (tied to
 * a specific assessment event) rather than ongoing accommodations. They surface
 * in the exam board data pack for member consideration; they do not automatically
 * alter marks.
 */
export const exceptionalCircumstances = pgTable('exceptional_circumstances', {
  ...bitemporalColumns,
  tenantId:          uuid('tenant_id').notNull().references(() => tenants.id),
  enrolmentId:       uuid('enrolment_id').notNull(),
  personId:          uuid('person_id').notNull(),
  moduleOfferingId:  uuid('module_offering_id'),  // nullable: some ECs are enrolment-wide
  outcomeCode:       text('outcome_code').notNull(), // e.g. defer | condone | no-action
  determinationDate: date('determination_date').notNull(),
  notes:             text('notes'),
  actorId:           text('actor_id').notNull(),
});

export type ExceptionalCircumstance    = typeof exceptionalCircumstances.$inferSelect;
export type NewExceptionalCircumstance = typeof exceptionalCircumstances.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Board visibility link — append-only; records which board packs an EC flag was surfaced in.
 */
export const exceptionalCircumstancesBoardVisibility = pgTable('exceptional_circumstances_board_visibility', {
  id:                        uuid('id').primaryKey().defaultRandom(),
  tenantId:                  uuid('tenant_id').notNull().references(() => tenants.id),
  exceptionalCircumstancesId: uuid('exceptional_circumstances_id').notNull(),
  examBoardDataPackId:       uuid('exam_board_data_pack_id').notNull(),
  addedAt:                   timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ExceptionalCircumstancesBoardVisibility    = typeof exceptionalCircumstancesBoardVisibility.$inferSelect;
export type NewExceptionalCircumstancesBoardVisibility = typeof exceptionalCircumstancesBoardVisibility.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Misconduct case reference — bitemporal; links to an external AI case number.
 */
export const misconductCaseReferences = pgTable('misconduct_case_reference', {
  ...bitemporalColumns,
  tenantId:          uuid('tenant_id').notNull().references(() => tenants.id),
  enrolmentId:       uuid('enrolment_id').notNull(),
  personId:          uuid('person_id').notNull(),
  caseReference:     text('case_reference').notNull(),  // external AI system reference
  caseStatusCode:    text('case_status_code').notNull(), // open | closed | withdrawn
  actorId:           text('actor_id').notNull(),
});

export type MisconductCaseReference    = typeof misconductCaseReferences.$inferSelect;
export type NewMisconductCaseReference = typeof misconductCaseReferences.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Misconduct outcome — bitemporal; the determined penalty for an AI case.
 */
export const misconductOutcomes = pgTable('misconduct_outcome', {
  ...bitemporalColumns,
  tenantId:            uuid('tenant_id').notNull().references(() => tenants.id),
  misconductCaseId:    uuid('misconduct_case_id').notNull(),
  enrolmentId:         uuid('enrolment_id').notNull(),
  penaltyCode:         text('penalty_code').notNull(), // mark-reduction | mark-cap | module-fail | progression-block | exclusion
  effectiveDate:       date('effective_date').notNull(),
  actorId:             text('actor_id').notNull(),
});

export type MisconductOutcome    = typeof misconductOutcomes.$inferSelect;
export type NewMisconductOutcome = typeof misconductOutcomes.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Misconduct penalty effect — bitemporal; structured per-mark/registration impact.
 *
 * Records the concrete effect of a misconduct outcome on individual marks or
 * module registrations, enabling the board data pack to surface the precise
 * impact per candidate.
 */
export const misconductPenaltyEffects = pgTable('misconduct_penalty_effect', {
  ...bitemporalColumns,
  tenantId:          uuid('tenant_id').notNull().references(() => tenants.id),
  misconductOutcomeId: uuid('misconduct_outcome_id').notNull(),
  targetEntityType:  text('target_entity_type').notNull(), // mark | module_registration
  targetEntityId:    uuid('target_entity_id').notNull(),
  penaltyDetail:     text('penalty_detail'),               // human-readable description of effect
});

export type MisconductPenaltyEffect    = typeof misconductPenaltyEffects.$inferSelect;
export type NewMisconductPenaltyEffect = typeof misconductPenaltyEffects.$inferInsert;
