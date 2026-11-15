import type { AdjustmentAmountV1 } from './amount.js';

/**
 * Payload for srs.adjustment.distributed v1.0.0
 *
 * A confirmation, not an instruction: published when a target's integration
 * layer acknowledges that it applied the adjustment. Targets act on
 * srs.adjustment.distribution-requested.<target>; nothing should wait for
 * this event before applying.
 */
export interface AdjustmentDistributedV1Payload {
  adjustmentId:       string;
  distributionId:     string;
  targetSystem:       string;
  distributedAt:      string;
  // Adjustment detail — included so connectors can apply without a REST round-trip
  personId:           string;
  enrolmentId:        string;
  adjustmentTypeCode: string;
  scopeCode:          string;
  amount?:            AdjustmentAmountV1;
  validFrom:          string;
  validTo?:           string;
}
