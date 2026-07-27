import {
  engagementAlerts, engagementInterventionCases, engagementObservations, engagementPolicyVersions,
  engagementReferrals, expectedEngagementEvents, type Db,
} from '@revelation-srs/db';

import { GOLDEN_IDS } from '../golden-ids.js';
import { deterministicId } from './ids.js';

const ACTOR = 'demo-data:engagement';
const AT = new Date('2025-10-06T09:00:00Z');

/**
 * Four intentionally fictional engagement stories:
 * attended, approved alternative engagement, disputed evidence, and sustained
 * non-engagement referred for an independent human compliance review.
 */
export async function loadEngagementDemo(db: Db, tenantId: string): Promise<void> {
  const people = [
    [GOLDEN_IDS.PERSON_ENROLLED, GOLDEN_IDS.ENROLMENT_ENROLLED, 'attended', 'valid'],
    [GOLDEN_IDS.PERSON_INTERMITTING, GOLDEN_IDS.ENROLMENT_INTERMITTING, 'alternative-engagement', 'valid'],
    [GOLDEN_IDS.PERSON_WITHDRAWN, GOLDEN_IDS.ENROLMENT_WITHDRAWN, 'absent', 'disputed'],
    [GOLDEN_IDS.PERSON_GRADUATED, GOLDEN_IDS.ENROLMENT_GRADUATED, 'absent', 'valid'],
  ] as const;
  const policyId = deterministicId('engagement-policy', tenantId);
  const policyVersionId = deterministicId('engagement-policy-version', tenantId);
  await db.insert(engagementPolicyVersions).values({
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
    await db.insert(expectedEngagementEvents).values({
      id: eventId, versionId: deterministicId('engagement-event-version', eventId), tenantId,
      personId, enrolmentId, activityTypeCode: 'lecture', activityReference: 'DEMO-CS101',
      eventModeCode: personId === GOLDEN_IDS.PERSON_INTERMITTING ? 'asynchronous' : 'in-person',
      scheduledFrom: AT, scheduledTo: new Date('2025-10-06T10:00:00Z'),
      sourceSystemCode: 'demo-timetable', sourceEventId: `DEMO-${personId}`, sourceVersion: '1',
      statusCode: 'expected', actorId: ACTOR, validFrom: AT, recordedAt: AT,
    }).onConflictDoNothing();
    await db.insert(engagementObservations).values({
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
  await db.insert(engagementInterventionCases).values({
    id: caseId, versionId: deterministicId('engagement-case-version', caseId), tenantId,
    alertId: sustainedAlertId, personId: people[3][0], enrolmentId: people[3][1],
    statusCode: 'referred', assignedRoleCode: 'engagement-officer', assignedActorId: 'demo-engagement-officer',
    workflowInstanceId: deterministicId('engagement-workflow', caseId),
    correlationId: deterministicId('engagement-correlation', caseId), openedAt: AT,
    reviewAt: new Date('2025-10-10T10:00:00Z'), dueAt: new Date('2025-10-13T17:00:00Z'),
    actorId: ACTOR, idempotencyKey: `demo:${caseId}`, validFrom: AT, recordedAt: AT,
  }).onConflictDoNothing();
  await db.insert(engagementReferrals).values({
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
  await db.insert(engagementAlerts).values({
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
