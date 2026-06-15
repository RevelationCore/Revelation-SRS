import { jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const w = pgSchema('wellbeing');

/**
 * Top-level wellbeing case — one per student engagement with the service.
 * Links all Wellbeing domain records (disability, adjustment, EC, mental health)
 * for a given student. Not bitemporal: status is mutable; history is audited.
 */
export const wellbeingCases = w.table('wellbeing_case', {
  id:                      uuid('id').primaryKey().defaultRandom(),
  tenantId:                uuid('tenant_id').notNull(),
  personId:                uuid('person_id').notNull(),
  caseRef:                 text('case_ref').notNull(),
  statusCode:              text('status_code').notNull().default('active'), // active | closed | archived
  openedAt:                timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt:                timestamp('closed_at', { withTimezone: true }),
  assignedAdvisorId:       text('assigned_advisor_id'),
  notes:                   text('notes'),
  lawfulBasisCode:         text('lawful_basis_code').notNull().default('gdpr-art6-e'),
  dataClassificationCode:  text('data_classification_code').notNull().default('standard'),
  retentionDueDate:        timestamp('retention_due_date', { withTimezone: true }),
  createdAt:               timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:               timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type WellbeingCase    = typeof wellbeingCases.$inferSelect;
export type NewWellbeingCase = typeof wellbeingCases.$inferInsert;

// ---------------------------------------------------------------------------

/**
 * SRS context projection — mutable read-model maintained from SRS events.
 * One row per person per tenant. Not authoritative; replayed from event log.
 * Never written to SRS; never published in SRS events.
 */
export const srsContextProjections = w.table('srs_context_projection', {
  id:                        uuid('id').primaryKey().defaultRandom(),
  tenantId:                  uuid('tenant_id').notNull(),
  personId:                  uuid('person_id').notNull(),
  personData:                jsonb('person_data').notNull().default({}),
  activeEnrolmentIds:        jsonb('active_enrolment_ids').notNull().default([]),
  activeModuleCodes:         jsonb('active_module_codes').notNull().default([]),
  disabilityDeclarationStatus: text('disability_declaration_status'),
  latestMarks:               jsonb('latest_marks').notNull().default({}),
  enrolmentStatus:           text('enrolment_status'),
  lastEventOffset:           text('last_event_offset'),
  lastUpdatedAt:             timestamp('last_updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SrsContextProjection    = typeof srsContextProjections.$inferSelect;
export type NewSrsContextProjection = typeof srsContextProjections.$inferInsert;

// ---------------------------------------------------------------------------

/**
 * Early warning alert — append-only record of an inbound alert signal.
 * No clinical content; triage status links to a mental health case.
 */
export const earlyWarningAlerts = w.table('early_warning_alert', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  tenantId:            uuid('tenant_id').notNull(),
  personId:            uuid('person_id').notNull(),
  alertTypeCode:       text('alert_type_code').notNull(), // ukvi-compliance | tutor-concern | staff-referral
  alertSourceCode:     text('alert_source_code').notNull(), // ukvi | tutor | staff | system
  sourceEventSubject:  text('source_event_subject'),
  sourceEventId:       text('source_event_id'),
  triageStatusCode:    text('triage_status_code').notNull().default('pending'), // pending | reviewed | assigned | resolved | dismissed
  assignedCaseId:      uuid('assigned_case_id'),
  alertPayload:        jsonb('alert_payload').notNull().default({}),
  receivedAt:          timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  triagedBy:           text('triaged_by'),
  triagedAt:           timestamp('triaged_at', { withTimezone: true }),
  createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type EarlyWarningAlert    = typeof earlyWarningAlerts.$inferSelect;
export type NewEarlyWarningAlert = typeof earlyWarningAlerts.$inferInsert;

// ---------------------------------------------------------------------------

/**
 * SAR export log — append-only record of each Subject Access Request export.
 * Provides an audit trail for GDPR Art. 15 compliance.
 */
export const sarExportLogs = w.table('sar_export_log', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  tenantId:             uuid('tenant_id').notNull(),
  exportedForPersonId:  uuid('exported_for_person_id').notNull(),
  requestedByActorId:   text('requested_by_actor_id').notNull(),
  exportedAt:           timestamp('exported_at', { withTimezone: true }).notNull().defaultNow(),
  recordCounts:         jsonb('record_counts').notNull().default({}),
});

export type SarExportLog    = typeof sarExportLogs.$inferSelect;
export type NewSarExportLog = typeof sarExportLogs.$inferInsert;
