/**
 * F015 — Course Provisioning Flow handlers.
 *
 * These handlers translate SRS domain events into VLE write operations.
 * All handlers receive a HandlerContext that carries the active DB transaction
 * and an optional VleClient.  When vleClient is undefined (e.g. canWrite is
 * false) the handler performs the local DB update only and skips the VLE call.
 *
 * Event → handler mapping:
 *   srs.catalogue.module-updated          → handleModuleUpdated
 *   srs.student.enrolled                  → handleStudentEnrolled
 *   srs.student.status-changed            → handleStudentStatusChanged
 *   srs.enrolment.module-registered       → handleModuleRegistered
 *   srs.enrolment.module-registration-withdrawn  → handleModuleRegistrationWithdrawn
 *   srs.enrolment.module-registration-completed  → handleModuleRegistrationCompleted
 */

import type { DomainEventEnvelope } from '@revelation-srs/domain';
import type { Logger } from 'pino';
import type {
  CatalogueModuleUpdatedV1Payload,
  EnrolmentModuleRegisteredV1Payload,
  EnrolmentModuleRegistrationCompletedV1Payload,
  EnrolmentModuleRegistrationWithdrawnV1Payload,
  StudentEnrolledV1Payload,
  StudentStatusChangedV1Payload,
} from '@revelation-srs/domain';
import { and, eq } from 'drizzle-orm';

import type { VleTx } from '../../db/client.js';
import { enrolmentMap } from '../../db/schema/enrolment-map.js';
import type { VleClient } from '../../vle-client/client.js';

import { toVleAccessState } from './access-state.js';
import { getCourseMapping, upsertCourseMapping } from './course-map-repository.js';
import { getEnrolmentMapping, updateEnrolmentStatus, upsertEnrolmentMapping } from './enrolment-map-repository.js';
import { getPersonIdForEnrolment, upsertStudentEnrolment } from './student-enrolment-repository.js';

export interface HandlerContext {
  tx:        VleTx;
  tenantId:  string;
  vleClient: VleClient | undefined;
  log:       Logger;
}

// ── catalogue.module-updated ──────────────────────────────────────────────────

export async function handleModuleUpdated(
  envelope: DomainEventEnvelope<CatalogueModuleUpdatedV1Payload>,
  ctx:      HandlerContext,
): Promise<void> {
  const { moduleId, code, title, creditValue } = envelope.payload;
  const { tx, tenantId, vleClient, log } = ctx;

  if (vleClient) {
    const result = await vleClient.upsertCourse({ moduleId, code, title, creditValue });
    await upsertCourseMapping(tx, tenantId, moduleId, result.vleCourseId, { title, code });
    log.debug({ moduleId, vleCourseId: result.vleCourseId }, 'F015: module-updated → VLE course upserted');
  } else {
    log.debug({ moduleId }, 'F015: module-updated — vleClient unavailable, skipping VLE write');
  }
}

// ── student.enrolled ──────────────────────────────────────────────────────────

export async function handleStudentEnrolled(
  envelope: DomainEventEnvelope<StudentEnrolledV1Payload>,
  ctx:      HandlerContext,
): Promise<void> {
  const { personId, enrolmentId } = envelope.payload;
  const { tx, tenantId, log } = ctx;

  await upsertStudentEnrolment(tx, tenantId, enrolmentId, personId);
  log.debug({ personId, enrolmentId }, 'F015: student.enrolled → enrolment map seeded');
}

// ── student.status-changed ────────────────────────────────────────────────────

export async function handleStudentStatusChanged(
  envelope: DomainEventEnvelope<StudentStatusChangedV1Payload>,
  ctx:      HandlerContext,
): Promise<void> {
  const { enrolmentId, newStatus } = envelope.payload ?? {};
  const { tx, tenantId, vleClient, log } = ctx;

  if (!enrolmentId || !newStatus) {
    log.warn({ eventId: envelope.id }, 'F015: status-changed — missing payload fields, skipping');
    return;
  }

  const vleStatus = toVleAccessState(newStatus);

  // Find all module registrations for this enrolment and update each one.
  const rows = await tx
    .select()
    .from(enrolmentMap)
    .where(and(eq(enrolmentMap.tenantId, tenantId), eq(enrolmentMap.enrolmentId, enrolmentId)));

  if (rows.length === 0) {
    log.debug({ enrolmentId, newStatus }, 'F015: status-changed — no module registrations found, skipping');
    return;
  }

  for (const row of rows) {
    if (vleClient) {
      await vleClient.updateEnrolmentStatus({
        moduleId:             row.moduleId,
        moduleRegistrationId: row.moduleRegistrationId,
        statusCode:           vleStatus,
      });
    }
    await updateEnrolmentStatus(tx, tenantId, row.moduleRegistrationId, vleStatus);
  }

  log.debug(
    { enrolmentId, newStatus, vleStatus, count: rows.length },
    'F015: status-changed → VLE enrolment statuses updated',
  );
}

// ── enrolment.module-registered ───────────────────────────────────────────────

export async function handleModuleRegistered(
  envelope: DomainEventEnvelope<EnrolmentModuleRegisteredV1Payload>,
  ctx:      HandlerContext,
): Promise<void> {
  const { enrolmentId, moduleRegistrationId, moduleId } = envelope.payload;
  const { tx, tenantId, vleClient, log } = ctx;

  // Resolve personId from the student-enrolment map (seeded by student.enrolled).
  const personId = await getPersonIdForEnrolment(tx, tenantId, enrolmentId);
  if (!personId) {
    log.warn(
      { enrolmentId, moduleRegistrationId },
      'F015: module-registered — personId not found in enrolment map; marking processed for later reconciliation',
    );
    // Still mark as processed — reconciliation job will repair later.
    return;
  }

  // Look up the VLE course — may not exist yet if module-updated hasn't arrived.
  const courseMapping = await getCourseMapping(tx, tenantId, moduleId);
  if (!courseMapping) {
    log.warn(
      { moduleId, moduleRegistrationId },
      'F015: module-registered — no course mapping found; marking processed for later reconciliation',
    );
    return;
  }

  if (vleClient) {
    const result = await vleClient.upsertEnrolment({
      moduleId,
      moduleRegistrationId,
      personId,
      enrolmentId,
      statusCode: 'active',
    });
    await upsertEnrolmentMapping(tx, tenantId, {
      moduleRegistrationId,
      moduleId,
      enrolmentId,
      personId,
      vleEnrolmentId: result.vleEnrolmentId,
      statusCode: 'active',
    });
    log.debug(
      { moduleRegistrationId, vleEnrolmentId: result.vleEnrolmentId },
      'F015: module-registered → VLE enrolment created',
    );
  } else {
    await upsertEnrolmentMapping(tx, tenantId, {
      moduleRegistrationId,
      moduleId,
      enrolmentId,
      personId,
      statusCode: 'active',
    });
    log.debug({ moduleRegistrationId }, 'F015: module-registered — local map recorded, vleClient unavailable');
  }
}

// ── enrolment.module-registration-withdrawn ───────────────────────────────────

export async function handleModuleRegistrationWithdrawn(
  envelope: DomainEventEnvelope<EnrolmentModuleRegistrationWithdrawnV1Payload>,
  ctx:      HandlerContext,
): Promise<void> {
  const { moduleRegistrationId } = envelope.payload ?? {};
  const { tx, tenantId, vleClient, log } = ctx;

  if (!moduleRegistrationId) {
    log.warn({ eventId: envelope.id }, 'F015: module-registration-withdrawn — missing moduleRegistrationId, skipping');
    return;
  }

  const existing = await getEnrolmentMapping(tx, tenantId, moduleRegistrationId);
  if (!existing) {
    log.debug({ moduleRegistrationId }, 'F015: withdrawal — no enrolment map row found, skipping');
    return;
  }

  if (vleClient) {
    await vleClient.updateEnrolmentStatus({
      moduleId:             existing.moduleId,
      moduleRegistrationId: existing.moduleRegistrationId,
      statusCode:           'withdrawn',
    });
  }
  await updateEnrolmentStatus(tx, tenantId, moduleRegistrationId, 'withdrawn');

  log.debug({ moduleRegistrationId }, 'F015: module-registration-withdrawn → VLE enrolment withdrawn');
}

// ── enrolment.module-registration-completed ───────────────────────────────────

export async function handleModuleRegistrationCompleted(
  envelope: DomainEventEnvelope<EnrolmentModuleRegistrationCompletedV1Payload>,
  ctx:      HandlerContext,
): Promise<void> {
  const { moduleRegistrationId } = envelope.payload ?? {};
  const { tx, tenantId, vleClient, log } = ctx;

  if (!moduleRegistrationId) {
    log.warn({ eventId: envelope.id }, 'F015: module-registration-completed — missing moduleRegistrationId, skipping');
    return;
  }

  const existing = await getEnrolmentMapping(tx, tenantId, moduleRegistrationId);
  if (!existing) {
    log.debug({ moduleRegistrationId }, 'F015: completion — no enrolment map row found, skipping');
    return;
  }

  if (vleClient) {
    await vleClient.updateEnrolmentStatus({
      moduleId:             existing.moduleId,
      moduleRegistrationId: existing.moduleRegistrationId,
      statusCode:           'completed',
    });
  }
  await updateEnrolmentStatus(tx, tenantId, moduleRegistrationId, 'completed');

  log.debug({ moduleRegistrationId }, 'F015: module-registration-completed → VLE enrolment completed');
}
