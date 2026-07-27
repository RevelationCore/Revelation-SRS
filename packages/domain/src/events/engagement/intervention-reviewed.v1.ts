export interface EngagementInterventionReviewedV1Payload {
  interventionCaseId: string;
  personId: string;
  statusCode: string;
  reviewAt: string;
  outcomeCode?: string;
}
