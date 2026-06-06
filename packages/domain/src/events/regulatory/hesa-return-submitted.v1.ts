/** Payload for srs.regulatory.hesa-return-submitted v1.0.0 */
export interface RegulatoryHesaReturnSubmittedV1Payload {
  returnId:            string;
  academicYear:        string;
  submissionReference: string | null;
  submittedAt:         string;
}
