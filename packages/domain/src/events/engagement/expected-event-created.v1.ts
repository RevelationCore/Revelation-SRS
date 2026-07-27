/** Payload for srs.engagement.expected-event.created v1.0.0. */
export interface EngagementExpectedEventCreatedV1Payload {
  expectedEventId: string;
  personId: string;
  enrolmentId: string;
  activityTypeCode: string;
  eventModeCode: string;
  scheduledFrom: string;
  scheduledTo?: string;
  sourceSystemCode: string;
  sourceEventId: string;
  sourceVersion: string;
}
