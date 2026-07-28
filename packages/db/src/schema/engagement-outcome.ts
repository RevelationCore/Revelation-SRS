import { boolean, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';

import { bitemporalColumns } from '../temporal.js';

import { tenants } from './tenant.js';

/**
 * Engagement outcome — bitemporal; the recorded operational effect of the
 * attendance module's evidence, policy evaluation, and intervention casework.
 *
 * The attendance module (modules/attendance) owns the case: expected events,
 * observations, alert evaluation, and intervention casework. It never writes
 * to SRS directly; it calls POST /students/:personId/engagement-outcomes,
 * and this table is SRS's authoritative record of the outcome, mirroring the
 * F063 reasonable-adjustment pattern.
 */
export const engagementOutcomes = pgTable('engagement_outcome', {
  ...bitemporalColumns,
  tenantId:             uuid('tenant_id').notNull().references(() => tenants.id),
  personId:             uuid('person_id').notNull(),
  enrolmentId:          uuid('enrolment_id').notNull(),
  moduleRegistrationId: uuid('module_registration_id'), // logical FK → module_registration.id; nullable until a real timetable exists
  outcomeCode:          text('outcome_code').notNull(), // at-risk | non-engagement | satisfactory | intervention-closed | referred-sponsor-compliance | ...
  severityCode:         text('severity_code'),
  sourceAlertId:        text('source_alert_id'), // attendance module's own alert/case id, for traceability only — not a physical FK
  sourceModule:         text('source_module').notNull().default('attendance'),
  actorId:              text('actor_id').notNull(),
  // Populated only for outcomeCode = 'referred-sponsor-compliance' — carries
  // exactly the evidence fields UKVI sponsor-compliance evidence-snapshot
  // creation needs (packages/db/src/schema/regulatory.ts:ukviEngagementEvidenceSnapshots),
  // since core no longer has a local join to the attendance module's own
  // alert/case/referral tables.
  policyVersionId:      uuid('policy_version_id'),
  evidenceWindowFrom:   timestamp('evidence_window_from', { withTimezone: true }),
  evidenceWindowTo:     timestamp('evidence_window_to', { withTimezone: true }),
  evidenceSnapshot:     jsonb('evidence_snapshot').$type<Record<string, unknown>>(),
  evidenceHash:         text('evidence_hash'),
  reevaluationRequired: boolean('reevaluation_required'),
});

export type EngagementOutcome    = typeof engagementOutcomes.$inferSelect;
export type NewEngagementOutcome = typeof engagementOutcomes.$inferInsert;
