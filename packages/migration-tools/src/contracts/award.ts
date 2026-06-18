/**
 * Canonical import contract — awards.
 */

export interface ImportAward {
  externalId:            string;
  enrolmentExternalId:   string;
  personExternalId:      string;
  qualificationTypeCode: string;
  classificationCode?:   string | undefined;
  conferralDate?:        string | undefined;
}
