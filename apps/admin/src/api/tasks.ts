import { api } from './client.js';

export interface WorkflowOutcomeOption {
  code:  string;
  label: string;
}

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
  outcomeOptions:    WorkflowOutcomeOption[] | null;
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
  opts?: { payload?: Record<string, unknown>; decisionCode?: string; note?: string },
): Promise<void> {
  return api.post(`/api/v1/workflow-tasks/${taskId}/completion`, {
    payload: opts?.payload ?? {},
    ...(opts?.decisionCode ? { decisionCode: opts.decisionCode } : {}),
    ...(opts?.note ? { note: opts.note } : {}),
  });
}
