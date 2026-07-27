/** Payload for srs.engagement.alert.suspended v1.0.0. */
export interface EngagementAlertSuspendedV1Payload {
  alertId: string;
  personId: string;
  enrolmentId: string;
  policyVersionId: string;
  evidenceHash: string;
  evidenceWindowFrom: string;
  evidenceWindowTo: string;
  severityCode: string;
  statusCode: string;
  reasonCode: string;
}
