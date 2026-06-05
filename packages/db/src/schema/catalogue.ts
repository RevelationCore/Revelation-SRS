import { boolean, jsonb, smallint, text, uuid } from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';

import { bitemporalColumns } from '../temporal.js';

import { tenants } from './tenant.js';

/**
 * Awarding bodies — catalogue of degree-awarding institutions.
 * Non-bitemporal; changes are rare and tracked in audit_record.
 */
export const awardingBodies = pgTable('awarding_body', {
  id:       uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  code:     text('code').notNull(),
  name:     text('name').notNull(),
  active:   boolean('active').notNull().default(true),
});

export type AwardingBody    = typeof awardingBodies.$inferSelect;
export type NewAwardingBody = typeof awardingBodies.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bitemporal programme definition.
 * Programmes change slowly (annual regulatory updates) — bitemporality enables
 * reconstruction of which regulations applied to a given cohort.
 */
export const programmes = pgTable('programme', {
  ...bitemporalColumns,
  tenantId:             uuid('tenant_id').notNull().references(() => tenants.id),
  code:                 text('code').notNull(),
  title:                text('title').notNull(),
  qualificationTypeCode: text('qualification_type_code'),  // HESA qualification type
  awardingBodyId:       uuid('awarding_body_id'),
  owningSchool:         text('owning_school'),
  creditFrameworkCode:  text('credit_framework_code'),  // 'cats' | 'ects' | 'institutional'
  fheqLevel:            smallint('fheq_level'),          // 4–8
  creditTotal:          smallint('credit_total'),
  durationYears:        smallint('duration_years'),
  modeOfStudyCode:      text('mode_of_study_code'),
  sourceSystemReference: text('source_system_reference'),
});

export type Programme    = typeof programmes.$inferSelect;
export type NewProgramme = typeof programmes.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/** Bitemporal pathway/specialism within a programme. */
export const programmeRoutes = pgTable('programme_route', {
  ...bitemporalColumns,
  tenantId:    uuid('tenant_id').notNull().references(() => tenants.id),
  programmeId: uuid('programme_id').notNull(),  // logical FK → programmes.id
  routeCode:   text('route_code').notNull(),
  title:       text('title').notNull(),
});

export type ProgrammeRoute    = typeof programmeRoutes.$inferSelect;
export type NewProgrammeRoute = typeof programmeRoutes.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bitemporal binding of cohort-specific assessment regulations to a
 * programme/route combination.  Used by the rules engine to locate the
 * correct rule set for a given student's academic year of entry.
 */
export const programmeRuleSets = pgTable('programme_rule_set', {
  ...bitemporalColumns,
  tenantId:           uuid('tenant_id').notNull().references(() => tenants.id),
  programmeId:        uuid('programme_id').notNull(),
  programmeRouteId:   uuid('programme_route_id'),     // nullable = applies to all routes
  entryAcademicYear:  text('entry_academic_year'),    // nullable = applies to all cohorts
  ruleSetCode:        text('rule_set_code').notNull(),
  description:        text('description'),
});

export type ProgrammeRuleSet    = typeof programmeRuleSets.$inferSelect;
export type NewProgrammeRuleSet = typeof programmeRuleSets.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bitemporal module catalogue definition.
 * Modules may be updated (credit changes, level reclassifications) across
 * academic years; bitemporality preserves the version in force at registration.
 */
export const modules = pgTable('module', {
  ...bitemporalColumns,
  tenantId:             uuid('tenant_id').notNull().references(() => tenants.id),
  code:                 text('code').notNull(),
  title:                text('title').notNull(),
  creditValue:          smallint('credit_value'),
  fheqLevel:            smallint('fheq_level'),
  sourceSystemReference: text('source_system_reference'),
});

export type Module    = typeof modules.$inferSelect;
export type NewModule = typeof modules.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bitemporal prerequisite/co-requisite/exclusion relationships between modules.
 * Checked at registration time using the version current at the registration date.
 */
export const moduleRelationships = pgTable('module_relationship', {
  ...bitemporalColumns,
  tenantId:            uuid('tenant_id').notNull().references(() => tenants.id),
  moduleId:            uuid('module_id').notNull(),          // logical FK → modules.id
  relatedModuleId:     uuid('related_module_id').notNull(),  // logical FK → modules.id
  relationshipTypeCode: text('relationship_type_code').notNull(), // 'prerequisite' | 'co-requisite' | 'exclusion'
});

export type ModuleRelationship    = typeof moduleRelationships.$inferSelect;
export type NewModuleRelationship = typeof moduleRelationships.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bitemporal assessment structure definition for a module.
 * component_schema is a JSONB document describing the assessment components
 * (e.g. [{ code: 'CW1', weight: 40 }, { code: 'EX1', weight: 60 }]).
 */
export const assessmentPatterns = pgTable('assessment_pattern', {
  ...bitemporalColumns,
  tenantId:        uuid('tenant_id').notNull().references(() => tenants.id),
  moduleId:        uuid('module_id').notNull(),   // logical FK → modules.id
  patternCode:     text('pattern_code').notNull(),
  description:     text('description'),
  componentSchema: jsonb('component_schema').$type<Array<Record<string, unknown>>>(),
});

export type AssessmentPattern    = typeof assessmentPatterns.$inferSelect;
export type NewAssessmentPattern = typeof assessmentPatterns.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bitemporal learning outcomes — attached to either a programme or a module
 * (never both; enforced by CHECK constraint in migration DDL).
 */
export const learningOutcomes = pgTable('learning_outcome', {
  ...bitemporalColumns,
  tenantId:    uuid('tenant_id').notNull().references(() => tenants.id),
  programmeId: uuid('programme_id'),   // nullable; exactly one of programme_id/module_id non-null
  moduleId:    uuid('module_id'),       // nullable
  outcomeCode: text('outcome_code').notNull(),
  description: text('description').notNull(),
});

export type LearningOutcome    = typeof learningOutcomes.$inferSelect;
export type NewLearningOutcome = typeof learningOutcomes.$inferInsert;
