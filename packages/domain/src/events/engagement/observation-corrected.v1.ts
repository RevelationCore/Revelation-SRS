/** Payload for srs.engagement.observation.corrected v1.0.0. */
export interface EngagementObservationCorrectedV1Payload {
  observationId: string;
  supersededVersionId: string;
  replacementVersionId: string;
  correctionReasonCode: string;
  disputed: boolean;
  outcomeCode: string;
  dataQualityCode: string;
}
