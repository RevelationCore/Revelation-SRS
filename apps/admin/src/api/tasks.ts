import { api } from './client.js';

export interface WorkflowTask {
  workflowTaskId:    string;
  workflowInstanceId: string;
  stepKey:           string;
  taskTypeCode:      string;
  statusCode:        string;
  assigneeActorId:   string | null;
  assigneeRoleCode:  string | null;
  dueAt:             string | null;
  completedBy:       string | null;
  completedAt:       string | null;
  payload:           Record<string, unknown>;
  createdAt:         string;
}

export function listWorkflowTasks(params?: {
  statusCode?:        string;
  assigneeRoleCode?:  string;
}): Promise<WorkflowTask[]> {
  const qs = new URLSearchParams();
  if (params?.statusCode)       qs.set('statusCode',       params.statusCode);
  if (params?.assigneeRoleCode) qs.set('assigneeRoleCode', params.assigneeRoleCode);
  const q = qs.toString();
  return api.get<WorkflowTask[]>(`/api/v1/workflow-tasks${q ? `?${q}` : ''}`);
}

export function completeWorkflowTask(
  taskId:  string,
  payload?: Record<string, unknown>,
): Promise<void> {
  return api.post(`/api/v1/workflow-tasks/${taskId}/completion`, { payload: payload ?? {} });
}
