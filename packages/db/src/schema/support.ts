import { date, integer, jsonb, numeric, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';

import { tenants } from './tenant.js';

/** Student support awards and their instalment schedules (migration 0032). */
export const supportAwards = pgTable('support_award', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       uuid('tenant_id').notNull().references(() => tenants.id),
  personId:       uuid('person_id').notNull(),
  enrolmentId:    uuid('enrolment_id').notNull(),
  awardTypeCode:  text('award_type_code').notNull(),
  awardReference: text('award_reference').notNull(),
  funder:         text('funder').notNull(),
  startDate:      date('start_date').notNull(),
  endDate:        date('end_date'),
  statusCode:     text('status_code').notNull().default('draft'), // draft | approved | suspended | ended
  createdBy:      text('created_by').notNull(),
  approvedBy:     text('approved_by'),
  approvedAt:     timestamp('approved_at', { withTimezone: true }),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.tenantId, t.awardReference)]);

export const supportInstalments = pgTable('support_instalment', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         uuid('tenant_id').notNull().references(() => tenants.id),
  awardId:          uuid('award_id').notNull().references(() => supportAwards.id),
  paymentTypeCode:  text('payment_type_code').notNull(),
  currencyCode:     text('currency_code').notNull().default('GBP'),
  amountMinorUnits: integer('amount_minor_units').notNull(),
  periodStart:      date('period_start').notNull(),
  periodEnd:        date('period_end').notNull(),
  dueDate:          date('due_date').notNull(),
  statusCode:       text('status_code').notNull().default('planned'), // planned | approved | paid | rejected | cancelled
  approvedBy:       text('approved_by'),
  approvedAt:       timestamp('approved_at', { withTimezone: true }),
  paymentReference: text('payment_reference'),
  paidOn:           date('paid_on'),
  paidAmountMinorUnits: integer('paid_amount_minor_units'),
  rejectionReason:  text('rejection_reason'),
  createdBy:        text('created_by').notNull(),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** What the SRS needs to know when a student is also employed — not the appointment itself. */
export const studentEmploymentLinks = pgTable('student_employment_link', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  tenantId:              uuid('tenant_id').notNull().references(() => tenants.id),
  personId:              uuid('person_id').notNull(),
  hrEmploymentReference: text('hr_employment_reference').notNull(),
  roleTypeCode:          text('role_type_code').notNull(),
  startDate:             date('start_date').notNull(),
  endDate:               date('end_date'),
  weeklyHours:           numeric('weekly_hours', { precision: 5, scale: 2 }).notNull(),
  moduleOfferingIds:     jsonb('module_offering_ids').notNull().$type<string[]>().default([]),
  supervisorAgreedAt:    timestamp('supervisor_agreed_at', { withTimezone: true }),
  sourceCode:            text('source_code').notNull(), // connector | person
  updatedBy:             text('updated_by').notNull(),
  createdAt:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.tenantId, t.hrEmploymentReference)]);

export const workLimitRules = pgTable('work_limit_rule', {
  tenantId:       uuid('tenant_id').notNull().references(() => tenants.id),
  ruleCode:       text('rule_code').notNull(),
  maxWeeklyHours: numeric('max_weekly_hours', { precision: 5, scale: 2 }).notNull(),
  description:    text('description'),
  updatedBy:      text('updated_by').notNull(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.ruleCode] })]);

export type SupportAward = typeof supportAwards.$inferSelect;
export type SupportInstalment = typeof supportInstalments.$inferSelect;
export type StudentEmploymentLink = typeof studentEmploymentLinks.$inferSelect;
