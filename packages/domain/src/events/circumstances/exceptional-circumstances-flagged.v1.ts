/** Payload for srs.circumstances.exceptional-circumstances-flagged v1.0.0 */
export interface CircumstancesEcFlaggedV1Payload {
  exceptionalCircumstancesId: string;
  enrolmentId:                string;
  personId:                   string;
  moduleOfferingId?:          string;
  outcomeCode:                string;
  determinationDate:          string;
}
