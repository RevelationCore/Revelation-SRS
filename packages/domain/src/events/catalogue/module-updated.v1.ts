/** Payload for srs.catalogue.module-updated v1.0.0 */
export interface CatalogueModuleUpdatedV1Payload {
  moduleId:     string;
  code:         string;
  title:        string;
  creditValue:  number | null;
  effectiveDate: string;
}
