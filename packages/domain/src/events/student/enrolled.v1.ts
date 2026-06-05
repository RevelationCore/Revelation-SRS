/** Payload for srs.student.enrolled v1.0.0 */
export interface StudentEnrolledV1Payload {
  personId:        string;
  enrolmentId:     string;
  programmeId?:    string | undefined;
  academicYear:    string;
  modeOfStudy:     string;
  fundingSource?:  string | undefined;
}
