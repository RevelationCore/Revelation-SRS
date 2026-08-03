import { api } from './client.js';

export interface ModuleRegistrationChangeRequest {
  workflowInstanceId: string;
  workflowTaskId:      string;
  statusCode:          string;
  context:             Record<string, unknown>;
  startedAt:           string;
}

export function listModuleRegistrationRequests(): Promise<ModuleRegistrationChangeRequest[]> {
  return api.get<ModuleRegistrationChangeRequest[]>('/api/v1/module-registration-requests');
}

export function decideModuleRegistrationRequest(
  workflowInstanceId: string,
  decisionCode: 'approved' | 'rejected',
  reason?: string,
): Promise<{ moduleRegistrationId: string | null }> {
  return api.post(`/api/v1/module-registration-requests/${workflowInstanceId}/decision`, { decisionCode, reason });
}
