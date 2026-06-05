/** Payload for srs.catalogue.module-relationship-updated v1.0.0 */
export interface CatalogueModuleRelationshipUpdatedV1Payload {
  relationshipId:       string;
  moduleId:             string;
  relatedModuleId:      string;
  relationshipTypeCode: string;
  effectiveDate:         string;
}
