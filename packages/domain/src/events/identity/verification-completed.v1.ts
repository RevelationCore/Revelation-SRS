/** Payload for srs.identity.verification-completed v1.0.0 */
export interface IdentityVerificationCompletedV1Payload {
  personId:             string;
  verificationCheckId:  string;
  statusCode:           string;
  fraudFlag:            boolean;
}
