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
  // BPR-D16 (Stage 6, migration 0004_business_process_foundations): optional bridge into the generic
  // regulatory_collection model; existing HESA-specific columns/routes are
  // unaffected.
  regulatoryCollectionId: uuid('regulatory_collection_id'),
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

export const ukviEngagementEvidenceSnapshots = pgTable('ukvi_engagement_evidence_snapshot', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  tenantId:            uuid('tenant_id').notNull().references(() => tenants.id),
  enrolmentId:         uuid('enrolment_id').notNull(),
  engagementAlertId:   uuid('engagement_alert_id').notNull(),
  policyVersionId:     uuid('policy_version_id').notNull(),
  evidenceWindowFrom:  timestamp('evidence_window_from', { withTimezone: true }).notNull(),
  evidenceWindowTo:    timestamp('evidence_window_to', { withTimezone: true }).notNull(),
  evidenceSummary:     jsonb('evidence_summary').notNull().$type<Record<string, unknown>>(),
  evidenceHash:        text('evidence_hash').notNull(),
  evidenceQualityCode: text('evidence_quality_code').notNull(),
  sourceRecordedAt:    timestamp('source_recorded_at', { withTimezone: true }).notNull(),
  createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:           text('created_by').notNull(),
});

export const ukviSponsorDecisions = pgTable('ukvi_sponsor_decision', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenantId:           uuid('tenant_id').notNull().references(() => tenants.id),
  enrolmentId:        uuid('enrolment_id').notNull(),
  evidenceSnapshotId: uuid('evidence_snapshot_id').notNull().references(() => ukviEngagementEvidenceSnapshots.id),
  outcomeCode:        text('outcome_code').notNull(),
  rationaleCode:      text('rationale_code').notNull(),
  guidanceVersion:    text('guidance_version').notNull(),
  statusCode:         text('status_code').notNull().default('pending-authorisation'),
  decidedAt:          timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  decidedBy:          text('decided_by').notNull(),
  authorisedAt:       timestamp('authorised_at', { withTimezone: true }),
  authorisedBy:       text('authorised_by'),
  externalReportId:   uuid('external_report_id').references(() => ukviAttendanceReports.id),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
  // BPR-D16 (Stage 6, migration 0004_business_process_foundations): optional bridge into the generic
  // regulatory_collection model.
  regulatoryCollectionId: uuid('regulatory_collection_id'),
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
export type UkviEngagementEvidenceSnapshot = typeof ukviEngagementEvidenceSnapshots.$inferSelect;
export type UkviSponsorDecision          = typeof ukviSponsorDecisions.$inferSelect;
export type OfsExtract                   = typeof ofsExtracts.$inferSelect;
export type FoiRequest                   = typeof foiRequests.$inferSelect;
export type FoiExtract                   = typeof foiExtracts.$inferSelect;
export type StudentRegulatoryProfile     = typeof studentRegulatoryProfiles.$inferSelect;

export type NewSlcNotification          = typeof slcNotifications.$inferInsert;
export type NewUkviCasRequest           = typeof ukviCasRequests.$inferInsert;
export type NewOfsExtract               = typeof ofsExtracts.$inferInsert;
export type NewFoiRequest               = typeof foiRequests.$inferInsert;
export type NewStudentRegulatoryProfile = typeof studentRegulatoryProfiles.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// BPR-D03 — CAS governance (Stage 1, migration 0004_business_process_foundations).
//
// ukvi_cas_request stays as-is: cas_case is a separate governed aggregate.
// Eligibility checks, assignment versions and sponsor report versions are
// the evidence/decision trail ukvi_cas_request never captured.

export const casCases = pgTable('cas_case', {
  ...bitemporalColumns,
  tenantId:           uuid('tenant_id').notNull().references(() => tenants.id),
  enrolmentId:        uuid('enrolment_id').notNull(),
  casReference:       text('cas_reference'),
  statusCode:         text('status_code').notNull().default('opened'),
  actorId:            text('actor_id').notNull(),
});

export type CasCase    = typeof casCases.$inferSelect;
export type NewCasCase = typeof casCases.$inferInsert;

export const casEligibilityChecks = pgTable('cas_eligibility_check', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        uuid('tenant_id').notNull().references(() => tenants.id),
  casCaseId:       uuid('cas_case_id').notNull(), // logical FK -> cas_case.id
  guidanceVersion: text('guidance_version').notNull(),
  checkTypeCode:   text('check_type_code').notNull(),
  resultCode:      text('result_code').notNull(),
  evidenceRef:     uuid('evidence_ref'), // FK -> case_evidence_reference.id, nullable
  checkedBy:       text('checked_by').notNull(),
  checkedAt:       timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CasEligibilityCheck    = typeof casEligibilityChecks.$inferSelect;
export type NewCasEligibilityCheck = typeof casEligibilityChecks.$inferInsert;

export const casAssignmentVersions = pgTable('cas_assignment_version', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  tenantId:            uuid('tenant_id').notNull().references(() => tenants.id),
  casCaseId:           uuid('cas_case_id').notNull(), // logical FK -> cas_case.id
  versionNumber:       integer('version_number').notNull(),
  assignedPayloadHash: text('assigned_payload_hash').notNull(),
  casNumber:           text('cas_number'),
  approvedBy:          text('approved_by').notNull(),
  approvedAt:          timestamp('approved_at', { withTimezone: true }).notNull().defaultNow(),
  smsRequestSentAt:    timestamp('sms_request_sent_at', { withTimezone: true }),
  smsReceiptRef:       text('sms_receipt_ref'),
});

export type CasAssignmentVersion    = typeof casAssignmentVersions.$inferSelect;
export type NewCasAssignmentVersion = typeof casAssignmentVersions.$inferInsert;

export const sponsorReportVersions = pgTable('sponsor_report_version', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenantId:           uuid('tenant_id').notNull().references(() => tenants.id),
  casCaseId:          uuid('cas_case_id').notNull(), // logical FK -> cas_case.id
  reportPayloadRef:   text('report_payload_ref').notNull(),
  distributionItemId: uuid('distribution_item_id'), // FK -> distribution_item.id, nullable
  generatedAt:        timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  generatedBy:        text('generated_by').notNull(),
});

export type SponsorReportVersion    = typeof sponsorReportVersions.$inferSelect;
export type NewSponsorReportVersion = typeof sponsorReportVersions.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// BPR-D16 — regulatory collection & lineage (Stage 6, migration 0004_business_process_foundations).
//
// hesa_student_return/ofs_extract keep their bespoke tables and routes;
// regulatory_collection is a regulator-neutral parent every return can
// optionally bridge into via a nullable FK, so SFC/Medr/DfE-NI collections
// use one generic model instead of three more bespoke table sets.

export const regulatoryCollections = pgTable('regulatory_collection', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        uuid('tenant_id').notNull().references(() => tenants.id),
  regulatorCode:   text('regulator_code').notNull(), // HESA | OFS | SFC | MEDR | DFE-NI
  collectionTypeCode: text('collection_type_code').notNull(),
  academicYear:    text('academic_year').notNull(),
  statusCode:      text('status_code').notNull().default('draft'),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:       text('created_by').notNull(),
});

export type RegulatoryCollection    = typeof regulatoryCollections.$inferSelect;
export type NewRegulatoryCollection = typeof regulatoryCollections.$inferInsert;

export const collectionSnapshots = pgTable('collection_snapshot', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  tenantId:             uuid('tenant_id').notNull().references(() => tenants.id),
  regulatoryCollectionId: uuid('regulatory_collection_id').notNull(),
  snapshotVersion:      integer('snapshot_version').notNull().default(1),
  sourceTransactionTime: timestamp('source_transaction_time', { withTimezone: true }).notNull(),
  generatedAt:          timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  generatedBy:          text('generated_by').notNull(),
});

export type CollectionSnapshot    = typeof collectionSnapshots.$inferSelect;
export type NewCollectionSnapshot = typeof collectionSnapshots.$inferInsert;

export const regulatoryRecords = pgTable('regulatory_record', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenantId:           uuid('tenant_id').notNull().references(() => tenants.id),
  collectionSnapshotId: uuid('collection_snapshot_id').notNull(),
  enrolmentId:        uuid('enrolment_id'),
  recordPayload:      jsonb('record_payload').notNull().$type<Record<string, unknown>>(),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type RegulatoryRecord    = typeof regulatoryRecords.$inferSelect;
export type NewRegulatoryRecord = typeof regulatoryRecords.$inferInsert;

export const regulatoryFieldLineages = pgTable('regulatory_field_lineage', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenantId:           uuid('tenant_id').notNull().references(() => tenants.id),
  regulatoryRecordId: uuid('regulatory_record_id').notNull(),
  fieldCode:          text('field_code').notNull(),
  sourceEntityType:   text('source_entity_type').notNull(),
  sourceEntityId:     uuid('source_entity_id').notNull(),
  sourceVersionId:    uuid('source_version_id'),
  transformCode:      text('transform_code'), // identity | derived | aggregated
});

export type RegulatoryFieldLineage    = typeof regulatoryFieldLineages.$inferSelect;
export type NewRegulatoryFieldLineage = typeof regulatoryFieldLineages.$inferInsert;

export const regulatoryValidationIssues = pgTable('regulatory_validation_issue', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  tenantId:              uuid('tenant_id').notNull().references(() => tenants.id),
  regulatoryCollectionId: uuid('regulatory_collection_id').notNull(),
  regulatoryRecordId:    uuid('regulatory_record_id'),
  severityCode:          text('severity_code').notNull(), // blocking | warning
  fieldCode:             text('field_code'),
  message:               text('message').notNull(),
  createdAt:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type RegulatoryValidationIssue    = typeof regulatoryValidationIssues.$inferSelect;
export type NewRegulatoryValidationIssue = typeof regulatoryValidationIssues.$inferInsert;

export const regulatorySignoffs = pgTable('regulatory_signoff', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  tenantId:              uuid('tenant_id').notNull().references(() => tenants.id),
  regulatoryCollectionId: uuid('regulatory_collection_id').notNull(),
  signedOffBy:           text('signed_off_by').notNull(),
  signedOffAt:           timestamp('signed_off_at', { withTimezone: true }).notNull().defaultNow(),
  commentary:            text('commentary'),
});

export type RegulatorySignoff    = typeof regulatorySignoffs.$inferSelect;
export type NewRegulatorySignoff = typeof regulatorySignoffs.$inferInsert;

export const regulatorySubmissions = pgTable('regulatory_submission', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  tenantId:              uuid('tenant_id').notNull().references(() => tenants.id),
  regulatoryCollectionId: uuid('regulatory_collection_id').notNull(),
  collectionSnapshotId:  uuid('collection_snapshot_id').notNull(),
  distributionItemId:    uuid('distribution_item_id'), // FK -> distribution_item.id, nullable
  submittedAt:           timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  submittedBy:           text('submitted_by').notNull(),
  submissionReference:   text('submission_reference'),
});

export type RegulatorySubmission    = typeof regulatorySubmissions.$inferSelect;
export type NewRegulatorySubmission = typeof regulatorySubmissions.$inferInsert;
