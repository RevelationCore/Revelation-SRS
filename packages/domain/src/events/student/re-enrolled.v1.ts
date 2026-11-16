/** Payload for srs.student.re-enrolled v1.0.0: a student registered for an academic year (BP-02-010; D-8). */
export interface StudentReEnrolledV1Payload {
  personId:      string;
  enrolmentId:   string;
  academicYear:  string;
  /** 'annual' re-registration, or 'initial' registration of a new entrant. */
  periodType:    string;
  /** 'portal' (the student) or 'assisted' (the registry on the student's behalf). */
  channel:       string;
  confirmedAt:   string;
}
