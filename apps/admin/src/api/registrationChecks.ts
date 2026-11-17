import { api } from './client.js';

/** Right to study (D-17). */
export interface RightToStudyCheck {
  checkId: string; personId: string; enrolmentId: string | null; casCaseId: string | null;
  basisCode: string | null; methodCode: string | null; outcomeCode: 'pending' | 'eligible' | 'not-eligible' | 'referred' | 'recheck-required';
  checkedBy: string; checkedAt: string; permissionExpiresOn: string | null; ukEntryDate: string | null; restrictionCode: string | null;
  evidenceRef: string | null; recheckDueOn: string | null; shareCodeSubmitted: boolean; note: string | null;
}
export interface RightToStudyInput {
  basisCode: string; methodCode: string; outcomeCode: 'eligible' | 'not-eligible';
  permissionExpiresOn?: string; ukEntryDate?: string; restrictionCode?: string; evidenceRef?: string; note?: string;
}
export interface RightToStudyWorkItem { reason: 'share-code-submitted' | 'referred' | 'recheck-required' | 'expiring' | 'expired'; check: RightToStudyCheck }

export const listRightToStudy = (personId: string) => api.get<RightToStudyCheck[]>(`/api/v1/students/${personId}/right-to-study`);
export const recordRightToStudy = (personId: string, body: RightToStudyInput) => api.post<RightToStudyCheck>(`/api/v1/students/${personId}/right-to-study`, body);
export const decideRightToStudy = (checkId: string, body: { outcomeCode: 'eligible' | 'not-eligible'; note: string }) =>
  api.post<RightToStudyCheck>(`/api/v1/right-to-study/${checkId}/decision`, body);
export const rightToStudyWorklist = () => api.get<RightToStudyWorkItem[]>('/api/v1/right-to-study/worklist');

/** Financial registration (D-18). */
export interface FinancialRegistration {
  liabilityId: string; enrolmentId: string; personId: string; academicYear: string; feeBandCode: string | null; feeStatusCode: string | null;
  financialStatusCode: 'pending' | 'arranged' | 'hold' | 'not-required'; payerArrangementCode: string | null; financeReference: string | null;
  holdReasonCode: string | null; statusSourceCode: string | null; statusUpdatedBy: string | null; statusUpdatedAt: string | null;
  financiallyRegistered: boolean;
  subject: { personId: string; studentNumber: string; studentName: string; programmeCode: string | null } | null;
}
export interface FinancialStatusInput { financialStatusCode: FinancialRegistration['financialStatusCode']; payerArrangementCode?: string; financeReference?: string; holdReasonCode?: string }
export interface FeeStatusReassessment {
  caseId: string; enrolmentId: string; statusCode: string; proposedFeeStatusCode: string; currentFeeStatusCode: string | null;
  reason: string; proposedBy: string; proposedAt: string; decision: { outcome: string; decidedBy: string; decidedAt: string; note: string | null } | null;
  subject: FinancialRegistration['subject'];
}

export const listFinancialRegistration = (enrolmentId: string) => api.get<FinancialRegistration[]>(`/api/v1/enrolments/${enrolmentId}/financial-registration`);
export const financialRegistrationWorklist = (financialStatusCode?: string) =>
  api.get<FinancialRegistration[]>(`/api/v1/financial-registration${financialStatusCode ? `?financialStatusCode=${financialStatusCode}` : ''}`);
export const updateFinancialStatus = (liabilityId: string, body: FinancialStatusInput) =>
  api.post<FinancialRegistration>(`/api/v1/fee-liabilities/${liabilityId}/financial-status`, body);
export const listFeeStatusReassessments = (q: { enrolmentId?: string; open?: boolean } = {}) =>
  api.get<FeeStatusReassessment[]>(`/api/v1/fee-status-reassessments?${[q.enrolmentId ? `enrolmentId=${q.enrolmentId}` : '', q.open ? 'open=true' : ''].filter(Boolean).join('&')}`);
export const proposeFeeStatus = (enrolmentId: string, body: { feeStatusCode: string; reason: string }) =>
  api.post<FeeStatusReassessment>(`/api/v1/enrolments/${enrolmentId}/fee-status-reassessments`, body);
export const decideFeeStatus = (caseId: string, body: { outcome: 'approved' | 'rejected'; note?: string }) =>
  api.post<FeeStatusReassessment>(`/api/v1/fee-status-reassessments/${caseId}/decision`, body);
