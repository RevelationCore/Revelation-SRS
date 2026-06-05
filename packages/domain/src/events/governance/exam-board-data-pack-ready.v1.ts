/** Payload for srs.governance.exam-board-data-pack-ready v1.0.0 */
export interface GovernanceExamBoardDataPackReadyV1Payload {
  examBoardId:    string;
  dataPackId:     string;
  boardTypeCode:  string;
  academicYear:   string;
  candidateCount: number;
  packVersion:    number;
}
