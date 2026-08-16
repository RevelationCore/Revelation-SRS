import { wellbeingApi } from './wellbeingModule.js';

export type AdjustmentCaseStatus =
  | 'referral_received' | 'assessment_pending' | 'under_assessment' | 'determination_made'
  | 'approved' | 'rejected' | 'under_review' | 'review_complete' | 'closed';

export interface AdjustmentAssessment {
  id: string;
  assessorId: string;
  assessedAt: string;
  outcomeCode: string;
  findings: string | null;
  recommendedAction: string | null;
}

export interface AdjustmentPanelDecision {
  id: string;
  panelChairId: string;
  panelDate: string;
  decisionCode: string;
  decisionRationale: string | null;
  distributedToSrs: boolean;
}

export interface AdjustmentCaseEvidence {
  id: string;
  documentId: string;
  evidenceTypeCode: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface AdjustmentCase {
  id: string;
  tenantId: string;
  wellbeingCaseId: string;
  disabilitySupportCaseId: string;
  personId: string;
  adjustmentTypeCode: string;
  statusCode: AdjustmentCaseStatus;
  recommendedAdjustment: string | null;
  rationale: string | null;
  dsaEntitlementId: string | null;
  srsApplicationRef: string | null;
  actorId: string;
  validFrom: string;
}

export interface AdjustmentCaseDetail extends AdjustmentCase {
  assessments: AdjustmentAssessment[];
  panelDecision: AdjustmentPanelDecision | null;
  srsHandoffStatus: string | null;
  evidence: AdjustmentCaseEvidence[];
}

export function listAdjustmentCases(personId: string): Promise<{ items: AdjustmentCase[]; total: number }> {
  return wellbeingApi.get(`/api/v1/adjustment-cases?personId=${personId}`);
}

/** Cross-student triage queue (staff-only — see routes.ts's read:all gate), optionally filtered by status. */
export function listAdjustmentCaseQueue(statusCode?: AdjustmentCaseStatus | ''): Promise<{ items: AdjustmentCase[]; total: number }> {
  return wellbeingApi.get(statusCode ? `/api/v1/adjustment-cases?statusCode=${statusCode}` : '/api/v1/adjustment-cases');
}

export function getAdjustmentCase(caseId: string): Promise<AdjustmentCaseDetail> {
  return wellbeingApi.get(`/api/v1/adjustment-cases/${caseId}`);
}

export function createAdjustmentCase(input: {
  wellbeingCaseId?: string;
  disabilitySupportCaseId?: string;
  personId: string;
  adjustmentTypeCode: string;
  rationale?: string;
  dsaEntitlementId?: string;
}): Promise<{ id: string }> {
  return wellbeingApi.post('/api/v1/adjustment-cases', input);
}

export function startAssessment(caseId: string): Promise<void> {
  return wellbeingApi.post(`/api/v1/adjustment-cases/${caseId}/start-assessment`);
}

export function requestReview(caseId: string): Promise<void> {
  return wellbeingApi.post(`/api/v1/adjustment-cases/${caseId}/request-review`);
}

export function closeAdjustmentCase(caseId: string): Promise<void> {
  return wellbeingApi.post(`/api/v1/adjustment-cases/${caseId}/close`);
}

export function recordAssessment(caseId: string, input: {
  assessorId: string;
  assessedAt: string;
  outcomeCode: string;
  findings?: string;
  recommendedAction?: string;
}): Promise<{ id: string }> {
  return wellbeingApi.post(`/api/v1/adjustment-cases/${caseId}/assessments`, input);
}

export function recordPanelDecision(caseId: string, input: {
  panelChairId: string;
  panelDate: string;
  decisionCode: string;
  decisionRationale?: string;
}): Promise<{ id: string }> {
  return wellbeingApi.post(`/api/v1/adjustment-cases/${caseId}/panel-decisions`, input);
}

export function approveAdjustmentCase(caseId: string, input: {
  enrolmentId: string;
  scopeCode: string;
  recommendedAdjustment: string;
  validFrom: string;
  validTo?: string;
  notes?: string;
  forceApprove?: boolean;
}): Promise<{ status: string; adjustmentId?: string }> {
  return wellbeingApi.post(`/api/v1/adjustment-cases/${caseId}/approve`, input);
}

export function rejectAdjustmentCase(caseId: string, rationale: string): Promise<void> {
  return wellbeingApi.post(`/api/v1/adjustment-cases/${caseId}/reject`, { rationale });
}

export function deleteEvidence(caseId: string, evidenceId: string): Promise<void> {
  return wellbeingApi.delete(`/api/v1/adjustment-cases/${caseId}/evidence/${evidenceId}`);
}
