/** Payload for srs.governance.record-locked v1.0.0 */
export interface GovernanceRecordLockedV1Payload {
  examBoardId:       string;
  lockedEntityTypes: string[];
  lockedCount:       number;
}
