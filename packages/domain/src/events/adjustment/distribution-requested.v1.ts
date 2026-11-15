import type { AdjustmentAmountV1 } from './amount.js';

/**
 * Payload for srs.adjustment.distribution-requested v1.0.0
 *
 * An instruction to ONE target system to apply an approved adjustment,
 * published once per adjustment_distribution row. The NATS subject carries the
 * target as a final token (srs.adjustment.distribution-requested.vle) so each
 * integration layer subscribes to, and is authorised for, only its own
 * instructions; the envelope type stays srs.adjustment.distribution-requested.
 *
 * Delivery is at-least-once: the SRS republishes an instruction until it is
 * recorded as published, always with the same envelope id. Consumers must be
 * idempotent on distributionId. Free-text notes are deliberately excluded —
 * target systems (and the staff who use them) see only what they need to act.
 *
 * The consumer replies through the SRS API: acknowledge when applied, or
 * report a failure when it cannot apply it.
 */
export interface AdjustmentDistributionRequestedV1Payload {
  distributionId:     string;
  adjustmentId:       string;
  targetSystem:       string;
  personId:           string;
  enrolmentId:        string;
  adjustmentTypeCode: string;
  scopeCode:          string;
  /** Absent when the adjustment type has no amount or none was recorded. */
  amount?:            AdjustmentAmountV1;
  validFrom:          string;
  validTo?:           string;
  requestedAt:        string;
}
