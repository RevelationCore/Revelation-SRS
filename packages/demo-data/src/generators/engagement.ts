/**
 * Attendance/engagement generator — synthetic engagement scenario data for
 * the CI golden dataset.
 *
 * The attendance module uses its own PostgreSQL schema ('attendance') and
 * Drizzle table definitions separate from packages/db, on the same physical
 * database as core (see modules/attendance/src/db/schema). Rather than
 * importing the full @revelation-srs/attendance application package (which
 * carries Fastify, NATS, JWT as runtime deps), this defines minimal inline
 * Drizzle table stubs that mirror only the columns written here — the same
 * technique used by generators/wellbeing.ts for the wellbeing module.
 */

import { boolean, jsonb, pgSchema, text, timestamp, uuid, integer } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { Db } from '@revelation-srs/db';

import { GOLDEN_IDS } from '../golden-ids.js';
import { deterministicId } from './ids.js';

// ─── Minimal attendance schema stubs ──────────────────────────────────────────

const a = pgSchema('attendance');

const engagementPolicyVersionsTable = a.table('engagement_policy_version', {
  versionId:      uuid('version_id'),
  id:             uuid('id'),
  tenantId:       uuid('tenant_id'),
  policyCode:     text('policy_code'),
  versionNumber:  integer('version_number'),
  displayName:    text('display_name'),
  statusCode:     text('status_code'),
  applicability:  jsonb('applicability'),
  evidenceWindow: jsonb('evidence_window'),
  alertRules:     jsonb('alert_rules'),
  reviewDeadline: jsonb('review_deadline'),
  approvedBy:     text('approved_by'),
  approvedAt:     timestamp('approved_at', { withTimezone: true }),
  actorId:        text('actor_id'),
  validFrom:      timestamp('valid_from', { withTimezone: true }),
  recordedAt:     timestamp('recorded_at', { withTimezone: true }),
});

const expectedEngagementEventsTable = a.table('expected_engagement_event', {
  versionId:            uuid('version_id'),
  id:                   uuid('id'),
  tenantId:             uuid('tenant_id'),
  personId:             uuid('person_id'),
  enrolmentId:          uuid('enrolment_id'),
  moduleRegistrationId: uuid('module_registration_id'),
  activityTypeCode:     text('activity_type_code'),
  activityReference:    text('activity_reference'),
  eventModeCode:        text('event_mode_code'),
  scheduledFrom:        timestamp('scheduled_from', { withTimezone: true }),
  scheduledTo:          timestamp('scheduled_to', { withTimezone: true }),
  sourceSystemCode:     text('source_system_code'),
  sourceEventId:        text('source_event_id'),
  sourceVersion:        text('source_version'),
  statusCode:           text('status_code'),
  actorId:              text('actor_id'),
  validFrom:            timestamp('valid_from', { withTimezone: true }),
  recordedAt:           timestamp('recorded_at', { withTimezone: true }),
});

const engagementObservationsTable = a.table('engagement_observation', {
  versionId:         uuid('version_id'),
  id:                uuid('id'),
  tenantId:          uuid('tenant_id'),
  expectedEventId:   uuid('expected_event_id'),
  personId:          uuid('person_id'),
  enrolmentId:       uuid('enrolment_id'),
  sourceSystemCode:  text('source_system_code'),
  sourceEventId:     text('source_event_id'),
  sourceVersion:     text('source_version'),
  idempotencyKey:    text('idempotency_key'),
  captureMethodCode: text('capture_method_code'),
  outcomeCode:       text('outcome_code'),
  dataQualityCode:   text('data_quality_code'),
  eventTime:         timestamp('event_time', { withTimezone: true }),
  receivedAt:        timestamp('received_at', { withTimezone: true }),
  actorId:           text('actor_id'),
  validFrom:         timestamp('valid_from', { withTimezone: true }),
  recordedAt:        timestamp('recorded_at', { withTimezone: true }),
});

const engagementAlertsTable = a.table('engagement_alert', {
  versionId:            uuid('version_id'),
  id:                   uuid('id'),
  tenantId:             uuid('tenant_id'),
  personId:             uuid('person_id'),
  enrolmentId:          uuid('enrolment_id'),
  policyVersionId:      uuid('policy_version_id'),
  evidenceWindowFrom:   timestamp('evidence_window_from', { withTimezone: true }),
  evidenceWindowTo:     timestamp('evidence_window_to', { withTimezone: true }),
  evidenceSnapshot:     jsonb('evidence_snapshot'),
  evidenceHash:         text('evidence_hash'),
  explanation:          jsonb('explanation'),
  severityCode:         text('severity_code'),
  statusCode:           text('status_code'),
  reevaluationRequired: boolean('reevaluation_required'),
  actorId:              text('actor_id'),
  validFrom:            timestamp('valid_from', { withTimezone: true }),
  recordedAt:           timestamp('recorded_at', { withTimezone: true }),
});

const engagementInterventionCasesTable = a.table('engagement_intervention_case', {
  versionId:          uuid('version_id'),
  id:                 uuid('id'),
  tenantId:           uuid('tenant_id'),
  alertId:            uuid('alert_id'),
  personId:           uuid('person_id'),
  enrolmentId:        uuid('enrolment_id'),
  statusCode:         text('status_code'),
  assignedRoleCode:   text('assigned_role_code'),
  assignedActorId:    text('assigned_actor_id'),
  workflowInstanceId: uuid('workflow_instance_id'),
  correlationId:      uuid('correlation_id'),
  openedAt:           timestamp('opened_at', { withTimezone: true }),
  reviewAt:           timestamp('review_at', { withTimezone: true }),
  dueAt:              timestamp('due_at', { withTimezone: true }),
  actorId:            text('actor_id'),
  idempotencyKey:     text('idempotency_key'),
  validFrom:          timestamp('valid_from', { withTimezone: true }),
  recordedAt:         timestamp('recorded_at', { withTimezone: true }),
});

const engagementReferralsTable = a.table('engagement_referral', {
  id:                 uuid('id'),
  tenantId:           uuid('tenant_id'),
  interventionCaseId: uuid('intervention_case_id'),
  targetServiceCode:  text('target_service_code'),
  referralTypeCode:   text('referral_type_code'),
  statusCode:         text('status_code'),
  externalReference:  text('external_reference'),
  correlationId:      uuid('correlation_id'),
  referredBy:         text('referred_by'),
  referredAt:         timestamp('referred_at', { withTimezone: true }),
  idempotencyKey:     text('idempotency_key'),
});

// ─── Schema existence guard ────────────────────────────────────────────────────

export async function attendanceSchemaExists(db: Db): Promise<boolean> {
  const rows = await db.execute(
    sql`SELECT 1 FROM information_schema.schemata WHERE schema_name = 'attendance' LIMIT 1`,
  ) as Array<Record<string, unknown>>;
  return rows.length > 0;
}

// ─── Demo data ──────────────────────────────────────────────────────────────────

const ACTOR = 'demo-data:engagement';
const AT = new Date('2025-10-06T09:00:00Z');

/**
 * Four intentionally fictional engagement stories:
 * attended, approved alternative engagement, disputed evidence, and sustained
 * non-engagement referred for an independent human compliance review.
 *
 * No-ops (with a console warning) if the attendance module's own migration
 * has not been applied to this database — the module owns this schema and
 * must be deployed for this data to have anywhere to land.
 */
export async function loadEngagementDemo(db: Db, tenantId: string): Promise<void> {
  if (!(await attendanceSchemaExists(db))) {
    console.warn('attendance schema not found — skipping engagement demo data; run the attendance module migration first');
    return;
  }

  const people = [
    [GOLDEN_IDS.PERSON_ENROLLED, GOLDEN_IDS.ENROLMENT_ENROLLED, 'attended', 'valid'],
    [GOLDEN_IDS.PERSON_INTERMITTING, GOLDEN_IDS.ENROLMENT_INTERMITTING, 'alternative-engagement', 'valid'],
    [GOLDEN_IDS.PERSON_WITHDRAWN, GOLDEN_IDS.ENROLMENT_WITHDRAWN, 'absent', 'disputed'],
    [GOLDEN_IDS.PERSON_GRADUATED, GOLDEN_IDS.ENROLMENT_GRADUATED, 'absent', 'valid'],
  ] as const;
  const policyId = deterministicId('engagement-policy', tenantId);
  const policyVersionId = deterministicId('engagement-policy-version', tenantId);
  await db.insert(engagementPolicyVersionsTable).values({
    id: policyId, versionId: policyVersionId, tenantId, policyCode: 'DEMO-ENGAGEMENT',
    versionNumber: 1, displayName: 'DEMO - Academic engagement review',
    statusCode: 'approved', applicability: { scope: 'demo-cohort', ukWide: true },
    evidenceWindow: { durationDays: 14 },
    alertRules: { minimumExpectedEvents: 1, minimumAbsenceCount: 1, minimumAbsenceRate: 1, severityCode: 'medium' },
    reviewDeadline: { durationDays: 5 }, approvedBy: ACTOR, approvedAt: AT, actorId: ACTOR,
    validFrom: new Date('2025-09-01T00:00:00Z'), recordedAt: AT,
  }).onConflictDoNothing();
  for (const [personId, enrolmentId, outcomeCode, dataQualityCode] of people) {
    const eventId = deterministicId('engagement-event', tenantId, personId);
    const observationId = deterministicId('engagement-observation', tenantId, personId);
    await db.insert(expectedEngagementEventsTable).values({
      id: eventId, versionId: deterministicId('engagement-event-version', eventId), tenantId,
      personId, enrolmentId, activityTypeCode: 'lecture', activityReference: 'DEMO-CS101',
      eventModeCode: personId === GOLDEN_IDS.PERSON_INTERMITTING ? 'asynchronous' : 'in-person',
      scheduledFrom: AT, scheduledTo: new Date('2025-10-06T10:00:00Z'),
      sourceSystemCode: 'demo-timetable', sourceEventId: `DEMO-${personId}`, sourceVersion: '1',
      statusCode: 'expected', actorId: ACTOR, validFrom: AT, recordedAt: AT,
    }).onConflictDoNothing();
    await db.insert(engagementObservationsTable).values({
      id: observationId, versionId: deterministicId('engagement-observation-version', observationId), tenantId,
      expectedEventId: eventId, personId, enrolmentId, sourceSystemCode: 'demo-register',
      sourceEventId: `DEMO-OBS-${personId}`, sourceVersion: '1', idempotencyKey: `demo:${observationId}`,
      captureMethodCode: 'staff-entry', outcomeCode, dataQualityCode, eventTime: AT, receivedAt: AT,
      actorId: ACTOR, validFrom: AT, recordedAt: AT,
    }).onConflictDoNothing();
  }
  await loadAlert(db, tenantId, policyVersionId, people[2]!, 'suspended-reconciliation', true);
  const sustainedAlertId = await loadAlert(db, tenantId, policyVersionId, people[3]!, 'intervention-opened', false);
  const caseId = deterministicId('engagement-case', tenantId, people[3][0]);
  await db.insert(engagementInterventionCasesTable).values({
    id: caseId, versionId: deterministicId('engagement-case-version', caseId), tenantId,
    alertId: sustainedAlertId, personId: people[3][0], enrolmentId: people[3][1],
    statusCode: 'referred', assignedRoleCode: 'engagement-officer', assignedActorId: 'demo-engagement-officer',
    workflowInstanceId: deterministicId('engagement-workflow', caseId),
    correlationId: deterministicId('engagement-correlation', caseId), openedAt: AT,
    reviewAt: new Date('2025-10-10T10:00:00Z'), dueAt: new Date('2025-10-13T17:00:00Z'),
    actorId: ACTOR, idempotencyKey: `demo:${caseId}`, validFrom: AT, recordedAt: AT,
  }).onConflictDoNothing();
  await db.insert(engagementReferralsTable).values({
    id: deterministicId('engagement-referral', caseId), tenantId, interventionCaseId: caseId,
    targetServiceCode: 'sponsor-compliance-review', referralTypeCode: 'compliance-review',
    statusCode: 'pending', externalReference: 'DEMO-SCR-001',
    correlationId: deterministicId('engagement-correlation', caseId), referredBy: ACTOR,
    referredAt: new Date('2025-10-10T10:00:00Z'), idempotencyKey: `demo:referral:${caseId}`,
  }).onConflictDoNothing();
}

async function loadAlert(
  db: Db, tenantId: string, policyVersionId: string,
  story: readonly [string, string, string, string],
  statusCode: string, unsafe: boolean,
): Promise<string> {
  const [personId, enrolmentId, outcomeCode, dataQualityCode] = story;
  const alertId = deterministicId('engagement-alert', tenantId, personId);
  await db.insert(engagementAlertsTable).values({
    id: alertId, versionId: deterministicId('engagement-alert-version', alertId), tenantId,
    personId, enrolmentId, policyVersionId,
    evidenceWindowFrom: new Date('2025-10-01T00:00:00Z'), evidenceWindowTo: new Date('2025-10-10T00:00:00Z'),
    evidenceSnapshot: {
      schemaVersion: 1, expectedEventCount: 1, absenceCount: 1, absenceRate: 1,
      unsafeEvidenceCount: unsafe ? 1 : 0, scenario: unsafe ? 'disputed-evidence' : 'sustained-non-engagement',
      outcomeCode, dataQualityCode,
    },
    evidenceHash: deterministicId('engagement-evidence-hash', alertId).replaceAll('-', ''),
    explanation: {
      policyCode: 'DEMO-ENGAGEMENT', policyVersion: 1,
      decision: unsafe ? 'reconciliation-required' : 'human-review-required',
      automatedAdverseActionPermitted: false,
    },
    severityCode: unsafe ? 'low' : 'high', statusCode, reevaluationRequired: unsafe,
    actorId: ACTOR, validFrom: AT, recordedAt: AT,
  }).onConflictDoNothing();
  return alertId;
}
