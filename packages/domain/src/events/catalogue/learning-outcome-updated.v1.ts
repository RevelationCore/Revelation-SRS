/** Payload for srs.catalogue.learning-outcome-updated v1.0.0 */
export interface CatalogueLearningOutcomeUpdatedV1Payload {
  learningOutcomeId: string;
  programmeId:       string | null;
  moduleId:          string | null;
  outcomeCode:       string;
  effectiveDate:     string;
}
