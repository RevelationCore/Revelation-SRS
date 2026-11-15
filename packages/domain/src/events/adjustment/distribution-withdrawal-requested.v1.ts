/**
 * Payload for srs.adjustment.distribution-withdrawal-requested v1.0.0
 *
 * An instruction to ONE target system to remove an adjustment it was
 * previously told to apply, because the adjustment has ended. Sent only for
 * distributions whose distribution-requested instruction was published —
 * whether or not the target acknowledged it, since it may have applied it
 * without the acknowledgement arriving. Target systems such as VLEs do not
 * lapse overrides on their own, so this is the only removal signal.
 *
 * Subject and delivery rules match distribution-requested
 * (srs.adjustment.distribution-withdrawal-requested.<target>, at-least-once,
 * stable envelope id). The consumer confirms removal through the SRS API.
 */
export interface AdjustmentDistributionWithdrawalRequestedV1Payload {
  distributionId: string;
  adjustmentId:   string;
  targetSystem:   string;
  personId:       string;
  enrolmentId:    string;
  /** When the adjustment's valid period ended. */
  endedAt:        string;
  reasonCode:     'expired';
  requestedAt:    string;
}
