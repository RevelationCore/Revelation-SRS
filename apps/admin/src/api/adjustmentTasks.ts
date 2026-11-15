import { api } from './client.js';

/** A manual adjustment task: an instruction for a target with no connected system. */
export interface AdjustmentTask {
  distributionId:     string;
  adjustmentId:       string;
  targetSystem:       string;
  /** apply: make it so in the target system; remove: undo it (the adjustment ended). */
  action:             'apply' | 'remove';
  statusCode:         string;
  failureReason:      string | null;
  personId:           string;
  studentNumber:      string | null;
  studentName:        string | null;
  enrolmentId:        string;
  adjustmentTypeCode: string;
  scopeCode:          string;
  amount:             { value: number; unitCode: string } | null;
  validFrom:          string;
  validTo:            string | null;
  dueSince:           string;
  ownerDescription:   string | null;
  overdue:            boolean;
}

export interface AdjustmentTargetConfig {
  targetSystem:       string;
  fulfilmentModeCode: string;
  ownerDescription:   string | null;
  alertAfterHours:    number;
  isDefault:          boolean;
  updatedAt:          string | null;
  updatedBy:          string | null;
}

export function listAdjustmentTasks(targetSystem?: string): Promise<AdjustmentTask[]> {
  const query = targetSystem ? `?targetSystem=${encodeURIComponent(targetSystem)}` : '';
  return api.get<AdjustmentTask[]>(`/api/v1/adjustment-tasks${query}`);
}

function distributionUrl(task: AdjustmentTask, action: string): string {
  return `/api/v1/adjustments/${task.adjustmentId}/distributions/${task.distributionId}/${action}`;
}

export function confirmApplied(task: AdjustmentTask): Promise<void> {
  return api.post(distributionUrl(task, 'acknowledge'), { targetSystem: task.targetSystem });
}

export function confirmRemoved(task: AdjustmentTask): Promise<void> {
  return api.post(distributionUrl(task, 'withdrawal/acknowledge'), { targetSystem: task.targetSystem });
}

export function reportCannotApply(task: AdjustmentTask, reason: string): Promise<void> {
  return api.post(distributionUrl(task, 'failure'), { targetSystem: task.targetSystem, reason });
}

export function listAdjustmentTargets(): Promise<AdjustmentTargetConfig[]> {
  return api.get<AdjustmentTargetConfig[]>('/api/v1/adjustment-targets');
}

export function setAdjustmentTarget(
  targetSystem: string,
  body: { fulfilmentModeCode: string; ownerDescription?: string | null; alertAfterHours?: number },
): Promise<AdjustmentTargetConfig> {
  return api.put<AdjustmentTargetConfig>(`/api/v1/adjustment-targets/${encodeURIComponent(targetSystem)}`, body);
}
