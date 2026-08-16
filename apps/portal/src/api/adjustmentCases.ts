import { wellbeingApi } from './wellbeingModule.js';

export type AdjustmentCaseStatus =
  | 'referral_received' | 'assessment_pending' | 'under_assessment' | 'determination_made'
  | 'approved' | 'rejected' | 'under_review' | 'review_complete' | 'closed';

export interface AdjustmentCaseEvidence {
  id: string;
  documentId: string;
  evidenceTypeCode: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface AdjustmentCase {
  id: string;
  personId: string;
  adjustmentTypeCode: string;
  statusCode: AdjustmentCaseStatus;
  recommendedAdjustment: string | null;
  rationale: string | null;
  validFrom: string;
}

export interface AdjustmentCaseDetail extends AdjustmentCase {
  evidence: AdjustmentCaseEvidence[];
}

export function listMyAdjustmentCases(personId: string): Promise<{ items: AdjustmentCase[]; total: number }> {
  return wellbeingApi.get(`/api/v1/adjustment-cases?personId=${personId}`);
}

export function getMyAdjustmentCase(caseId: string): Promise<AdjustmentCaseDetail> {
  return wellbeingApi.get(`/api/v1/adjustment-cases/${caseId}`);
}

export function requestAdjustment(input: {
  personId: string;
  adjustmentTypeCode: string;
  rationale?: string;
}): Promise<{ id: string }> {
  return wellbeingApi.post('/api/v1/adjustment-cases', input);
}

export function deleteMyEvidence(caseId: string, evidenceId: string): Promise<void> {
  return wellbeingApi.delete(`/api/v1/adjustment-cases/${caseId}/evidence/${evidenceId}`);
}
