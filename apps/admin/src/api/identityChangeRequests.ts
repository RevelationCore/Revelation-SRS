import { api } from './client.js';

export interface IdentityChangeRequest {
  workflowInstanceId: string;
  workflowTaskId:      string;
  statusCode:          string;
  context:             Record<string, unknown>;
  startedAt:           string;
}

export function listIdentityChangeRequests(): Promise<IdentityChangeRequest[]> {
  return api.get<IdentityChangeRequest[]>('/api/v1/identity-change-requests');
}

export function decideIdentityChangeRequest(
  workflowInstanceId: string,
  decisionCode: 'approved' | 'rejected',
  reason?: string,
): Promise<void> {
  return api.post(`/api/v1/identity-change-requests/${workflowInstanceId}/decision`, { decisionCode, reason });
}
