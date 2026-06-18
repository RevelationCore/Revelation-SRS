/**
 * Canonical import contract — enrolment data.
 */

export interface ImportEnrolment {
  externalId:           string;
  personExternalId:     string;
  programmeExternalId?: string | undefined;
  statusCode:           string;
  modeOfStudyCode:      string;
  attendanceTypeCode?:  string | undefined;
  academicYearOfEntry:  string;   // 'YYYY-YY'
  startDate:            string;   // ISO date
  expectedEndDate?:     string | undefined;
  actualEndDate?:       string | undefined;
  feeBandCode?:         string | undefined;
  fundingSourceCode?:   string | undefined;
  slcReference?:        string | undefined;
  ucasPersonalId?:      string | undefined;
}
