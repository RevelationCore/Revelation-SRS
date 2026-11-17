import type { RuleVersion } from '../components/RuleVersionsPanel.js';

import { ApiError, api, getStoredToken } from './client.js';

/** Award recommendation and conferment, and reassessment plans (BPR-D14; BP-06-002/003). */

export type AwardTypeCode = 'standard' | 'exit' | 'aegrotat' | 'posthumous';

export interface AwardConferment {
  confermentId: string;
  recommendationId: string;
  awardId: string;
  confermentDate: string;
  authorityRef: string;
  conferredBy: string;
  conferredAt: string;
}

export interface AwardRecommendation {
  recommendationId: string;
  enrolmentId: string;
  personId: string;
  examBoardId: string | null;
  awardTypeCode: AwardTypeCode;
  qualificationCode: string;
  classificationCode: string;
  calculatedClassificationCode: string | null;
  aggregateMark: number | null;
  discretionReason: string | null;
  authorityRef: string | null;
  statusCode: 'recommended' | 'conferred' | 'withdrawn';
  recommendedBy: string;
  recommendedAt: string;
  withdrawnReason: string | null;
  conferment: AwardConferment | null;
}

export interface ReassessmentPlan {
  reassessmentPlanId: string;
  enrolmentId: string;
  progressionDecisionId: string;
  planTypeCode: string;
  moduleRegistrationId: string | null;
  assessmentComponentId: string | null;
  academicPeriodId: string | null;
  attemptNumber: number;
  markCap: number | null;
  dueDate: string | null;
  statusCode: 'planned' | 'completed' | 'expired' | 'cancelled';
  outcomeNote: string | null;
  createdBy: string;
  createdAt: string;
  closedBy: string | null;
  closedAt: string | null;
}

export interface ProgressionDecision {
  progressionDecisionId: string;
  enrolmentId: string;
  academicYear: string;
  yearOfStudy: string;
  decisionCode: string;
  examBoardId: string | null;
  locked: boolean;
  recordedUntil: string | null;
}

export const listAwardRecommendations = (enrolmentId: string) =>
  api.get<AwardRecommendation[]>(`/api/v1/enrolments/${enrolmentId}/award-recommendations`);
export const recommendAward = (enrolmentId: string, body: {
  awardTypeCode: AwardTypeCode; qualificationCode: string; classificationCode: string; examBoardId: string;
  discretionReason?: string; authorityRef?: string;
}) => api.post<AwardRecommendation>(`/api/v1/enrolments/${enrolmentId}/award-recommendations`, body);
export const conferAward = (recommendationId: string, body: { confermentDate: string; authorityRef: string }) =>
  api.post<AwardRecommendation>(`/api/v1/award-recommendations/${recommendationId}/conferment`, body);
export const withdrawAwardRecommendation = (recommendationId: string, reason: string) =>
  api.post<AwardRecommendation>(`/api/v1/award-recommendations/${recommendationId}/withdrawal`, { reason });

export const listReassessmentPlans = (enrolmentId: string) => api.get<ReassessmentPlan[]>(`/api/v1/enrolments/${enrolmentId}/reassessment-plans`);
export const createReassessmentPlan = (progressionDecisionId: string, body: {
  planTypeCode: string; moduleRegistrationId?: string; dueDate?: string; markCap?: number;
}) => api.post<ReassessmentPlan>(`/api/v1/progression-decisions/${progressionDecisionId}/reassessment-plans`, body);
export const closeReassessmentPlan = (planId: string, body: { statusCode: 'completed' | 'expired' | 'cancelled'; note?: string }) =>
  api.post<ReassessmentPlan>(`/api/v1/reassessment-plans/${planId}/closure`, body);

export const listProgressionHistory = (enrolmentId: string) =>
  api.get<ProgressionDecision[]>(`/api/v1/enrolments/${enrolmentId}/progression/history`);

// ── Progression (D-3) ────────────────────────────────────────────────────────

export interface ProgressionEvidence {
  requiredCredits: number;
  earnedCredits: number;
  compensationCredits: number;
  unresolvedCredits: number;
  compensationThreshold: number | null;
  compensationCreditLimit: number;
  condonementThreshold: number | null;
  decisionCode: string;
  recognisedCredits: number;
  recognisedCreditIds: string[];
  appliedExceptions: Array<{ exceptionId: string; ruleCode: string; exceptionTypeCode: string }>;
  minimumModulePasses: number | null;
  modulesPassed: number | null;
  ruleVersions: RuleVersion[];
  calculatedAt: string;
}

export const evaluateProgression = (enrolmentId: string, academicYear: string) =>
  api.post(`/api/v1/enrolments/${enrolmentId}/progression`, { academicYear });
export interface RecommendationEvidence {
  awardId: string | null; aggregateMark: number; classificationCode: string; algorithm: string;
  earnedCredits: number; requiredCredits: number | null; inDiscretionZone: boolean; ruleVersions: RuleVersion[]; calculatedAt: string;
}
export const getRecommendationEvidence = (recommendationId: string) =>
  api.get<RecommendationEvidence>(`/api/v1/award-recommendations/${recommendationId}/evidence`);

export const getProgressionEvidence = (progressionDecisionId: string) =>
  api.get<ProgressionEvidence>(`/api/v1/progression-decisions/${progressionDecisionId}/evidence`);

// ── Award documents (D-4) ────────────────────────────────────────────────────

export interface DocumentIssue {
  documentIssueId: string;
  studentDocumentId: string;
  documentTypeCode: string;
  awardId: string;
  issueNumber: number;
  issueTypeCode: string;
  contentHash: string;
  verificationCode: string;
  channelCode: string;
  statusCode: string;
  issuedBy: string;
  issuedAt: string;
  revocation: { reasonCode: string; reasonText: string; revokedBy: string; revokedAt: string } | null;
  /** Rendered and signed (D-20); null for an issue made before rendering existed. */
  rendered?: { documentId: string; templateCode: string; templateVersion: string; pdfSha256: string; signingKeyId: string | null } | null;
}

/** Revoking needs two people (D-20). */
export interface RevocationRequest {
  caseId: string; documentIssueId: string; statusCode: string; reasonCode: string; reasonText: string; requestedBy: string; requestedAt: string;
  decision: { outcome: string; decidedBy: string; decidedAt: string; note: string | null } | null;
}
export const listRevocationRequests = (documentIssueId?: string) =>
  api.get<RevocationRequest[]>(`/api/v1/document-revocation-requests?open=true${documentIssueId ? `&documentIssueId=${documentIssueId}` : ''}`);
export const decideRevocation = (caseId: string, outcome: 'approved' | 'rejected', note?: string) =>
  api.post<RevocationRequest>(`/api/v1/document-revocation-requests/${caseId}/decision`, { outcome, ...(note ? { note } : {}) });

/** Downloads an issued PDF and saves it. */
export async function downloadDocumentPdf(documentIssueId: string, filename: string): Promise<void> {
  const token = getStoredToken();
  const res = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'}/api/v1/document-issues/${documentIssueId}/pdf`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, `Download failed (${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export const listAwardDocuments = (awardId: string) => api.get<DocumentIssue[]>(`/api/v1/awards/${awardId}/documents`);
export const issueAwardDocument = (awardId: string, body: { documentTypeCode: string; channelCode: string; issueTypeCode?: string }) =>
  api.post<DocumentIssue>(`/api/v1/awards/${awardId}/documents`, body);
export const revokeDocumentIssue = (documentIssueId: string, body: { reasonCode: string; reasonText: string }) =>
  api.post(`/api/v1/document-issues/${documentIssueId}/revocation`, body);

export interface VerificationResult {
  outcomeCode: string;
  document: { documentTypeCode: string; holderName: string; qualificationCode: string; classificationCode: string; awardDate: string; issuedAt: string } | null;
  signature?: { status: 'valid' | 'invalid' | 'key-withdrawn' | 'unsigned'; keyId: string | null };
  issuer?: string;
}
/** A lookup by name and date of birth, which needs the holder's consent (D-21). */
export const lookupDocuments = (body: { legalFamilyName: string; dateOfBirth: string; consentEvidenceRef: string }) =>
  api.post<VerificationResult[]>('/api/v1/document-verifications/lookup', body);
export const verifyDocument = (verificationCode: string, requesterNote?: string) =>
  api.post<VerificationResult>('/api/v1/document-verifications', { verificationCode, ...(requesterNote ? { requesterNote } : {}) });
