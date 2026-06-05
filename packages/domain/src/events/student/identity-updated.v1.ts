/** Payload for srs.student.identity-updated v1.0.0 */
export interface StudentIdentityUpdatedV1Payload {
  personId:       string;
  changedFields:  string[];
  effectiveDate:  string;  // ISO 8601
}
