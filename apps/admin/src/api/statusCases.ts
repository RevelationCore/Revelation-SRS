import { api } from './client.js';

/** Governed changes to a student's study status (BPR-D04; BP-02-006 to 009, 012). */

export type StatusCaseType = 'interruption' | 'suspension' | 'return' | 'withdrawal' | 'transfer' | 'leaver-closure';

export interface StatusCaseCondition {
  conditionId: string;
  statusCaseId: string;
  conditionTypeCode: string;
  description: string;
  dueDate: string | null;
  statusCode: 'open' | 'met' | 'waived';
  evidenceRef: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export interface StatusCaseSubject { personId: string; studentNumber: string; studentName: string; programmeCode: string | null; programmeTitle: string | null }

export interface StatusCase {
  statusCaseId: string;
  enrolmentId: string;
  personId: string;
  caseTypeCode: StatusCaseType;
  initiatedByCode: 'student' | 'institution';
  reasonCategoryCode: string | null;
  requestedEffectiveDate: string;
  expectedReturnDate: string | null;
  destinationProgrammeId: string | null;
  destinationModeOfStudyCode: string | null;
  destinationStudyIntensityPercent: number | null;
  transferKinds: string[];
  /** Advice for the decider, such as the SLC 25% intensity floor (Phase 4 D-31). */
  warnings: string[];
  /** Credit this transfer maps to the destination (D-32). */
  creditMappings: Array<{ recognisedCreditId: string; moduleId: string | null; creditValue: number; statusCode: string; sourceDescription: string }>;
  relatedCaseId: string | null;
  institutionalOutcomeRef: string | null;
  statusCode: 'requested' | 'approved' | 'rejected' | 'withdrawn';
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  approvedEffectiveDate: string | null;
  approvedReturnDate: string | null;
  createdBy: string;
  createdAt: string;
  assessments: Array<{ assessmentId: string; assessorRoleCode: string; outcomeCode: string; note: string | null; assessedBy: string; assessedAt: string }>;
  conditions: StatusCaseCondition[];
  outstandingReturnConditions: StatusCaseCondition[];
  subject?: StatusCaseSubject;
}

export interface OpenStatusCaseInput {
  caseTypeCode: StatusCaseType;
  initiatedByCode?: 'student' | 'institution';
  reasonCategoryCode?: string;
  requestedEffectiveDate: string;
  expectedReturnDate?: string;
  destinationProgrammeId?: string;
  destinationModeOfStudyCode?: string;
  destinationStudyIntensityPercent?: number;
  relatedCaseId?: string;
  institutionalOutcomeRef?: string;
}

export const listOpenStatusCases = () => api.get<StatusCase[]>('/api/v1/status-cases');
export const getStatusCase = (id: string) => api.get<StatusCase>(`/api/v1/status-cases/${id}`);
export const listEnrolmentStatusCases = (enrolmentId: string) => api.get<StatusCase[]>(`/api/v1/enrolments/${enrolmentId}/status-cases`);
export const openStatusCase = (enrolmentId: string, body: OpenStatusCaseInput) => api.post<StatusCase>(`/api/v1/enrolments/${enrolmentId}/status-cases`, body);
export const assessStatusCase = (id: string, body: { assessorRoleCode: string; outcomeCode: string; note?: string }) =>
  api.post<StatusCase>(`/api/v1/status-cases/${id}/assessments`, body);
export const addStatusCaseCondition = (id: string, body: { conditionTypeCode: string; description: string; dueDate?: string }) =>
  api.post<StatusCase>(`/api/v1/status-cases/${id}/conditions`, body);
export const resolveStatusCaseCondition = (conditionId: string, body: { statusCode: 'met' | 'waived'; note?: string; evidenceRef?: string }) =>
  api.post(`/api/v1/status-case-conditions/${conditionId}/resolution`, body);
export const decideStatusCase = (id: string, body: { decisionCode: 'approved' | 'rejected'; reason: string; effectiveDate?: string; returnDate?: string }) =>
  api.post<StatusCase>(`/api/v1/status-cases/${id}/decision`, body);
export const withdrawStatusCase = (id: string) => api.post<StatusCase>(`/api/v1/status-cases/${id}/withdrawal`, {});
