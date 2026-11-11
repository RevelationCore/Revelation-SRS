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
  /** 'temporal' tasks are applied by the workflow service after the decision is saved. */
  executionBackend?: 'legacy' | 'temporal';
  revision?:         number;
  escalatedAt?:      string | null;
  /** Set when a deadline passed and nobody was configured to escalate to. */
  attentionReasonCode?: string | null;
}

/** Receipt for a decision on a Temporal-run task. Legacy tasks return nothing. */
export interface WorkflowDecisionReceipt {
  commandId:    string;
  workflowInstanceId: string;
  decisionCode: string | null;
  /** applied: done. pending: saved, will be applied shortly. */
  status:       'applied' | 'pending' | 'failed' | 'superseded';
  acceptedAt:   string;
  appliedAt:    string | null;
  errorDetail:  string | null;
  statusUrl:    string;
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
): Promise<WorkflowDecisionReceipt | undefined> {
  return api.post<WorkflowDecisionReceipt | undefined>(`/api/v1/workflow-tasks/${taskId}/completion`, {
    payload: opts?.payload ?? {},
    ...(opts?.decisionCode ? { decisionCode: opts.decisionCode } : {}),
    ...(opts?.note ? { note: opts.note } : {}),
  });
}

export function getWorkflowCommand(commandId: string): Promise<WorkflowDecisionReceipt> {
  return api.get<WorkflowDecisionReceipt>(`/api/v1/workflow-commands/${commandId}`);
}
