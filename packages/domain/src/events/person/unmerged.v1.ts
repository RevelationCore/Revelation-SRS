/**
 * Payload for srs.person.unmerged v1.0.0 (ADR-031 item 10). Published when an
 * identity merge has been reversed. Consumers reverse the moves they recorded
 * for mergeId. reallocatedToRestored lists, per core table, the ids of
 * records created on the survivor after the merge that the decision gave to
 * the restored person. Ids only, never names or identifiers.
 */
export interface PersonUnmergedV1Payload {
  mergeId:               string;
  survivorPersonId:      string;
  restoredPersonId:      string;
  effectiveAt:           string;
  reallocatedToRestored: Record<string, string[]>;
}
