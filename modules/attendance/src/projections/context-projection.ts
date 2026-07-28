/**
 * SRS context projection handlers.
 *
 * Each handler receives a domain event envelope and a transaction-scoped
 * database handle. Handlers only write to the attendance database; they do
 * not call NATS, HTTP, or any external service. Idempotency is enforced by
 * the caller (AttendanceEventConsumer) before invoking any handler.
 *
 * Handler naming convention: handle<EventTypeCamelCase>
 */

import type { DomainEventEnvelope } from '@revelation-srs/domain';
import type {
  StudentEnrolledV1Payload,
  StudentStatusChangedV1Payload,
  EnrolmentModuleRegisteredV1Payload,
  EnrolmentModuleRegistrationWithdrawnV1Payload,
  EnrolmentModuleRegistrationCompletedV1Payload,
} from '@revelation-srs/domain';

import type { AttendanceTx } from '../db/client.js';
import {
  upsertEnrolmentMap,
  findPersonIdByEnrolmentId,
  upsertModuleRegistrationMap,
  updateModuleRegistrationStatus,
} from '../repositories/projection-repository.js';

// ── srs.student.enrolled ──────────────────────────────────────────────────────

export async function handleStudentEnrolled(
  tx:       AttendanceTx,
  envelope: DomainEventEnvelope<StudentEnrolledV1Payload>,
): Promise<void> {
  const { personId, enrolmentId } = envelope.payload;
  await upsertEnrolmentMap(tx, envelope.tenantId, enrolmentId, personId);
}

// ── srs.student.status-changed ────────────────────────────────────────────────
// No projection action needed today; reserved for a future status-aware policy.

export async function handleStudentStatusChanged(
  _tx:      AttendanceTx,
  _envelope: DomainEventEnvelope<StudentStatusChangedV1Payload>,
): Promise<void> {
  // Intentionally no-op — acknowledged via event_log only.
}

// ── srs.enrolment.module-registered ──────────────────────────────────────────

export async function handleModuleRegistered(
  tx:       AttendanceTx,
  envelope: DomainEventEnvelope<EnrolmentModuleRegisteredV1Payload>,
): Promise<void> {
  const { enrolmentId, moduleRegistrationId, moduleId } = envelope.payload;

  const personId = await findPersonIdByEnrolmentId(tx, envelope.tenantId, enrolmentId);
  if (!personId) {
    // Enrolled event not yet processed — safe to skip; reconciliation repairs
    // this on the next STUDENT_ENROLLED replay.
    return;
  }

  await upsertModuleRegistrationMap(tx, envelope.tenantId, moduleRegistrationId, enrolmentId, personId, moduleId);
}

// ── srs.enrolment.module-registration-withdrawn ───────────────────────────────

export async function handleModuleRegistrationWithdrawn(
  tx:       AttendanceTx,
  envelope: DomainEventEnvelope<EnrolmentModuleRegistrationWithdrawnV1Payload>,
): Promise<void> {
  await updateModuleRegistrationStatus(tx, envelope.tenantId, envelope.payload.moduleRegistrationId, 'withdrawn');
}

// ── srs.enrolment.module-registration-completed ──────────────────────────────

export async function handleModuleRegistrationCompleted(
  tx:       AttendanceTx,
  envelope: DomainEventEnvelope<EnrolmentModuleRegistrationCompletedV1Payload>,
): Promise<void> {
  await updateModuleRegistrationStatus(tx, envelope.tenantId, envelope.payload.moduleRegistrationId, 'completed');
}
