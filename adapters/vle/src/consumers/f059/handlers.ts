/**
 * F059 — Adjustment Distribution Flow handlers.
 *
 * Translates srs.adjustment.distributed events into VLE adjustment writes and
 * acknowledges successful distributions to the SRS.
 *
 * Special-category data: adjustment payloads are never logged.  Only the
 * eventId, adjustmentId, and distributionId appear in log entries.
 *
 * Event → handler mapping:
 *   srs.adjustment.distributed → handleAdjustmentDistributed
 */

import type { AdjustmentDistributedV1Payload, DomainEventEnvelope } from '@revelation-srs/domain';
import type { Logger } from 'pino';

import type { VleTx } from '../../db/client.js';
import type { SrsAcknowledgementClient } from '../../srs-client/acknowledgement-client.js';
import type { VleClient } from '../../vle-client/client.js';

import { getAdjustmentMapping, upsertAdjustmentMapping } from './adjustment-map-repository.js';

export interface HandlerContext {
  tx:           VleTx;
  tenantId:     string;
  vleClient:    VleClient | undefined;
  srsAckClient: SrsAcknowledgementClient | undefined;
  log:          Logger;
}

export async function handleAdjustmentDistributed(
  envelope: DomainEventEnvelope<AdjustmentDistributedV1Payload>,
  ctx:      HandlerContext,
): Promise<void> {
  const {
    adjustmentId, distributionId, targetSystem,
    personId, enrolmentId, adjustmentTypeCode, scopeCode,
    validFrom, validTo,
  } = envelope.payload;
  const { tx, tenantId, vleClient, srsAckClient, log } = ctx;

  // Only process distributions targeting the VLE connector.
  if (targetSystem !== 'vle') {
    log.debug({ distributionId, targetSystem }, 'F059: adjustment distribution not for VLE — skipping');
    return;
  }

  // Idempotency: skip if already acknowledged.
  const existing = await getAdjustmentMapping(tx, tenantId, distributionId);
  if (existing?.statusCode === 'acknowledged') {
    log.debug({ adjustmentId, distributionId }, 'F059: adjustment already acknowledged — skipping');
    return;
  }

  const now = new Date();

  // Apply to VLE — idempotent on distributionId at the VLE side.
  if (vleClient) {
    await vleClient.applyAdjustment({
      adjustmentId,
      distributionId,
      personId,
      enrolmentId,
      adjustmentTypeCode,
      scopeCode,
      validFrom,
      validTo: validTo ?? null,
    });
  }

  // Acknowledge to SRS — idempotent (SRS treats duplicate ack as no-op).
  if (srsAckClient) {
    await srsAckClient.acknowledgeDistribution(adjustmentId, distributionId);
  }

  // Record final state — both timestamps are the same since we don't split across transactions.
  await upsertAdjustmentMapping(tx, tenantId, {
    adjustmentId,
    distributionId,
    personId,
    enrolmentId,
    adjustmentTypeCode,
    scopeCode,
    validFrom:      new Date(validFrom),
    validTo:        validTo ? new Date(validTo) : null,
    statusCode:     srsAckClient ? 'acknowledged' : 'applied',
    appliedAt:      now,
    acknowledgedAt: srsAckClient ? now : null,
  });

  // Never log payload — adjustment content is special-category data.
  log.debug(
    { eventId: envelope.id, adjustmentId, distributionId },
    'F059: adjustment applied to VLE and acknowledged to SRS',
  );
}
