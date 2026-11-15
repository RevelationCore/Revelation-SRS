import type { AdjustmentAmountV1 } from './amount.js';

/** Payload for srs.adjustment.approved v1.0.0 */
export interface AdjustmentApprovedV1Payload {
  adjustmentId:      string;
  enrolmentId:       string;
  personId:          string;
  adjustmentTypeCode: string;
  scopeCode:         string;
  /** Absent when the adjustment type has no amount or none was recorded. */
  amount?:           AdjustmentAmountV1;
  validFrom:         string;
  validTo?:          string;
}
