import { api } from './client.js';

export type RightsRequestType =
  | 'access' | 'rectification' | 'erasure' | 'restriction' | 'portability' | 'objection';

export interface IndividualRightsRequest {
  individualRightsRequestId: string;
  personId:                  string;
  requestTypeCode:           string;
  statusCode:                string;
  ownerId:                   string;
  receivedAt:                string;
  statutoryDeadlineDate:     string;
}

export function listRequests(statusCode?: string): Promise<IndividualRightsRequest[]> {
  const qs = statusCode ? `?statusCode=${statusCode}` : '';
  return api.get(`/api/v1/rights-requests${qs}`);
}

export interface RetentionSchedule {
  retentionScheduleId:   string;
  entityType:            string;
  retentionPeriodMonths: string;
  triggerEventCode:      string;
  description:           string | null;
}

export function listSchedules(): Promise<RetentionSchedule[]> {
  return api.get('/api/v1/retention-schedules');
}

export interface RetentionAssignment {
  retentionAssignmentId: string;
  retentionScheduleId:   string;
  entityType:            string;
  entityId:              string;
  assignedAt:            string;
  scheduledDisposalDate: string | null;
  hasActiveHold:         boolean;
  disposed:              boolean;
}

export function listAssignments(retentionScheduleId?: string): Promise<RetentionAssignment[]> {
  const qs = retentionScheduleId ? `?retentionScheduleId=${retentionScheduleId}` : '';
  return api.get(`/api/v1/retention-assignments${qs}`);
}

export function openRequest(body: {
  personId:              string;
  requestTypeCode:       RightsRequestType;
  statutoryDeadlineDate: string;
  ownerId:               string;
}): Promise<{ requestId: string }> {
  return api.post('/api/v1/rights-requests', body);
}

export function addScope(
  requestId: string,
  body: { scopeEntityType: string; scopeDescription?: string },
): Promise<{ scopeId: string }> {
  return api.post(`/api/v1/rights-requests/${requestId}/scope`, body);
}

export function recordSearch(
  requestId: string,
  body: { searchedSystem: string; recordCount: number },
): Promise<{ manifestId: string }> {
  return api.post(`/api/v1/rights-requests/${requestId}/search-manifest`, body);
}

export type RightsDecisionType = 'granted' | 'partially-granted' | 'refused';

export function decide(
  requestId: string,
  body: { decisionTypeCode: RightsDecisionType; legalBasis?: string },
): Promise<{ decisionId: string }> {
  return api.post(`/api/v1/rights-requests/${requestId}/decision`, body);
}

export function applyRestriction(body: {
  personId:            string;
  restrictionTypeCode: string;
  rightsDecisionId?:   string;
}): Promise<{ restrictionId: string }> {
  return api.post('/api/v1/rights-restrictions', body);
}

export function liftRestriction(restrictionId: string): Promise<void> {
  return api.patch(`/api/v1/rights-restrictions/${restrictionId}/lift`, {});
}

export function createSchedule(body: {
  entityType:            string;
  retentionPeriodMonths: string;
  triggerEventCode:      string;
  description?:          string;
}): Promise<{ retentionScheduleId: string }> {
  return api.post('/api/v1/retention-schedules', body);
}

export function assignSchedule(
  scheduleId: string,
  body: { entityType: string; entityId: string; scheduledDisposalDate?: string },
): Promise<{ retentionAssignmentId: string }> {
  return api.post(`/api/v1/retention-schedules/${scheduleId}/assignments`, body);
}

export function placeHold(assignmentId: string, holdReasonCode: string): Promise<{ holdId: string }> {
  return api.post(`/api/v1/retention-assignments/${assignmentId}/holds`, { holdReasonCode });
}

export type DispositionType = 'anonymised' | 'deleted' | 'transferred';

export function recordDisposition(
  assignmentId: string,
  body: { dispositionTypeCode: DispositionType; evidenceRef?: string },
): Promise<{ dispositionId: string }> {
  return api.post(`/api/v1/retention-assignments/${assignmentId}/disposition`, body);
}
