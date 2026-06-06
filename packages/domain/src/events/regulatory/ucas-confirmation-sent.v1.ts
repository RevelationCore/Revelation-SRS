/** Payload for srs.regulatory.ucas-confirmation-sent v1.0.0 */
export interface RegulatoryUcasConfirmationSentV1Payload {
  enrolmentId:      string;
  ucasPersonalId:   string;
  cycle:            string;
  confirmationType: 'enrolled' | 'withdrawn' | 'deferred';
  exchangeId:       string;
}
