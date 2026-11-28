/**
 * Payload for srs.person.merged v1.0.0 (ADR-031 item 7). Published when an
 * identity merge has moved current ownership to the survivor. It carries ids
 * only, never names or identifiers: consumers re-key their own records.
 */
export interface PersonMergedV1Payload {
  mergeId:          string;
  survivorPersonId: string;
  mergedPersonId:   string;
  effectiveAt:      string;
}
