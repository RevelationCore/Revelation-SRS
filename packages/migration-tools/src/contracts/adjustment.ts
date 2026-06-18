/**
 * Canonical import contract — adjustments and exceptional circumstances.
 */

export interface ImportAdjustment {
  externalId:          string;
  personExternalId:    string;
  enrolmentExternalId: string;
  adjustmentTypeCode:  string;
  scopeCode:           string;
  notes?:              string | undefined;
  validFrom:           string;
  validTo?:            string | undefined;
}

export interface ImportExceptionalCircumstance {
  externalId:              string;
  personExternalId:        string;
  enrolmentExternalId:     string;
  outcomeCode:             string;
  determinationDate:       string;
  notes?:                  string | undefined;
  moduleOfferingExternalId?: string | undefined;
}
