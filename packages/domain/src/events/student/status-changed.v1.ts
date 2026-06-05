/** Payload for srs.student.status-changed v1.0.0 */
export interface StudentStatusChangedV1Payload {
  personId:       string;
  enrolmentId:    string;
  previousStatus: string;
  newStatus:      string;
  effectiveDate:  string;  // ISO 8601
  reasonCode?:    string | undefined;
}
