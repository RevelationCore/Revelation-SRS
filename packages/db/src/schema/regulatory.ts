import { boolean, date, integer, jsonb, numeric, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';

import { bitemporalColumns } from '../temporal.js';

import { academicPeriods } from './calendar.js';
import { persons } from './identity.js';
import { integrationExchanges } from './integration.js';
import { tenants } from './tenant.js';

export const ucasApplications = pgTable('ucas_application', {
  ...bitemporalColumns,
  tenantId:          uuid('tenant_id').notNull().references(() => tenants.id),
  ucasPersonalId:    text('ucas_personal_id').notNull(),
  cycle:             text('cycle').notNull(),
  statusCode:        text('status_code').notNull(),
  linkedEnrolmentId: uuid('linked_enrolment_id'), // logical FK -> enrolment.id
  rawPayload:        jsonb('raw_payload').notNull().$type<Record<string, unknown>>().default({}),
  receivedAt:        timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});

export type UcasApplication    = typeof ucasApplications.$inferSelect;
export type NewUcasApplication = typeof ucasApplications.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

export const hesaStudentReturns = pgTable('hesa_student_return', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  tenantId:            uuid('tenant_id').notNull().references(() => tenants.id),
  academicYear:        text('academic_year').notNull(),
  statusCode:          text('status_code').notNull().default('draft'),
  submittedAt:         timestamp('submitted_at', { withTimezone: true }),
  validatedAt:         timestamp('validated_at', { withTimezone: true }),
  submissionReference: text('submission_reference'),
  amendmentOfId:       uuid('amendment_of_id'),
  generatedBy:         text('generated_by').notNull(),
  generatedAt:         timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type HesaStudentReturn    = typeof hesaStudentReturns.$inferSelect;
export type NewHesaStudentReturn = typeof hesaStudentReturns.$inferInsert;

export const hesaStudentReturnRecords = pgTable('hesa_student_return_record', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  hesaStudentReturnId: uuid('hesa_student_return_id').notNull().references(() => hesaStudentReturns.id),
  enrolmentId:         uuid('enrolment_id').notNull(), // logical FK -> enrolment.id
  hesaId:              text('hesa_id'),
  recordPayload:       jsonb('record_payload').notNull().$type<Record<string, unknown>>().default({}),
  amendmentDiff:       jsonb('amendment_diff').$type<Record<string, { previous: unknown; current: unknown }> | null>(),
  createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const hesaSubmissions = pgTable('hesa_submission', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  hesaStudentReturnId:   uuid('hesa_student_return_id').notNull().references(() => hesaStudentReturns.id),
  integrationExchangeId: uuid('integration_exchange_id').notNull().references(() => integrationExchanges.id),
  payloadHash:           text('payload_hash').notNull(),
  payloadSummary:        jsonb('payload_summary').notNull().$type<Record<string, unknown>>().default({}),
  generatedAt:           timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  generatedBy:           text('generated_by').notNull(),
  submittedAt:           timestamp('submitted_at', { withTimezone: true }),
  submissionReference:   text('submission_reference'),
});

export const hesaValidationReports = pgTable('hesa_validation_report', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  hesaStudentReturnId:   uuid('hesa_student_return_id').notNull().references(() => hesaStudentReturns.id),
  integrationExchangeId: uuid('integration_exchange_id').references(() => integrationExchanges.id),
  sourceCode:            text('source_code').notNull().default('internal'), // 'internal' | 'hesa-authority'
  receivedAt:            timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  receivedBy:            text('received_by').notNull(),
  rawPayload:            jsonb('raw_payload').notNull().$type<Record<string, unknown>>().default({}),
  blockingErrorCount:    integer('blocking_error_count').notNull().default(0),
  warningCount:          integer('warning_count').notNull().default(0),
});

export const hesaValidationIssues = pgTable('hesa_validation_issue', {
  id:                        uuid('id').primaryKey().defaultRandom(),
  hesaValidationReportId:    uuid('hesa_validation_report_id').notNull().references(() => hesaValidationReports.id),
  hesaStudentReturnRecordId: uuid('hesa_student_return_record_id').references(() => hesaStudentReturnRecords.id),
  enrolmentId:               uuid('enrolment_id'),
  fieldCode:                 text('field_code').notNull(),
  severityCode:              text('severity_code').notNull(),
  message:                   text('message').notNull(),
  externalReference:         text('external_reference'),
  createdAt:                 timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const hesaIdentifierAssignments = pgTable('hesa_identifier_assignment', {
  id:                        uuid('id').primaryKey().defaultRandom(),
  hesaStudentReturnId:       uuid('hesa_student_return_id').notNull().references(() => hesaStudentReturns.id),
  hesaStudentReturnRecordId: uuid('hesa_student_return_record_id').notNull().references(() => hesaStudentReturnRecords.id),
  personId:                  uuid('person_id').notNull().references(() => persons.id),
  enrolmentId:               uuid('enrolment_id').notNull(), // logical FK -> enrolment.id
  hesaId:                    text('hesa_id').notNull(),
  assignedAt:                timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  assignedBy:                text('assigned_by').notNull(),
});

// ─────────────────────────────────────────────────────────────────────────────

export const slcNotifications = pgTable('slc_notification', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  tenantId:             uuid('tenant_id').notNull().references(() => tenants.id),
  enrolmentId:          uuid('enrolment_id').notNull(), // logical FK -> enrolment.id
  notificationTypeCode: text('notification_type_code').notNull(),
  effectiveDate:        date('effective_date').notNull(),
  amount:               numeric('amount', { precision: 12, scale: 2 }),
  rawPayload:           jsonb('raw_payload').notNull().$type<Record<string, unknown>>().default({}),
  receivedAt:           timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ukviCasRequests = pgTable('ukvi_cas_request', {
  ...bitemporalColumns,
  tenantId:     uuid('tenant_id').notNull().references(() => tenants.id),
  enrolmentId:  uuid('enrolment_id').notNull(), // logical FK -> enrolment.id
  casReference: text('cas_reference'),
  statusCode:   text('status_code').notNull(),
  requestedAt:  timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ukviAttendanceReports = pgTable('ukvi_attendance_report', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         uuid('tenant_id').notNull().references(() => tenants.id),
  academicPeriodId: uuid('academic_period_id').notNull().references(() => academicPeriods.id),
  submittedAt:      timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  reportPayload:    jsonb('report_payload').notNull().$type<Record<string, unknown>>().default({}),
  submittedBy:      text('submitted_by').notNull(),
});

export const ukviVisaStatuses = pgTable('ukvi_visa_status', {
  ...bitemporalColumns,
  tenantId:      uuid('tenant_id').notNull().references(() => tenants.id),
  enrolmentId:   uuid('enrolment_id').notNull(), // logical FK -> enrolment.id
  casReference:  text('cas_reference').notNull(),
  statusCode:    text('status_code').notNull(),
  effectiveDate: date('effective_date').notNull(),
  rawPayload:    jsonb('raw_payload').notNull().$type<Record<string, unknown>>().default({}),
});

export const ukviComplianceAlerts = pgTable('ukvi_compliance_alert', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      uuid('tenant_id').notNull().references(() => tenants.id),
  enrolmentId:   uuid('enrolment_id').notNull(), // logical FK -> enrolment.id
  casReference:  text('cas_reference'),
  alertTypeCode: text('alert_type_code').notNull(),
  triggeredAt:   timestamp('triggered_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt:    timestamp('resolved_at', { withTimezone: true }),
  resolvedBy:    text('resolved_by'),
});

// ─────────────────────────────────────────────────────────────────────────────

export const ofsExtracts = pgTable('ofs_extract', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        uuid('tenant_id').notNull().references(() => tenants.id),
  extractTypeCode: text('extract_type_code').notNull(),
  academicYear:    text('academic_year').notNull(),
  generatedAt:     timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  generatedBy:     text('generated_by').notNull(),
  recordCount:     integer('record_count').notNull().default(0),
  extractPayload:  jsonb('extract_payload').notNull().$type<Record<string, unknown>>().default({}),
  statusCode:      text('status_code').notNull().default('generated'),
});

export const foiRequests = pgTable('foi_request', {
  ...bitemporalColumns,
  tenantId:              uuid('tenant_id').notNull().references(() => tenants.id),
  requestReference:      text('request_reference').notNull(),
  receivedDate:          date('received_date').notNull(),
  statutoryDeadlineDate: date('statutory_deadline_date').notNull(),
  description:           text('description').notNull(),
  statusCode:            text('status_code').notNull(),
  legalBasis:            text('legal_basis'),
  closedAt:              timestamp('closed_at', { withTimezone: true }),
});

export const foiExtracts = pgTable('foi_extract', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      uuid('tenant_id').notNull().references(() => tenants.id),
  foiRequestId:  uuid('foi_request_id').notNull(), // logical FK -> foi_request.id
  generatedAt:   timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  generatedBy:   text('generated_by').notNull(),
  querySummary:  text('query_summary').notNull(),
  recordCount:   integer('record_count').notNull().default(0),
  extractPayload: jsonb('extract_payload').notNull().$type<Record<string, unknown>>().default({}),
});

export const studentRegulatoryProfiles = pgTable('student_regulatory_profile', {
  ...bitemporalColumns,
  tenantId:                 uuid('tenant_id').notNull().references(() => tenants.id),
  personId:                 uuid('person_id').notNull().references(() => persons.id),
  enrolmentId:              uuid('enrolment_id'), // logical FK -> enrolment.id
  ukviSponsorshipRequired:  boolean('ukvi_sponsorship_required').notNull().default(false),
  polar4Quintile:           integer('polar4_quintile'),
  imdDecile:                integer('imd_decile'),
  careExperienced:          boolean('care_experienced'),
  sourceSystem:             text('source_system').notNull(),
  actorId:                  text('actor_id').notNull(),
});

export type HesaStudentReturnRecord      = typeof hesaStudentReturnRecords.$inferSelect;
export type HesaSubmission               = typeof hesaSubmissions.$inferSelect;
export type HesaValidationReport         = typeof hesaValidationReports.$inferSelect;
export type HesaValidationIssue          = typeof hesaValidationIssues.$inferSelect;
export type HesaIdentifierAssignment     = typeof hesaIdentifierAssignments.$inferSelect;
export type SlcNotification              = typeof slcNotifications.$inferSelect;
export type UkviCasRequest               = typeof ukviCasRequests.$inferSelect;
export type UkviAttendanceReport         = typeof ukviAttendanceReports.$inferSelect;
export type UkviVisaStatus               = typeof ukviVisaStatuses.$inferSelect;
export type UkviComplianceAlert          = typeof ukviComplianceAlerts.$inferSelect;
export type OfsExtract                   = typeof ofsExtracts.$inferSelect;
export type FoiRequest                   = typeof foiRequests.$inferSelect;
export type FoiExtract                   = typeof foiExtracts.$inferSelect;
export type StudentRegulatoryProfile     = typeof studentRegulatoryProfiles.$inferSelect;

export type NewSlcNotification          = typeof slcNotifications.$inferInsert;
export type NewUkviCasRequest           = typeof ukviCasRequests.$inferInsert;
export type NewOfsExtract               = typeof ofsExtracts.$inferInsert;
export type NewFoiRequest               = typeof foiRequests.$inferInsert;
export type NewStudentRegulatoryProfile = typeof studentRegulatoryProfiles.$inferInsert;
