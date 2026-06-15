import { boolean, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { w } from './wellbeing-case.js';

/**
 * Mental health case — bitemporal. Tracks the W004 workflow lifecycle.
 *
 * Highly sensitive special-category health data. Bitemporal to support
 * retrospective audit by authorised personnel only. Access controlled by
 * `wellbeing-mental-health-advisor` role; never exposed to general advisors.
 *
 * The consent record is embedded as a boolean + date rather than a
 * separate table to keep the row self-contained for export/redaction.
 */
export const mentalHealthCases = w.table('mental_health_case', {
  versionId:             uuid('version_id').primaryKey().defaultRandom(),
  id:                    uuid('id').notNull(),
  tenantId:              uuid('tenant_id').notNull(),
  wellbeingCaseId:       uuid('wellbeing_case_id').notNull(),
  personId:              uuid('person_id').notNull(),
  presentingConcernCode: text('presenting_concern_code').notNull(), // anxiety | depression | crisis | other
  statusCode:            text('status_code').notNull(),              // referral_received | assessment_pending | active | on_hold | discharged | closed
  riskLevelCode:         text('risk_level_code').notNull().default('low'), // low | medium | high | crisis
  consentGiven:          boolean('consent_given').notNull().default(false),
  consentDate:           timestamp('consent_date', { withTimezone: true }),
  actorId:               text('actor_id').notNull(),
  validFrom:             timestamp('valid_from',    { withTimezone: true }).notNull(),
  validTo:               timestamp('valid_to',      { withTimezone: true }),
  recordedAt:            timestamp('recorded_at',   { withTimezone: true }).notNull().defaultNow(),
  recordedUntil:         timestamp('recorded_until',{ withTimezone: true }),
});

export type MentalHealthCase    = typeof mentalHealthCases.$inferSelect;
export type NewMentalHealthCase = typeof mentalHealthCases.$inferInsert;

// ---------------------------------------------------------------------------

/**
 * Intervention plan — bitemporal.
 *
 * Records a structured support plan: goals, frequency, assigned practitioner.
 * Plans evolve over the course of support; bitemporality preserves the full
 * history of what was agreed at each stage for continuity and audit.
 */
export const interventionPlans = w.table('intervention_plan', {
  versionId:             uuid('version_id').primaryKey().defaultRandom(),
  id:                    uuid('id').notNull(),
  tenantId:              uuid('tenant_id').notNull(),
  mentalHealthCaseId:    uuid('mental_health_case_id').notNull(),
  personId:              uuid('person_id').notNull(),
  planTypeCode:          text('plan_type_code').notNull(),          // counselling | crisis-support | signposting | peer-support
  statusCode:            text('status_code').notNull(),             // draft | active | completed | discontinued
  practitionerId:        text('practitioner_id').notNull(),
  sessionFrequencyCode:  text('session_frequency_code'),            // weekly | fortnightly | monthly | ad-hoc
  plannedSessionCount:   text('planned_session_count'),
  goals:                 jsonb('goals').notNull().default([]),
  externalReferral:      boolean('external_referral').notNull().default(false),
  externalReferralDetails: text('external_referral_details'),
  reviewDate:            timestamp('review_date', { withTimezone: true }),
  actorId:               text('actor_id').notNull(),
  validFrom:             timestamp('valid_from',    { withTimezone: true }).notNull(),
  validTo:               timestamp('valid_to',      { withTimezone: true }),
  recordedAt:            timestamp('recorded_at',   { withTimezone: true }).notNull().defaultNow(),
  recordedUntil:         timestamp('recorded_until',{ withTimezone: true }),
});

export type InterventionPlan    = typeof interventionPlans.$inferSelect;
export type NewInterventionPlan = typeof interventionPlans.$inferInsert;

// ---------------------------------------------------------------------------

/**
 * MH session note — append-only.
 *
 * Stores clinical session notes written by the treating practitioner.
 * This is special-category health data under UK GDPR Art. 9 and the
 * Equality Act 2010. Content must never appear in NATS events, SRS APIs,
 * or aggregate reporting responses — only authorised mental health advisors
 * may read or write this table.
 */
export const mhSessionNotes = w.table('mh_session_note', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenantId:           uuid('tenant_id').notNull(),
  mentalHealthCaseId: uuid('mental_health_case_id').notNull(),
  personId:           uuid('person_id').notNull(),
  practitionerId:     text('practitioner_id').notNull(),
  sessionDate:        timestamp('session_date', { withTimezone: true }).notNull(),
  sessionTypeCode:    text('session_type_code').notNull(), // individual | group | telephone | crisis | assessment
  content:            text('content').notNull(),
  actorId:            text('actor_id').notNull(),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type MhSessionNote    = typeof mhSessionNotes.$inferSelect;
export type NewMhSessionNote = typeof mhSessionNotes.$inferInsert;
