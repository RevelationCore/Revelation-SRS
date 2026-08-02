import { api } from './client.js';

export interface AuditReviewCase {
  auditReviewCaseId: string;
  statusCode:        string;
  ownerId:            string;
  createdAt:          string;
}

export function listCases(statusCode?: string): Promise<AuditReviewCase[]> {
  const qs = statusCode ? `?statusCode=${statusCode}` : '';
  return api.get(`/api/v1/audit-review/cases${qs}`);
}

export function openReviewCase(ownerId: string): Promise<{ auditReviewCaseId: string }> {
  return api.post('/api/v1/audit-review/cases', { ownerId });
}

export type FindingTypeCode = 'no-concern' | 'policy-breach' | 'tamper-suspected' | 'investigation-required';

export function addFinding(
  caseId: string,
  body: { auditRecordId: string; findingTypeCode: FindingTypeCode; description?: string },
): Promise<{ findingId: string }> {
  return api.post(`/api/v1/audit-review/cases/${caseId}/findings`, body);
}

export function sealPartition(rangeStart: string, rangeEnd: string): Promise<{ sealId: string }> {
  return api.post('/api/v1/audit-review/seal', { rangeStart, rangeEnd });
}
