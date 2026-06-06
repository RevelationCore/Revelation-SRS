/** Payload for srs.governance.exam-schedule-received v1.0.0 */
export interface GovernanceExamScheduleReceivedV1Payload {
  examBoardId:    string;
  receiptId:      string;
  candidateCount: number;
  receivedAt:     string;
}
