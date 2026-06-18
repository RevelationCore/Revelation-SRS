import type { DomainEventEnvelope } from '@revelation-srs/domain';
import type {
  AdjustmentDistributedV1Payload,
  AssessmentModuleResultRatifiedV1Payload,
  CatalogueModuleUpdatedV1Payload,
  EnrolmentModuleRegisteredV1Payload,
  EnrolmentModuleRegistrationCompletedV1Payload,
  EnrolmentModuleRegistrationWithdrawnV1Payload,
  StudentEnrolledV1Payload,
  StudentStatusChangedV1Payload,
} from '@revelation-srs/domain';
import type { Logger } from 'pino';

import type { VleTx } from '../db/client.js';
import type { SrsAcknowledgementClient } from '../srs-client/acknowledgement-client.js';
import type { VleClient } from '../vle-client/client.js';

import {
  handleModuleRegistered,
  handleModuleRegistrationCompleted,
  handleModuleRegistrationWithdrawn,
  handleModuleUpdated,
  handleStudentEnrolled,
  handleStudentStatusChanged,
} from './f015/handlers.js';
import { handleModuleResultRatified } from './f016/handlers.js';
import { handleAdjustmentDistributed } from './f059/handlers.js';

export const VLE_SUBSCRIBED_SUBJECTS = [
  'srs.catalogue.programme-updated',
  'srs.catalogue.module-updated',
  'srs.catalogue.learning-outcome-updated',
  'srs.student.enrolled',
  'srs.student.status-changed',
  'srs.enrolment.module-registered',
  'srs.enrolment.module-registration-withdrawn',
  'srs.enrolment.module-registration-completed',
  'srs.assessment.module-result-ratified',
  'srs.adjustment.distributed',
] as const;

export type VleEventSubject = (typeof VLE_SUBSCRIBED_SUBJECTS)[number];

export interface HandlerContext {
  tx:           VleTx;
  tenantId:     string;
  vleClient:    VleClient | undefined;
  srsAckClient: SrsAcknowledgementClient | undefined;
  log:          Logger;
}

export async function routeToHandler(
  envelope: DomainEventEnvelope<unknown>,
  log:      Logger,
  ctx:      HandlerContext,
): Promise<'handled' | 'skipped'> {
  const safeLogContext = {
    eventId:  envelope.id,
    type:     envelope.type,
    tenantId: envelope.tenantId,
  };

  switch (envelope.type) {
    case 'srs.catalogue.module-updated':
      await handleModuleUpdated(
        envelope as DomainEventEnvelope<CatalogueModuleUpdatedV1Payload>,
        ctx,
      );
      return 'handled';

    case 'srs.catalogue.programme-updated':
    case 'srs.catalogue.learning-outcome-updated':
      log.debug(safeLogContext, 'VLE catalogue event — handler pending (Stage 5+)');
      return 'handled';

    case 'srs.student.enrolled':
      await handleStudentEnrolled(
        envelope as DomainEventEnvelope<StudentEnrolledV1Payload>,
        ctx,
      );
      return 'handled';

    case 'srs.student.status-changed':
      await handleStudentStatusChanged(
        envelope as DomainEventEnvelope<StudentStatusChangedV1Payload>,
        ctx,
      );
      return 'handled';

    case 'srs.enrolment.module-registered':
      await handleModuleRegistered(
        envelope as DomainEventEnvelope<EnrolmentModuleRegisteredV1Payload>,
        ctx,
      );
      return 'handled';

    case 'srs.enrolment.module-registration-withdrawn':
      await handleModuleRegistrationWithdrawn(
        envelope as DomainEventEnvelope<EnrolmentModuleRegistrationWithdrawnV1Payload>,
        ctx,
      );
      return 'handled';

    case 'srs.enrolment.module-registration-completed':
      await handleModuleRegistrationCompleted(
        envelope as DomainEventEnvelope<EnrolmentModuleRegistrationCompletedV1Payload>,
        ctx,
      );
      return 'handled';

    case 'srs.assessment.module-result-ratified':
      await handleModuleResultRatified(
        envelope as DomainEventEnvelope<AssessmentModuleResultRatifiedV1Payload>,
        ctx,
      );
      return 'handled';

    case 'srs.adjustment.distributed':
      await handleAdjustmentDistributed(
        envelope as DomainEventEnvelope<AdjustmentDistributedV1Payload>,
        ctx,
      );
      return 'handled';

    default:
      log.debug(safeLogContext, 'VLE consumer: unhandled subject — skipping');
      return 'skipped';
  }
}
