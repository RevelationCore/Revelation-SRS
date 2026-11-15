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
  notifyEmail:        string | null;
  lastOverdueNoticeAt: string | null;
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
  body: { fulfilmentModeCode: string; ownerDescription?: string | null; alertAfterHours?: number; notifyEmail?: string | null },
): Promise<AdjustmentTargetConfig> {
  return api.put<AdjustmentTargetConfig>(`/api/v1/adjustment-targets/${encodeURIComponent(targetSystem)}`, body);
}

// ── Other outbound flows (platform delivery ledger) ─────────────────────────

export interface DeliveryTask {
  deliveryItemId:   string;
  flowCode:         string;
  flowName:         string;
  targetLabel:      string;
  subjectType:      string;
  subjectId:        string;
  personId:         string | null;
  studentNumber:    string | null;
  studentName:      string | null;
  payload:          Record<string, unknown>;
  summary:          string;
  statusCode:       string;
  failureReason:    string | null;
  createdAt:        string;
  ownerDescription: string | null;
  overdue:          boolean;
}

export interface DeliveryFlowConfig {
  flowCode:            string;
  targetSystem:        string;
  targetLabel:         string;
  name:                string;
  producer:            'implemented' | 'none';
  producerNote:        string;
  fulfilmentModeCode:  string;
  ownerDescription:    string | null;
  alertAfterHours:     number;
  notifyEmail:         string | null;
  lastOverdueNoticeAt: string | null;
  isDefault:           boolean;
}

export function listDeliveryTasks(flowCode?: string): Promise<DeliveryTask[]> {
  const query = flowCode ? `?flowCode=${encodeURIComponent(flowCode)}` : '';
  return api.get<DeliveryTask[]>(`/api/v1/delivery-tasks${query}`);
}

export function confirmDelivered(task: DeliveryTask): Promise<void> {
  return api.post(`/api/v1/delivery-items/${task.deliveryItemId}/acknowledge`, {});
}

export function reportDeliveryFailure(task: DeliveryTask, reason: string): Promise<void> {
  return api.post(`/api/v1/delivery-items/${task.deliveryItemId}/failure`, { reason });
}

export function listDeliveryFlows(): Promise<DeliveryFlowConfig[]> {
  return api.get<DeliveryFlowConfig[]>('/api/v1/delivery-flows');
}

export function setDeliveryFlow(
  flowCode: string,
  body: { fulfilmentModeCode: string; ownerDescription?: string | null; alertAfterHours?: number; notifyEmail?: string | null },
): Promise<DeliveryFlowConfig> {
  return api.put<DeliveryFlowConfig>(`/api/v1/delivery-flows/${encodeURIComponent(flowCode)}`, body);
}
