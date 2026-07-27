/** Payload for srs.engagement.alert.raised v1.0.0. */
export interface EngagementAlertRaisedV1Payload {
  alertId: string;
  personId: string;
  enrolmentId: string;
  policyVersionId: string;
  evidenceHash: string;
  evidenceWindowFrom: string;
  evidenceWindowTo: string;
  severityCode: string;
  statusCode: string;
}
