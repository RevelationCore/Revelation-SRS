/** Payload for srs.student.created v1.0.0 */
export interface StudentCreatedV1Payload {
  personId:         string;
  studentNumber:    string;
  tenantId:         string;
  sourceSystem?:    string;
  sourceReference?: string;
}
