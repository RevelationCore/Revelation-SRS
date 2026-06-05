/** Payload for srs.enrolment.fee-liability-generated v1.0.0 */
export interface EnrolmentFeeLiabilityGeneratedV1Payload {
  personId:          string;
  enrolmentId:       string;
  feeLiabilityId:    string;
  academicYear:      string;
  feeBandCode?:      string | undefined;
  fundingSourceCode?: string | undefined;
}
