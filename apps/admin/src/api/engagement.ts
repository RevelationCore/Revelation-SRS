import { ApiError, api, getStoredToken } from './client.js';

export interface EngagementEvent {
  expectedEventId: string; personId: string; enrolmentId: string; activityTypeCode: string;
  activityReference: string | null; eventModeCode: string; scheduledFrom: string;
  statusCode: string; sourceSystemCode: string;
}
export interface EngagementAlert {
  alertId: string; personId: string; enrolmentId: string; policyVersionId: string;
  evidenceWindowFrom: string; evidenceWindowTo: string; evidenceSnapshot: {
    expectedEventCount?: number; absenceCount?: number; absenceRate?: number; unsafeEvidenceCount?: number;
  };
  explanation: { decision?: string; automatedAdverseActionPermitted?: boolean; policyCode?: string; policyVersion?: number };
  severityCode: string; statusCode: string; reevaluationRequired: boolean; recordedAt: string;
}
export interface EngagementPolicy {
  policyVersionId: string; policyCode: string; versionNumber: number; displayName: string;
  statusCode: string; validFrom: string; validTo: string | null;
  alertRules: Record<string, unknown>; evidenceWindow: Record<string, unknown>;
}
export interface InterventionCaseView {
  intervention: {
    id: string; versionId: string; alertId: string; personId: string; enrolmentId: string;
    statusCode: string; outcomeCode: string | null; assignedRoleCode: string | null;
    assignedActorId: string | null; openedAt: string; reviewAt: string | null; dueAt: string | null;
  };
  contacts: Array<{
    id: string; channelCode: string; attemptedAt: string; outcomeCode: string;
    communicationLocale: string | null; operationalNote: string | null;
  }>;
  actions: Array<{
    id: string; actionTypeCode: string; operationalInstruction: string | null;
    ownerRoleCode: string | null; dueAt: string | null;
  }>;
  referrals: Array<{
    id: string; targetServiceCode: string; referralTypeCode: string;
    statusCode: string; externalReference: string | null; referredAt: string;
  }>;
}

export const listEngagementEvents = () => api.get<EngagementEvent[]>('/api/v1/engagement/events');
export const listEngagementAlerts = () => api.get<EngagementAlert[]>('/api/v1/engagement/alerts');
export const listEngagementPolicies = () => api.get<EngagementPolicy[]>('/api/v1/engagement/policies');
export const getInterventionCase = (caseId: string) =>
  api.get<InterventionCaseView>(`/api/v1/engagement/cases/${caseId}`);

export function createEngagementPolicy(body: Record<string, unknown>) {
  return api.post<EngagementPolicy>('/api/v1/engagement/policies', body);
}
export function triageAlert(alertId: string, body: Record<string, unknown>) {
  return idempotentPost<{ interventionCaseId: string | null; created: boolean }>(
    `/api/v1/engagement/alerts/${alertId}/triage`, body,
  );
}
export function recordCaseContact(caseId: string, body: Record<string, unknown>) {
  return idempotentPost(`/api/v1/engagement/cases/${caseId}/contacts`, body);
}
export function addCaseAction(caseId: string, body: Record<string, unknown>) {
  return idempotentPost(`/api/v1/engagement/cases/${caseId}/actions`, body);
}
export function reviewCase(caseId: string, body: Record<string, unknown>) {
  return idempotentPost(`/api/v1/engagement/cases/${caseId}/review`, body);
}

async function idempotentPost<T = unknown>(path: string, body: Record<string, unknown>): Promise<T> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
      ...(getStoredToken() ? { Authorization: `Bearer ${getStoredToken()!}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({})) as { title?: string; detail?: string };
    throw new ApiError(response.status, problem.title ?? 'Request failed', problem.detail);
  }
  return response.json() as Promise<T>;
}
