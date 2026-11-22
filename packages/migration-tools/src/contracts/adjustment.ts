/**
 * Canonical import contract — adjustments and exceptional circumstances.
 */

export interface ImportAdjustment {
  externalId:          string;
  personExternalId:    string;
  enrolmentExternalId: string;
  adjustmentTypeCode:  string;
  scopeCode:           string;
  /**
   * The amount the previous system recorded, e.g. { value: 25, unitCode:
   * 'percent-of-duration' } for 25% extra time. Without it, targets that need
   * a number (exam entries, the VLE) cannot apply the adjustment.
   */
  amount?:             { value: number; unitCode: string } | undefined;
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
