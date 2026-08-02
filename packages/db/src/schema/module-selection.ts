import { boolean, jsonb, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';

import { bitemporalColumns } from '../temporal.js';

import { academicPeriods } from './calendar.js';
import { tenants } from './tenant.js';

/**
 * Bitemporal module diet group — gives a programme_rule_set actual content:
 * a compulsory allocation, or an optional/elective pool with count and/or
 * credit bounds and level composition rules.
 *
 * See docs/architecture/module-selection-rules.md.
 */
export const moduleGroups = pgTable('module_group', {
  ...bitemporalColumns,
  tenantId:            uuid('tenant_id').notNull().references(() => tenants.id),
  programmeRuleSetId:  uuid('programme_rule_set_id').notNull(),  // logical FK → programmeRuleSets.id
  fheqLevel:           smallint('fheq_level'),
  groupCode:           text('group_code').notNull(),
  title:               text('title').notNull(),
  groupTypeCode:       text('group_type_code').notNull(),  // 'compulsory' | 'optional-pool' | 'elective-pool'
  minModules:          smallint('min_modules'),
  maxModules:          smallint('max_modules'),
  minCredits:          smallint('min_credits'),
  maxCredits:          smallint('max_credits'),
  minFheqLevel:        smallint('min_fheq_level'),
  maxFheqLevel:        smallint('max_fheq_level'),
});

export type ModuleGroup    = typeof moduleGroups.$inferSelect;
export type NewModuleGroup = typeof moduleGroups.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/** Bitemporal membership of a module within a diet group. */
export const moduleGroupMembers = pgTable('module_group_member', {
  ...bitemporalColumns,
  tenantId:          uuid('tenant_id').notNull().references(() => tenants.id),
  moduleGroupId:     uuid('module_group_id').notNull(),  // logical FK → moduleGroups.id
  moduleId:          uuid('module_id').notNull(),        // logical FK → modules.id
  isDefault:         boolean('is_default').notNull().default(false),
  isNonCondonable:   boolean('is_non_condonable').notNull().default(false),
});

export type ModuleGroupMember    = typeof moduleGroupMembers.$inferSelect;
export type NewModuleGroupMember = typeof moduleGroupMembers.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bitemporal, explicit binding of an enrolment to the programme route and
 * rule-set version that governs its module choices, progression and award.
 * Resolves BP-03-002 Open Question OQ-1.
 */
export const enrolmentCurriculumBindings = pgTable('enrolment_curriculum_binding', {
  ...bitemporalColumns,
  tenantId:               uuid('tenant_id').notNull().references(() => tenants.id),
  enrolmentId:            uuid('enrolment_id').notNull(),        // logical FK → enrolments.id
  programmeRouteId:       uuid('programme_route_id'),            // nullable; logical FK → programmeRoutes.id
  programmeRuleSetId:     uuid('programme_rule_set_id').notNull(), // logical FK → programmeRuleSets.id
  decisionAuthorityCode:  text('decision_authority_code').notNull(), // 'automatic' | 'registry-administrator' | 'academic-approver'
  decisionReason:         text('decision_reason'),
});

export type EnrolmentCurriculumBinding    = typeof enrolmentCurriculumBindings.$inferSelect;
export type NewEnrolmentCurriculumBinding = typeof enrolmentCurriculumBindings.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bitemporal module selection proposal — the draft/submitted/validated/approved
 * lifecycle described in BP-03-003/BP-03-004, ahead of confirmation as durable
 * module_registration rows. Resolves BP-03-003 OQ-1 and BP-03-004 OQ-1.
 */
export const moduleSelectionProposals = pgTable('module_selection_proposal', {
  ...bitemporalColumns,
  tenantId:               uuid('tenant_id').notNull().references(() => tenants.id),
  enrolmentId:            uuid('enrolment_id').notNull(),          // logical FK → enrolments.id
  academicPeriodId:       uuid('academic_period_id').notNull().references(() => academicPeriods.id),
  programmeRuleSetId:     uuid('programme_rule_set_id').notNull(), // pinned at creation
  statusCode:             text('status_code').notNull().default('draft'),
  submittedAt:            timestamp('submitted_at', { withTimezone: true }),
  decidedAt:              timestamp('decided_at', { withTimezone: true }),
  decisionAuthorityCode:  text('decision_authority_code'),
  decisionReason:         text('decision_reason'),
  workflowInstanceId:     uuid('workflow_instance_id'),
});

export type ModuleSelectionProposal    = typeof moduleSelectionProposals.$inferSelect;
export type NewModuleSelectionProposal = typeof moduleSelectionProposals.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Module selection proposal line item — not bitemporal; items are freely
 * edited while the parent proposal is in draft and re-validated in place.
 */
export const moduleSelectionProposalItems = pgTable('module_selection_proposal_item', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  tenantId:             uuid('tenant_id').notNull().references(() => tenants.id),
  proposalId:           uuid('proposal_id').notNull(),   // logical FK → moduleSelectionProposals.id
  moduleId:             uuid('module_id').notNull(),     // logical FK → modules.id
  moduleOfferingId:     uuid('module_offering_id'),       // nullable until a specific offering is chosen
  preferenceRank:       smallint('preference_rank'),
  sourceCode:           text('source_code').notNull(),    // 'compulsory-auto' | 'student-choice' | 'staff-assisted'
  validationStateCode:  text('validation_state_code').notNull().default('pending'), // 'pending' | 'passed' | 'failed'
  validationMessages:   jsonb('validation_messages').$type<Array<{ ruleTypeCode: string; message: string; severity: 'error' | 'warning' }>>(),
  createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ModuleSelectionProposalItem    = typeof moduleSelectionProposalItems.$inferSelect;
export type NewModuleSelectionProposalItem = typeof moduleSelectionProposalItems.$inferInsert;
