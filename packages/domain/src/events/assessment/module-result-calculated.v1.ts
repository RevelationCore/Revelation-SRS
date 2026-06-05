/** Payload for srs.assessment.module-result-calculated v1.0.0 */
export interface AssessmentModuleResultCalculatedV1Payload {
  moduleResultId:       string;
  moduleRegistrationId: string;
  aggregateMark:        number;
  resultCode:           string;
}
