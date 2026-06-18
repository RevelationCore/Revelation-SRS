/**
 * Canonical import contract — module registrations and marks.
 */

export interface ImportModuleRegistration {
  externalId:               string;
  personExternalId:         string;
  enrolmentExternalId:      string;
  moduleOfferingExternalId: string;
  statusCode:               string;
  registrationDate:         string;   // ISO date
}

export interface ImportMark {
  moduleRegistrationExternalId: string;
  componentTypeCode:            string;
  rawMark:                      number;   // 0–100
  submittedAt:                  string;   // ISO datetime
  sourceSystem?:                string | undefined;
  sourceReference?:             string | undefined;
}
