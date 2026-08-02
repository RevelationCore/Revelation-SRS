import { boolean, integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';

import { tenants } from './tenant.js';

/**
 * Exam board — the governing body that ratifies module results and awards.
 *
 * ratified_at is set by ratifyBoard; once set the board is immutable and all
 * covered module results and marks are locked.
 */
export const examBoards = pgTable('exam_board', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         uuid('tenant_id').notNull().references(() => tenants.id),
  boardTypeCode:    text('board_type_code').notNull(), // module | award
  academicYear:     text('academic_year').notNull(),   // e.g. '2025-26'
  academicPeriodId: uuid('academic_period_id'),        // FK to academic_period.id (logical); null for award boards
  meetingDate:       text('meeting_date'),              // ISO date string
  ratifiedAt:        timestamp('ratified_at',        { withTimezone: true }),
  deferredAt:        timestamp('deferred_at',         { withTimezone: true }),
  deferralReason:    text('deferral_reason'),
  quorumCount:       integer('quorum_count'),
  quorumRecordedAt:  timestamp('quorum_recorded_at', { withTimezone: true }),
  actorId:           text('actor_id').notNull(),
  createdAt:         timestamp('created_at',          { withTimezone: true }).notNull().defaultNow(),
});

export type ExamBoard    = typeof examBoards.$inferSelect;
export type NewExamBoard = typeof examBoards.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Exam board data pack — point-in-time snapshot artefact.
 *
 * Regeneration creates a new row with an incremented pack_version and sets
 * only superseded_by_id on the previous pack. The snapshot payload remains
 * immutable; source_transaction_time enables exact reproduction of any
 * historical pack for audit purposes.
 *
 * Never mutate snapshot fields after creation.
 */
export const examBoardDataPacks = pgTable('exam_board_data_pack', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  tenantId:              uuid('tenant_id').notNull().references(() => tenants.id),
  examBoardId:           uuid('exam_board_id').notNull().references(() => examBoards.id),
  packVersion:           integer('pack_version').notNull().default(1),
  supersededById:        uuid('superseded_by_id'),  // self-FK; set when a newer pack is generated
  sourceTransactionTime: timestamp('source_transaction_time', { withTimezone: true }).notNull(),
  candidateCount:        integer('candidate_count').notNull().default(0),
  generatedAt:           timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  generatedBy:           text('generated_by').notNull(),
  // BPR-D11 (Stage 4, migration 0004_business_process_foundations): additive columns proving exactly which
  // pack content and rule set a board decision was based on.
  packHash:              text('pack_hash'),
  ruleManifestRef:       text('rule_manifest_ref'),
});

export type ExamBoardDataPack    = typeof examBoardDataPacks.$inferSelect;
export type NewExamBoardDataPack = typeof examBoardDataPacks.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Candidate profile — append-only per pack; full JSONB snapshot for one candidate.
 *
 * Immutable after creation. The JSONB document includes module results,
 * component marks, adjustment indicators, EC flags, misconduct flags, and
 * the pre-board classification recommendation.
 */
export const examBoardCandidateProfiles = pgTable('exam_board_candidate_profile', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull().references(() => tenants.id),
  dataPackId:   uuid('data_pack_id').notNull().references(() => examBoardDataPacks.id),
  enrolmentId:  uuid('enrolment_id').notNull(),
  personId:     uuid('person_id').notNull(),
  profileData:  jsonb('profile_data').notNull(),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ExamBoardCandidateProfile    = typeof examBoardCandidateProfiles.$inferSelect;
export type NewExamBoardCandidateProfile = typeof examBoardCandidateProfiles.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Board member attendance — append-only.
 */
export const examBoardMemberAttendance = pgTable('exam_board_member_attendance', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    uuid('tenant_id').notNull().references(() => tenants.id),
  examBoardId: uuid('exam_board_id').notNull().references(() => examBoards.id),
  actorId:     text('actor_id').notNull(),
  roleCode:    text('role_code').notNull(),  // e.g. chair | member | observer
  attendedAt:  timestamp('attended_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ExamBoardMemberAttendance    = typeof examBoardMemberAttendance.$inferSelect;
export type NewExamBoardMemberAttendance = typeof examBoardMemberAttendance.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * External examiner sign-off — append-only; prerequisite for ratification.
 */
export const externalExaminerSignoffs = pgTable('external_examiner_signoff', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    uuid('tenant_id').notNull().references(() => tenants.id),
  examBoardId: uuid('exam_board_id').notNull().references(() => examBoards.id),
  actorId:     text('actor_id').notNull(),
  commentary:  text('commentary'),
  signedOffAt: timestamp('signed_off_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ExternalExaminerSignoff    = typeof externalExaminerSignoffs.$inferSelect;
export type NewExternalExaminerSignoff = typeof externalExaminerSignoffs.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// BPR-D11 — board authority & ratification (Stage 4, migration 0004_business_process_foundations).
//
// exam_board keeps its raw quorum_count/quorum_recorded_at pair for compat;
// board_quorum_decision is the real decision row. exam_board_decision and
// ratification_record turn ratifiedAt from a timestamp into an auditable
// decision chain; result_publication records the publication lock/lifecycle.

export const boardMemberConflicts = pgTable('board_member_conflict', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      uuid('tenant_id').notNull().references(() => tenants.id),
  examBoardId:   uuid('exam_board_id').notNull().references(() => examBoards.id),
  actorId:       text('actor_id').notNull(),
  enrolmentId:   uuid('enrolment_id'), // the candidate the conflict relates to, if candidate-specific
  conflictTypeCode: text('conflict_type_code').notNull(), // family | supervisory | financial | other
  declaredAt:    timestamp('declared_at', { withTimezone: true }).notNull().defaultNow(),
  recusedAt:     timestamp('recused_at', { withTimezone: true }),
});

export type BoardMemberConflict    = typeof boardMemberConflicts.$inferSelect;
export type NewBoardMemberConflict = typeof boardMemberConflicts.$inferInsert;

export const boardQuorumDecisions = pgTable('board_quorum_decision', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        uuid('tenant_id').notNull().references(() => tenants.id),
  examBoardId:     uuid('exam_board_id').notNull().references(() => examBoards.id),
  requiredCount:   integer('required_count').notNull(),
  attendingCount:  integer('attending_count').notNull(),
  quorumMet:       boolean('quorum_met').notNull(),
  decidedBy:       text('decided_by').notNull(),
  decidedAt:       timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
});

export type BoardQuorumDecision    = typeof boardQuorumDecisions.$inferSelect;
export type NewBoardQuorumDecision = typeof boardQuorumDecisions.$inferInsert;

export const examBoardDecisions = pgTable('exam_board_decision', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        uuid('tenant_id').notNull().references(() => tenants.id),
  examBoardId:     uuid('exam_board_id').notNull().references(() => examBoards.id),
  dataPackId:      uuid('data_pack_id').notNull().references(() => examBoardDataPacks.id),
  decisionTypeCode: text('decision_type_code').notNull(), // ratify | defer | refer-back
  decidedBy:       text('decided_by').notNull(),
  decidedAt:       timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  rationale:       text('rationale'),
});

export type ExamBoardDecision    = typeof examBoardDecisions.$inferSelect;
export type NewExamBoardDecision = typeof examBoardDecisions.$inferInsert;

export const ratificationRecords = pgTable('ratification_record', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       uuid('tenant_id').notNull().references(() => tenants.id),
  examBoardDecisionId: uuid('exam_board_decision_id').notNull().references(() => examBoardDecisions.id),
  examBoardId:    uuid('exam_board_id').notNull().references(() => examBoards.id),
  ratifiedAt:     timestamp('ratified_at', { withTimezone: true }).notNull().defaultNow(),
  ratifiedBy:     text('ratified_by').notNull(),
});

export type RatificationRecord    = typeof ratificationRecords.$inferSelect;
export type NewRatificationRecord = typeof ratificationRecords.$inferInsert;

export const resultPublications = pgTable('result_publication', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  tenantId:            uuid('tenant_id').notNull().references(() => tenants.id),
  ratificationRecordId: uuid('ratification_record_id').notNull().references(() => ratificationRecords.id),
  statusCode:          text('status_code').notNull().default('locked'), // locked | published | withdrawn
  publishedAt:         timestamp('published_at', { withTimezone: true }),
  publishedBy:         text('published_by'),
});

export type ResultPublication    = typeof resultPublications.$inferSelect;
export type NewResultPublication = typeof resultPublications.$inferInsert;
