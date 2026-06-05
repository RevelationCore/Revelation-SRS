/** Payload for srs.enrolment.module-registration-withdrawn v1.0.0 */
export interface EnrolmentModuleRegistrationWithdrawnV1Payload {
  enrolmentId: string;
  moduleRegistrationId: string;
  moduleOfferingId: string;
  withdrawnAt: string;
}
