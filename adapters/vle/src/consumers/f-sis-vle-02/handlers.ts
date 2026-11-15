/**
 * F-SIS-VLE-02 — Adjustment Distribution Flow handlers.
 *
 * Acts on the SRS's per-target instructions, delivered on subjects ending
 * in .vle:
 *   srs.adjustment.distribution-requested.vle            → handleDistributionRequested
 *   srs.adjustment.distribution-withdrawal-requested.vle → handleDistributionWithdrawalRequested
 *
 * (Earlier versions waited for srs.adjustment.distributed, which the SRS only
 * publishes after a target acknowledges — so nothing was ever applied.)
 *
 * An instruction is recorded in vle_adjustment_map, then the student's whole
 * desired VLE state is re-derived and pushed through the platform driver
 * (see accommodation-sync.ts), and the result is reported to the SRS:
 *   - time adjustments (extra-time, rest-breaks) with an amount → applied, acknowledged
 *   - time adjustments without an amount → reported as a failure: a VLE needs
 *     a number to compute per-quiz extra time
 *   - other types (deadline-extension, reader, scribe, separate-room) → no
 *     automatic VLE write; acknowledged as accepted. A deadline-extension
 *     adjustment records eligibility, decided per assessment by staff.
 *
 * Special-category data: payloads are never logged. Only eventId,
 * adjustmentId and distributionId appear in log entries.
 */

import type {
  AdjustmentDistributionRequestedV1Payload,
  AdjustmentDistributionWithdrawalRequestedV1Payload,
  DomainEventEnvelope,
} from '@revelation-srs/domain';
import type { Logger } from 'pino';

import type { VleTx } from '../../db/client.js';
import type { SrsAcknowledgementClient } from '../../srs-client/acknowledgement-client.js';
import type { VleClient } from '../../vle-client/client.js';
import type { VlePlatformDriver } from '../../vle-platforms/driver.js';
import { isTimeAdjustment, percentOfDuration } from '../../vle-platforms/time-accommodation.js';

import { syncPersonAccommodations } from './accommodation-sync.js';
import { getAdjustmentMapping, recordInstruction, setMappingStatus } from './adjustment-map-repository.js';

export interface HandlerContext {
  tx:             VleTx;
  tenantId:       string;
  vleClient:      VleClient | undefined;
  srsAckClient:   SrsAcknowledgementClient | undefined;
  platformDriver: VlePlatformDriver | undefined;
  log:            Logger;
}

export async function handleDistributionRequested(
  envelope: DomainEventEnvelope<AdjustmentDistributionRequestedV1Payload>,
  ctx:      HandlerContext,
): Promise<void> {
  const p = envelope.payload;
  const { tx, tenantId, srsAckClient, platformDriver, log } = ctx;
  const ids = { eventId: envelope.id, adjustmentId: p.adjustmentId, distributionId: p.distributionId };

  // The subject filter already restricts delivery to .vle; this guards a
  // misrouted or replayed message.
  if (p.targetSystem !== 'vle') {
    log.debug({ ...ids, targetSystem: p.targetSystem }, 'F-SIS-VLE-02: instruction not for VLE — skipping');
    return;
  }

  const existing = await getAdjustmentMapping(tx, tenantId, p.distributionId);
  if (existing && (existing.statusCode === 'acknowledged' || existing.statusCode === 'withdrawn')) {
    log.debug({ ...ids, statusCode: existing.statusCode }, 'F-SIS-VLE-02: instruction already handled — skipping');
    return;
  }

  await recordInstruction(tx, tenantId, {
    adjustmentId:       p.adjustmentId,
    distributionId:     p.distributionId,
    personId:           p.personId,
    enrolmentId:        p.enrolmentId,
    adjustmentTypeCode: p.adjustmentTypeCode,
    scopeCode:          p.scopeCode,
    amount:             p.amount ?? null,
    validFrom:          new Date(p.validFrom),
    validTo:            p.validTo ? new Date(p.validTo) : null,
  });

  // A VLE cannot apply time it cannot compute.
  if (isTimeAdjustment(p.adjustmentTypeCode) && (!p.amount || percentOfDuration(p.amount) === null)) {
    const reason = p.amount
      ? `Amount unit '${p.amount.unitCode}' cannot be applied as additional time on a VLE assessment`
      : 'No structured amount was recorded, so per-assessment extra time cannot be computed; record the amount on the adjustment';
    await setMappingStatus(tx, tenantId, p.distributionId, 'failed', { errorDetail: reason });
    if (srsAckClient) await srsAckClient.reportFailure(p.adjustmentId, p.distributionId, reason);
    log.warn(ids, 'F-SIS-VLE-02: time adjustment without a usable amount — failure reported to SRS');
    return;
  }

  const now = new Date();
  if (platformDriver && isTimeAdjustment(p.adjustmentTypeCode)) {
    const summary = await syncPersonAccommodations(tx, tenantId, p.personId, platformDriver, now);
    log.debug({ ...ids, courses: summary.courses, changes: summary.changes }, 'F-SIS-VLE-02: VLE accommodations synced');
    if (summary.warnings.length > 0) {
      log.warn({ ...ids, warnings: summary.warnings }, 'F-SIS-VLE-02: VLE could not hold the accommodation everywhere');
    }
  }
  await setMappingStatus(tx, tenantId, p.distributionId, 'applied', { appliedAt: now, errorDetail: null });

  if (srsAckClient) {
    await srsAckClient.acknowledgeDistribution(p.adjustmentId, p.distributionId);
    await setMappingStatus(tx, tenantId, p.distributionId, 'acknowledged', { acknowledgedAt: now });
  }

  log.debug(ids, 'F-SIS-VLE-02: instruction applied');
}

export async function handleDistributionWithdrawalRequested(
  envelope: DomainEventEnvelope<AdjustmentDistributionWithdrawalRequestedV1Payload>,
  ctx:      HandlerContext,
): Promise<void> {
  const p = envelope.payload;
  const { tx, tenantId, srsAckClient, platformDriver, log } = ctx;
  const ids = { eventId: envelope.id, adjustmentId: p.adjustmentId, distributionId: p.distributionId };

  if (p.targetSystem !== 'vle') {
    log.debug({ ...ids, targetSystem: p.targetSystem }, 'F-SIS-VLE-02: withdrawal not for VLE — skipping');
    return;
  }

  const now = new Date();
  const existing = await getAdjustmentMapping(tx, tenantId, p.distributionId);
  if (existing && existing.statusCode !== 'withdrawn') {
    await setMappingStatus(tx, tenantId, p.distributionId, 'withdrawn', { withdrawnAt: now });
  }

  // Re-derive without this adjustment. Also runs when the instruction never
  // reached us: the student's VLE state should still match what remains.
  if (platformDriver) {
    const summary = await syncPersonAccommodations(tx, tenantId, p.personId, platformDriver, now);
    log.debug({ ...ids, ...summary }, 'F-SIS-VLE-02: VLE accommodations re-synced after withdrawal');
  }

  if (srsAckClient) {
    await srsAckClient.acknowledgeWithdrawal(p.adjustmentId, p.distributionId);
    if (existing) {
      await setMappingStatus(tx, tenantId, p.distributionId, 'withdrawn', { withdrawalAcknowledgedAt: now });
    }
  }

  log.debug(ids, 'F-SIS-VLE-02: withdrawal applied');
}
