import { date, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';

import { bitemporalColumns } from '../temporal.js';

import { examBoards } from './governance.js';
import { tenants } from './tenant.js';

export const examEntries = pgTable('exam_entry', {
  ...bitemporalColumns,
  tenantId:             uuid('tenant_id').notNull().references(() => tenants.id),
  moduleRegistrationId: uuid('module_registration_id').notNull(), // logical FK -> module_registration.id
  examBoardId:          uuid('exam_board_id').notNull().references(() => examBoards.id),
  candidateNumber:      text('candidate_number'),
  scheduledDate:        date('scheduled_date'),
  roomReference:        text('room_reference'),
  statusCode:           text('status_code').notNull(),
  accommodations:       jsonb('accommodations').notNull().$type<Record<string, unknown>>().default({}),
});

export const examTimetableReceipts = pgTable('exam_timetable_receipt', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    uuid('tenant_id').notNull().references(() => tenants.id),
  examBoardId: uuid('exam_board_id').notNull().references(() => examBoards.id),
  receivedAt:  timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  receivedBy:  text('received_by').notNull(),
  payload:     jsonb('payload').notNull().$type<Record<string, unknown>>().default({}),
});

export type ExamEntry            = typeof examEntries.$inferSelect;
export type NewExamEntry         = typeof examEntries.$inferInsert;
export type ExamTimetableReceipt = typeof examTimetableReceipts.$inferSelect;
