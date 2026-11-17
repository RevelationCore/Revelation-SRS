/** Payload for srs.governance.exam-board-ratified v1.0.0 */
export interface GovernanceExamBoardRatifiedV1Payload {
  examBoardId:                 string;
  boardTypeCode:               string;
  academicYear:                string;
  ratifiedAt:                  string;
  externalExaminerConfirmedAt: string;
  /** The hash of the data pack the board was ratified against (D-36). */
  packHash?:                   string;
}
