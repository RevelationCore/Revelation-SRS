/** Payload for srs.assessment.mark-received v1.0.0 */
export interface AssessmentMarkReceivedV1Payload {
  markId:                  string;
  moduleRegistrationId:    string;
  assessmentComponentId:   string;
  assessmentSubmissionId?: string;
  rawMark:                 number;
  adjustedMark:            number;
  attemptNumber:           number;
  penaltyApplied:          boolean;
  sourceSystem?:           string;
}
