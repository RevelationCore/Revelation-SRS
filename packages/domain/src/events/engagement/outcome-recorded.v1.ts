/** Payload for srs.engagement.outcome-recorded v1.0.0 */
export interface EngagementOutcomeRecordedV1Payload {
  engagementOutcomeId: string;
  personId: string;
  enrolmentId: string;
  moduleRegistrationId?: string;
  outcomeCode: string;
  severityCode?: string;
  effectiveFrom: string;
}
