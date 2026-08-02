import { api } from './client.js';

export function declareConflict(
  examBoardId: string,
  body: { enrolmentId?: string; conflictTypeCode: string },
): Promise<{ conflictId: string }> {
  return api.post(`/api/v1/exam-boards/${examBoardId}/conflicts`, body);
}

export function recuseMember(conflictId: string): Promise<void> {
  return api.patch(`/api/v1/board-conflicts/${conflictId}/recuse`, {});
}

export function recordQuorumDecision(
  examBoardId: string,
  body: { requiredCount: number; attendingCount: number },
): Promise<{ quorumDecisionId: string; quorumMet: boolean }> {
  return api.post(`/api/v1/exam-boards/${examBoardId}/quorum-decision`, body);
}

export type BoardDecisionTypeCode = 'ratify' | 'defer' | 'refer-back';

export function recordBoardDecision(
  examBoardId: string,
  body: { dataPackId: string; decisionTypeCode: BoardDecisionTypeCode; rationale?: string },
): Promise<{ decisionId: string }> {
  return api.post(`/api/v1/exam-boards/${examBoardId}/decisions`, body);
}

export function createRatificationRecord(decisionId: string): Promise<{ ratificationRecordId: string }> {
  return api.post(`/api/v1/board-decisions/${decisionId}/ratification`, {});
}

export function publishResults(ratificationRecordId: string): Promise<void> {
  return api.patch(`/api/v1/ratification-records/${ratificationRecordId}/publish`, {});
}
