/** Payload for srs.enrolment.module-selection-proposal-decided v1.0.0 */
export interface EnrolmentModuleSelectionProposalDecidedV1Payload {
  enrolmentId: string;
  moduleSelectionProposalId: string;
  statusCode: string;
  decisionAuthorityCode: string | null;
}
