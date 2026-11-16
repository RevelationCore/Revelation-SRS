import { date, integer, jsonb, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenant.js';

/** A versioned curriculum release from the curriculum system (BPR-D05; BP-03-001). */
export const curriculumPublications = pgTable('curriculum_publication', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  tenantId:             uuid('tenant_id').notNull().references(() => tenants.id),
  sourceSystemCode:     text('source_system_code').notNull(),
  sourcePublicationRef: text('source_publication_ref').notNull(),
  publicationVersion:   text('publication_version').notNull(),
  approvalRef:          text('approval_ref'),
  effectiveFrom:        date('effective_from').notNull(),
  correctionRationale:  text('correction_rationale'),
  statusCode:           text('status_code').notNull(), // validated | rejected | applied
  addedCount:           integer('added_count').notNull().default(0),
  changedCount:         integer('changed_count').notNull().default(0),
  closedCount:          integer('closed_count').notNull().default(0),
  unchangedCount:       integer('unchanged_count').notNull().default(0),
  rejectedCount:        integer('rejected_count').notNull().default(0),
  payloadHash:          text('payload_hash').notNull(),
  receivedBy:           text('received_by').notNull(),
  receivedAt:           timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  appliedBy:            text('applied_by'),
  appliedAt:            timestamp('applied_at', { withTimezone: true }),
});

export type CurriculumPublication = typeof curriculumPublications.$inferSelect;

export const curriculumPublicationItems = pgTable('curriculum_publication_item', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        uuid('tenant_id').notNull().references(() => tenants.id),
  publicationId:   uuid('publication_id').notNull().references(() => curriculumPublications.id),
  objectTypeCode:  text('object_type_code').notNull(), // programme | module
  objectCode:      text('object_code').notNull(),
  sourceReference: text('source_reference'),
  changeTypeCode:  text('change_type_code').notNull(), // add | change | close | unchanged | invalid
  payload:         jsonb('payload').notNull().$type<Record<string, unknown>>(),
  issue:           text('issue'),
  appliedEntityId: uuid('applied_entity_id'),
});

export type CurriculumPublicationItem = typeof curriculumPublicationItems.$inferSelect;

/** Credit a student brings in or is exempted from (prior learning, transfer). */
export const recognisedCredits = pgTable('recognised_credit', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  tenantId:            uuid('tenant_id').notNull().references(() => tenants.id),
  enrolmentId:         uuid('enrolment_id').notNull(),
  recognitionTypeCode: text('recognition_type_code').notNull(),
  sourceDescription:   text('source_description').notNull(),
  creditValue:         smallint('credit_value').notNull(),
  fheqLevel:           smallint('fheq_level'),
  academicYear:        text('academic_year'), // the year whose progression it counts towards; null = award only
  moduleId:            uuid('module_id'),
  statusCaseId:        uuid('status_case_id'),
  evidenceRef:         text('evidence_ref'),
  statusCode:          text('status_code').notNull().default('proposed'), // proposed | approved | rejected
  createdBy:           text('created_by').notNull(),
  createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  decidedBy:           text('decided_by'),
  decidedAt:           timestamp('decided_at', { withTimezone: true }),
  decisionReason:      text('decision_reason'),
});

export type RecognisedCredit = typeof recognisedCredits.$inferSelect;

/** An authorised, time-bound waiver or variation of a programme rule for one student. */
export const ruleExceptions = pgTable('rule_exception', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenantId:           uuid('tenant_id').notNull().references(() => tenants.id),
  enrolmentId:        uuid('enrolment_id').notNull(),
  programmeRuleSetId: uuid('programme_rule_set_id'),
  ruleCode:           text('rule_code').notNull(),
  exceptionTypeCode:  text('exception_type_code').notNull(),
  description:        text('description').notNull(),
  validFrom:          date('valid_from').notNull(),
  validTo:            date('valid_to'),
  authorityRef:       text('authority_ref'),
  variationValue:     jsonb('variation_value').$type<Record<string, unknown>>(), // the replacement rule value; null for a waiver
  statusCode:         text('status_code').notNull().default('proposed'), // proposed | approved | rejected | revoked
  createdBy:          text('created_by').notNull(),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  decidedBy:          text('decided_by'),
  decidedAt:          timestamp('decided_at', { withTimezone: true }),
  decisionReason:     text('decision_reason'),
});

export type RuleException = typeof ruleExceptions.$inferSelect;
