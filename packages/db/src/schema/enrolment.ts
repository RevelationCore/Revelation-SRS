import { date, integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';

import { bitemporalColumns } from '../temporal.js';

import { persons } from './identity.js';
import { tenants } from './tenant.js';

/**
 * Bitemporal enrolment record — links a person to a programme for an academic year.
 *
 * Status transitions (enrolled → intermitting / withdrawn / suspended / graduated)
 * are recorded by closing the current row and inserting a new version, preserving
 * the full history of every status the enrolment passed through.
 *
 * programme_id is nullable to support pre-programme enrolment (e.g. Foundation
 * students whose programme is confirmed later) and direct enrolment records
 * created before the programme catalogue is fully populated.
 */
export const enrolments = pgTable('enrolment', {
  ...bitemporalColumns,
  tenantId:             uuid('tenant_id').notNull().references(() => tenants.id),
  personId:             uuid('person_id').notNull().references(() => persons.id),
  programmeId:          uuid('programme_id'),     // FK to programme.id (logical); nullable
  statusCode:           text('status_code').notNull().default('enrolled'),
  modeOfStudyCode:      text('mode_of_study_code').notNull(),  // 'full-time' | 'part-time' | 'distance' | 'sandwich'
  attendanceTypeCode:   text('attendance_type_code'),
  academicYearOfEntry:  text('academic_year_of_entry').notNull(),  // e.g. '2025-26'
  startDate:            date('start_date').notNull(),
  expectedEndDate:      date('expected_end_date'),
  actualEndDate:        date('actual_end_date'),
  feeBandCode:          text('fee_band_code'),
  fundingSourceCode:    text('funding_source_code'),
  slcReference:         text('slc_reference'),
  ucasPersonalId:       text('ucas_personal_id'),
});

export type Enrolment    = typeof enrolments.$inferSelect;
export type NewEnrolment = typeof enrolments.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Append-only transition ledger for enrolment status changes.
 *
 * The bitemporal enrolment table preserves the authoritative status history;
 * this ledger captures command context such as reason codes/text and actor.
 */
export const enrolmentStatusTransitions = pgTable('enrolment_status_transition', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       uuid('tenant_id').notNull().references(() => tenants.id),
  enrolmentId:    uuid('enrolment_id').notNull(),
  fromStatusCode: text('from_status_code').notNull(),
  toStatusCode:   text('to_status_code').notNull(),
  reasonCode:     text('reason_code'),
  reasonText:     text('reason_text'),
  effectiveAt:    timestamp('effective_at', { withTimezone: true }).notNull(),
  actorId:        text('actor_id').notNull(),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type EnrolmentStatusTransition = typeof enrolmentStatusTransitions.$inferSelect;
export type NewEnrolmentStatusTransition = typeof enrolmentStatusTransitions.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/** Fee liability generated as part of enrolment creation (F009). */
export const feeLiabilities = pgTable('fee_liability', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenantId:          uuid('tenant_id').notNull().references(() => tenants.id),
  enrolmentId:       uuid('enrolment_id').notNull(),
  personId:          uuid('person_id').notNull().references(() => persons.id),
  academicYear:      text('academic_year').notNull(),
  feeBandCode:       text('fee_band_code'),
  fundingSourceCode: text('funding_source_code'),
  amountPence:       integer('amount_pence'),
  statusCode:        text('status_code').notNull().default('generated'),
  generatedAt:       timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type FeeLiability = typeof feeLiabilities.$inferSelect;
export type NewFeeLiability = typeof feeLiabilities.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Downstream confirmation trigger ledger for UCAS, SLC, and UKVI events.
 * Concrete adapters in later phases consume the domain events and reconcile
 * against this durable intent log.
 */
export const enrolmentDownstreamTriggers = pgTable('enrolment_downstream_trigger', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       uuid('tenant_id').notNull().references(() => tenants.id),
  enrolmentId:    uuid('enrolment_id').notNull(),
  triggerTypeCode: text('trigger_type_code').notNull(),
  statusCode:     text('status_code').notNull().default('pending'),
  payloadSummary: jsonb('payload_summary').$type<Record<string, unknown>>(),
  correlationId:  uuid('correlation_id'),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt:         timestamp('sent_at', { withTimezone: true }),
});

export type EnrolmentDownstreamTrigger = typeof enrolmentDownstreamTriggers.$inferSelect;
export type NewEnrolmentDownstreamTrigger = typeof enrolmentDownstreamTriggers.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Annual re-enrolment window definition.
 * programme_id IS NULL means the window applies to all programmes in the tenant.
 */
export const reenrolmentPeriods = pgTable('reenrolment_period', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull().references(() => tenants.id),
  academicYear: text('academic_year').notNull(),
  programmeId:  uuid('programme_id'),
  opensAt:      timestamp('opens_at',   { withTimezone: true }).notNull(),
  closesAt:     timestamp('closes_at',  { withTimezone: true }).notNull(),
  reminderAt:   timestamp('reminder_at',{ withTimezone: true }),
});

export type ReenrolmentPeriod    = typeof reenrolmentPeriods.$inferSelect;
export type NewReenrolmentPeriod = typeof reenrolmentPeriods.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bitemporal re-enrolment confirmation per student per annual window.
 * Status tracks whether the student has confirmed continuation for the period.
 */
export const reenrolmentConfirmations = pgTable('reenrolment_confirmation', {
  ...bitemporalColumns,
  tenantId:            uuid('tenant_id').notNull().references(() => tenants.id),
  enrolmentId:         uuid('enrolment_id').notNull(),   // logical FK → enrolments.id
  reenrolmentPeriodId: uuid('reenrolment_period_id').notNull().references(() => reenrolmentPeriods.id),
  statusCode:          text('status_code').notNull().default('pending'),
  confirmedAt:         timestamp('confirmed_at', { withTimezone: true }),
});

export type ReenrolmentConfirmation    = typeof reenrolmentConfirmations.$inferSelect;
export type NewReenrolmentConfirmation = typeof reenrolmentConfirmations.$inferInsert;
