/**
 * F016 — Mark Submission Flow handlers.
 *
 * Handles the inbound direction: SRS ratified result events update the VLE
 * display state so students and staff see the authoritative grade.
 *
 * Event → handler mapping:
 *   srs.assessment.module-result-ratified → handleModuleResultRatified
 *
 * The outbound direction (VLE grades → SRS) is handled by MarkSubmissionService.
 */

import type { AssessmentModuleResultRatifiedV1Payload, DomainEventEnvelope } from '@revelation-srs/domain';
import type { Logger } from 'pino';

import type { VleClient } from '../../vle-client/client.js';

export interface HandlerContext {
  tenantId:  string;
  vleClient: VleClient | undefined;
  log:       Logger;
}

export async function handleModuleResultRatified(
  envelope: DomainEventEnvelope<AssessmentModuleResultRatifiedV1Payload>,
  ctx:      HandlerContext,
): Promise<void> {
  const { moduleRegistrationId, aggregateMark, resultCode, ratifiedAt } = envelope.payload;
  const { vleClient, log } = ctx;

  if (!vleClient) {
    log.debug({ moduleRegistrationId }, 'F016: module-result-ratified — vleClient unavailable, skipping');
    return;
  }

  try {
    await vleClient.setRatifiedResult({ moduleRegistrationId, aggregateMark, resultCode, ratifiedAt });
    log.debug({ moduleRegistrationId, resultCode, aggregateMark }, 'F016: ratified result updated in VLE');
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) {
      // Module registration not in VLE (not enrolled or reconciliation gap) — warn and continue.
      log.warn(
        { moduleRegistrationId, resultCode },
        'F016: module-result-ratified — enrolment not found in VLE, skipping result update',
      );
      return;
    }
    throw err;
  }
}
