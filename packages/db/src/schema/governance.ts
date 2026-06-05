import { integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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
  meetingDate:      text('meeting_date'),              // ISO date string
  ratifiedAt:       timestamp('ratified_at', { withTimezone: true }),
  actorId:          text('actor_id').notNull(),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
