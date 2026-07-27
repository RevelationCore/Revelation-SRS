/** Payload for srs.engagement.observation.recorded v1.0.0. */
export interface EngagementObservationRecordedV1Payload {
  observationId: string;
  expectedEventId?: string;
  personId: string;
  enrolmentId: string;
  captureMethodCode: string;
  outcomeCode: string;
  dataQualityCode: string;
  eventTime: string;
  sourceSystemCode: string;
  sourceEventId: string;
  sourceVersion: string;
}
