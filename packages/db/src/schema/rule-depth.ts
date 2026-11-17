import { boolean, customType, integer, jsonb, pgTable, smallint, text, time, timestamp, uuid } from 'drizzle-orm/pg-core';

import { bitemporalColumns } from '../temporal.js';

import { academicPeriods, moduleSelectionWindows } from './calendar.js';
import { tenants } from './tenant.js';

const dateArray = customType<{ data: string[]; driverData: string | string[] }>({
  dataType: () => 'date[]',
  toDriver: (value) => `{${value.join(',')}}`,
  fromDriver: (value) => (Array.isArray(value) ? value : value.replace(/^\{|\}$/g, '').split(',').filter(Boolean)),
});

/**
 * Subject areas of a module, with a proportion (Phase 4 D-27), for
 * joint-honours balance. A module's current rows sum to 100.
 */
export const moduleSubjects = pgTable('module_subject', {
  ...bitemporalColumns,
  tenantId:          uuid('tenant_id').notNull().references(() => tenants.id),
  moduleId:          uuid('module_id').notNull(),
  subjectAreaCode:   text('subject_area_code').notNull(),
  proportionPercent: smallint('proportion_percent').notNull(),
});
export type ModuleSubject = typeof moduleSubjects.$inferSelect;

/**
 * One timetable received for an academic period (D-24): append-only, so
 * each clash decision can cite the publication it was made against.
 */
export const timetablePublications = pgTable('timetable_publication', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         uuid('tenant_id').notNull().references(() => tenants.id),
  academicPeriodId: uuid('academic_period_id').notNull().references(() => academicPeriods.id),
  sourceSystemCode: text('source_system_code').notNull(), // 'ttb' | 'srs-admin' | 'simulator'
  sourceVersion:    text('source_version').notNull(),
  fullPeriod:       boolean('full_period').notNull().default(false),
  statusCode:       text('status_code').notNull(),        // 'applied' | 'rejected'
  rejectionReasons: jsonb('rejection_reasons').$type<string[]>(),
  payloadHash:      text('payload_hash').notNull(),
  rowCount:         integer('row_count').notNull().default(0),
  receivedBy:       text('received_by').notNull(),
  receivedAt:       timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  appliedAt:        timestamp('applied_at', { withTimezone: true }),
});
export type TimetablePublication = typeof timetablePublications.$inferSelect;

export const timetableActivities = pgTable('timetable_activity', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         uuid('tenant_id').notNull().references(() => tenants.id),
  publicationId:    uuid('publication_id').notNull().references(() => timetablePublications.id),
  moduleOfferingId: uuid('module_offering_id').notNull(),
  activityRef:      text('activity_ref').notNull(),
  activityTypeCode: text('activity_type_code').notNull(),
  /** Activities of one offering sharing a group set are alternatives: the student attends one. */
  groupSetCode:     text('group_set_code'),
  groupCode:        text('group_code'),
});
export type TimetableActivity = typeof timetableActivities.$inferSelect;

export const timetableSlots = pgTable('timetable_slot', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       uuid('tenant_id').notNull().references(() => tenants.id),
  activityId:     uuid('activity_id').notNull().references(() => timetableActivities.id),
  dayOfWeek:      smallint('day_of_week').notNull(),   // ISO 1 (Monday) to 7
  startTime:      time('start_time').notNull(),
  endTime:        time('end_time').notNull(),
  /** The Monday of each week the slot runs. */
  weekCommencing: dateArray('week_commencing').notNull(),
  locationRef:    text('location_ref'),
});
export type TimetableSlot = typeof timetableSlots.$inferSelect;

/** A ranked-preference allocation run for one selection window (D-30). */
export const moduleAllocationRuns = pgTable('module_allocation_run', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenantId:           uuid('tenant_id').notNull().references(() => tenants.id),
  windowId:           uuid('window_id').notNull().references(() => moduleSelectionWindows.id),
  kindCode:           text('kind_code').notNull().default('main'),        // 'main' | 'top-up'
  statusCode:         text('status_code').notNull().default('previewed'), // previewed | submitted | approved | applied | superseded | rejected
  algorithmVersion:   text('algorithm_version').notNull().default('rsd-1'),
  priorityOrder:      jsonb('priority_order').notNull().$type<string[]>(),
  inputsHash:         text('inputs_hash').notNull(),
  summary:            jsonb('summary').$type<Record<string, unknown>>(),
  workflowInstanceId: uuid('workflow_instance_id'),
  createdBy:          text('created_by').notNull(),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  submittedBy:        text('submitted_by'),
  approvedBy:         text('approved_by'),
  appliedAt:          timestamp('applied_at', { withTimezone: true }),
});
export type ModuleAllocationRun = typeof moduleAllocationRuns.$inferSelect;

export const moduleAllocationResults = pgTable('module_allocation_result', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        uuid('tenant_id').notNull().references(() => tenants.id),
  runId:           uuid('run_id').notNull().references(() => moduleAllocationRuns.id),
  proposalId:      uuid('proposal_id').notNull(),
  choiceSlot:      smallint('choice_slot'),
  allocatedItemId: uuid('allocated_item_id'),
  outcomeCode:     text('outcome_code').notNull(), // 'allocated' | 'unallocated' | 'fixed'
  orderPosition:   integer('order_position').notNull(),
  tier:            integer('tier').notNull().default(0),
  reason:          text('reason'),
});
export type ModuleAllocationResult = typeof moduleAllocationResults.$inferSelect;

