/**
 * SRS context projection handlers — Stage 2.
 *
 * Each handler receives a domain event envelope and a transaction-scoped
 * database handle. Handlers are pure in the sense that they only write to
 * the wellbeing database; they do not call NATS, HTTP, or any external service.
 * Idempotency is enforced by the caller (WellbeingEventDispatcher) before
 * invoking any handler.
 *
 * Handler naming convention: handle<EventTypeCamelCase>
 */

import type { DomainEventEnvelope } from '@revelation-srs/domain';
import type {
  StudentEnrolledV1Payload,
  StudentStatusChangedV1Payload,
  DisabilityDeclarationUpdatedV1Payload,
  EnrolmentModuleRegisteredV1Payload,
  EnrolmentModuleRegistrationWithdrawnV1Payload,
  AssessmentMarkReceivedV1Payload,
  AssessmentModuleResultRatifiedV1Payload,
  AdjustmentApprovedV1Payload,
  AdjustmentDistributedV1Payload,
  AdjustmentExpiredV1Payload,
  CircumstancesEcFlaggedV1Payload,
  CircumstancesEcUpdatedV1Payload,
  RegulatoryUkviVisaStatusUpdatedV1Payload,
  RegulatoryUkviComplianceAlertRaisedV1Payload,
} from '@revelation-srs/domain';

import type { WellbeingTx } from '../db/client.js';
import { earlyWarningAlerts } from '../db/schema/wellbeing-case.js';
import {
  upsertProjection,
  removeModuleCode,
  upsertEnrolmentMap,
  upsertModuleRegMap,
  findPersonIdByEnrolmentId,
  findByModuleRegId,
} from '../repositories/projection-repository.js';

// ── srs.student.enrolled ──────────────────────────────────────────────────────

export async function handleStudentEnrolled(
  tx:       WellbeingTx,
  envelope: DomainEventEnvelope<StudentEnrolledV1Payload>,
): Promise<void> {
  const { personId, enrolmentId, academicYear, modeOfStudy, programmeId, fundingSource } = envelope.payload;

  await upsertEnrolmentMap(tx, envelope.tenantId, enrolmentId, personId);

  await upsertProjection(tx, envelope.tenantId, personId, {
    personData: {
      latestEnrolmentId: enrolmentId,
      academicYear,
      modeOfStudy,
      ...(programmeId  !== undefined ? { programmeId  } : {}),
      ...(fundingSource !== undefined ? { fundingSource } : {}),
    },
    activeEnrolmentIds: [enrolmentId],
    lastEventOffset:    envelope.id,
  });
}

// ── srs.student.status-changed ────────────────────────────────────────────────

export async function handleStudentStatusChanged(
  tx:       WellbeingTx,
  envelope: DomainEventEnvelope<StudentStatusChangedV1Payload>,
): Promise<void> {
  const { personId, newStatus } = envelope.payload;

  await upsertProjection(tx, envelope.tenantId, personId, {
    enrolmentStatus: newStatus,
    lastEventOffset: envelope.id,
  });
}

// ── srs.student.disability-declaration-updated ────────────────────────────────

export async function handleDisabilityDeclarationUpdated(
  tx:       WellbeingTx,
  envelope: DomainEventEnvelope<DisabilityDeclarationUpdatedV1Payload>,
): Promise<void> {
  const { personId, declarationStatusCode } = envelope.payload;

  await upsertProjection(tx, envelope.tenantId, personId, {
    disabilityDeclarationStatus: declarationStatusCode,
    lastEventOffset:             envelope.id,
  });
}

// ── srs.enrolment.module-registered ──────────────────────────────────────────

export async function handleModuleRegistered(
  tx:       WellbeingTx,
  envelope: DomainEventEnvelope<EnrolmentModuleRegisteredV1Payload>,
): Promise<void> {
  const { enrolmentId, moduleRegistrationId, moduleId } = envelope.payload;

  const personId = await findPersonIdByEnrolmentId(tx, envelope.tenantId, enrolmentId);
  if (!personId) {
    // Enrolled event not yet processed — record in map when it arrives.
    // Safe to skip projection update; reconciliation will repair.
    return;
  }

  await upsertModuleRegMap(tx, envelope.tenantId, moduleRegistrationId, enrolmentId, personId, moduleId);

  await upsertProjection(tx, envelope.tenantId, personId, {
    activeModuleCodes: [moduleId],
    lastEventOffset:   envelope.id,
  });
}

// ── srs.enrolment.module-registration-withdrawn ───────────────────────────────

export async function handleModuleRegistrationWithdrawn(
  tx:       WellbeingTx,
  envelope: DomainEventEnvelope<EnrolmentModuleRegistrationWithdrawnV1Payload>,
): Promise<void> {
  const { enrolmentId, moduleRegistrationId } = envelope.payload;

  const personId = await findPersonIdByEnrolmentId(tx, envelope.tenantId, enrolmentId);
  if (!personId) return;

  const reg = await findByModuleRegId(tx, envelope.tenantId, moduleRegistrationId);
  const moduleId = reg?.moduleId;
  if (!moduleId) return;

  await removeModuleCode(tx, envelope.tenantId, personId, moduleId);
}

// ── srs.assessment.mark-received ─────────────────────────────────────────────

export async function handleMarkReceived(
  tx:       WellbeingTx,
  envelope: DomainEventEnvelope<AssessmentMarkReceivedV1Payload>,
): Promise<void> {
  const { moduleRegistrationId, assessmentComponentId, rawMark, adjustedMark, attemptNumber } = envelope.payload;

  const lookup = await findByModuleRegId(tx, envelope.tenantId, moduleRegistrationId);
  if (!lookup) return;

  await upsertProjection(tx, envelope.tenantId, lookup.personId, {
    latestMarks: {
      [moduleRegistrationId]: { assessmentComponentId, rawMark, adjustedMark, attemptNumber },
    },
    lastEventOffset: envelope.id,
  });
}

// ── srs.assessment.module-result-ratified ────────────────────────────────────

export async function handleModuleResultRatified(
  tx:       WellbeingTx,
  envelope: DomainEventEnvelope<AssessmentModuleResultRatifiedV1Payload>,
): Promise<void> {
  const { moduleRegistrationId, resultCode, aggregateMark } = envelope.payload;

  const lookup = await findByModuleRegId(tx, envelope.tenantId, moduleRegistrationId);
  if (!lookup) return;

  await upsertProjection(tx, envelope.tenantId, lookup.personId, {
    latestMarks: {
      [`${moduleRegistrationId}_final`]: { resultCode, aggregateMark, ratified: true },
    },
    lastEventOffset: envelope.id,
  });
}

// ── srs.adjustment.approved ───────────────────────────────────────────────────

export async function handleAdjustmentApproved(
  tx:       WellbeingTx,
  envelope: DomainEventEnvelope<AdjustmentApprovedV1Payload>,
): Promise<void> {
  const { personId, adjustmentId, adjustmentTypeCode, validFrom, validTo } = envelope.payload;

  await upsertProjection(tx, envelope.tenantId, personId, {
    personData: {
      lastApprovedAdjustment: { adjustmentId, adjustmentTypeCode, validFrom, validTo },
    },
    lastEventOffset: envelope.id,
  });
}

// ── srs.adjustment.distributed ───────────────────────────────────────────────
// Payload has no personId — log the event for audit but cannot update projection.

export async function handleAdjustmentDistributed(
  _tx:      WellbeingTx,
  _envelope: DomainEventEnvelope<AdjustmentDistributedV1Payload>,
): Promise<void> {
  // No personId in payload; distribution tracking is satisfied by event_log entry.
}

// ── srs.adjustment.expired ────────────────────────────────────────────────────

export async function handleAdjustmentExpired(
  tx:       WellbeingTx,
  envelope: DomainEventEnvelope<AdjustmentExpiredV1Payload>,
): Promise<void> {
  const { personId } = envelope.payload;

  await upsertProjection(tx, envelope.tenantId, personId, {
    personData: {
      lastExpiredAdjustmentAt: envelope.occurredAt,
    },
    lastEventOffset: envelope.id,
  });
}

// ── srs.circumstances.exceptional-circumstances-flagged ──────────────────────

export async function handleEcFlagged(
  tx:       WellbeingTx,
  envelope: DomainEventEnvelope<CircumstancesEcFlaggedV1Payload>,
): Promise<void> {
  const { personId, exceptionalCircumstancesId, outcomeCode, determinationDate } = envelope.payload;

  await upsertProjection(tx, envelope.tenantId, personId, {
    personData: {
      lastEcFlag: { exceptionalCircumstancesId, outcomeCode, determinationDate, flaggedAt: envelope.occurredAt },
    },
    lastEventOffset: envelope.id,
  });
}

// ── srs.circumstances.exceptional-circumstances-updated ──────────────────────
// Payload has no personId — cannot update projection directly.

export async function handleEcUpdated(
  _tx:      WellbeingTx,
  _envelope: DomainEventEnvelope<CircumstancesEcUpdatedV1Payload>,
): Promise<void> {
  // No personId in payload; acknowledged by event_log entry only.
}

// ── srs.regulatory.ukvi-visa-status-updated ───────────────────────────────────

export async function handleUkviVisaStatusUpdated(
  tx:       WellbeingTx,
  envelope: DomainEventEnvelope<RegulatoryUkviVisaStatusUpdatedV1Payload>,
): Promise<void> {
  const { enrolmentId, statusCode, casReference, effectiveDate } = envelope.payload;

  const personId = await findPersonIdByEnrolmentId(tx, envelope.tenantId, enrolmentId);
  if (!personId) return;

  await upsertProjection(tx, envelope.tenantId, personId, {
    personData: {
      ukviVisaStatus: { statusCode, casReference, effectiveDate },
    },
    lastEventOffset: envelope.id,
  });
}

// ── srs.regulatory.ukvi-compliance-alert-raised ───────────────────────────────
// Creates an early_warning_alert record and updates projection.

export async function handleUkviComplianceAlertRaised(
  tx:       WellbeingTx,
  envelope: DomainEventEnvelope<RegulatoryUkviComplianceAlertRaisedV1Payload>,
): Promise<void> {
  const { enrolmentId, alertTypeCode, casReference, triggeredAt } = envelope.payload;

  const personId = await findPersonIdByEnrolmentId(tx, envelope.tenantId, enrolmentId);
  if (!personId) return;

  await tx.insert(earlyWarningAlerts).values({
    tenantId:           envelope.tenantId,
    personId,
    alertTypeCode:      'ukvi-compliance',
    alertSourceCode:    'ukvi',
    sourceEventSubject: envelope.type,
    sourceEventId:      envelope.id,
    triageStatusCode:   'pending',
    alertPayload:       { enrolmentId, alertTypeCode, casReference, triggeredAt } as unknown as Record<string, unknown>,
    receivedAt:         new Date(triggeredAt),
  });

  await upsertProjection(tx, envelope.tenantId, personId, {
    personData: {
      latestUkviAlert: { alertTypeCode, triggeredAt, receivedAt: envelope.occurredAt },
    },
    lastEventOffset: envelope.id,
  });
}
