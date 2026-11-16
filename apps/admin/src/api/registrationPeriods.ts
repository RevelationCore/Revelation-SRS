import { api } from './client.js';

/** Annual and initial registration (BP-02-010; D-8). */

export interface RegistrationPeriod {
  periodId: string; academicYear: string; programmeId: string | null; opensAt: string; closesAt: string; reminderAt: string | null;
  periodTypeCode: 'annual' | 'initial'; openedBy: string | null; closedAt: string | null; closedBy: string | null;
  counts: { pending: number; confirmed: number; lapsed: number };
  termsVersion: string | null;
}
export interface RegistrationConfirmation {
  confirmationId: string; enrolmentId: string; reenrolmentPeriodId: string; statusCode: 'pending' | 'confirmed' | 'lapsed';
  confirmedAt: string | null; confirmedBy: string | null; channelCode: 'portal' | 'assisted' | null; termsVersion: string | null; assistedReasonCode: string | null;
  subject: { personId: string; studentNumber: string; studentName: string; programmeCode: string | null; programmeTitle: string | null } | null;
}

export const listRegistrationPeriods = () => api.get<RegistrationPeriod[]>('/api/v1/registration-periods');
export const getRegistrationPeriod = (id: string) => api.get<RegistrationPeriod>(`/api/v1/registration-periods/${id}`);
export const openRegistrationPeriod = (body: { academicYear: string; programmeId?: string; opensAt: string; closesAt: string; periodTypeCode?: 'annual' | 'initial' }) =>
  api.post<RegistrationPeriod>('/api/v1/registration-periods', body);
export const refreshRegistrationPeriod = (id: string) => api.post<{ added: number }>(`/api/v1/registration-periods/${id}/refresh`, {});
export const closeRegistrationPeriod = (id: string) => api.post<RegistrationPeriod & { lapsedCount: number }>(`/api/v1/registration-periods/${id}/closure`, {});
export const listRegistrationConfirmations = (id: string, statusCode?: string) =>
  api.get<RegistrationConfirmation[]>(`/api/v1/registration-periods/${id}/confirmations${statusCode ? `?statusCode=${statusCode}` : ''}`);
export const confirmRegistrationAssisted = (confirmationId: string, acceptedTermsVersion: string, assistedReasonCode: string) =>
  api.post(`/api/v1/registration-confirmations/${confirmationId}/confirmation`, { acceptedTermsVersion, assistedReasonCode });

/** Failure to register (BP-02-011; D-9). */
export interface NonRegistrationCase {
  caseId: string; statusCode: 'open' | 'under-review' | 'decided' | 'closed'; enrolmentId: string; confirmationId: string;
  academicYear: string; periodClosesAt: string; openedAt: string;
  flags: Array<'results-pending' | 'open-status-request' | 'approved-interruption' | 'sponsored'>;
  contactAttempts: Array<{ evidenceId: string; channelCode: string; reference: string; contactedAt: string; contactedBy: string }>;
  writtenNonContinuation: { reference: string; receivedAt: string } | null;
  outcome: { outcomeCode: 'registered-late' | 'referred' | 'non-registration'; decidedBy: string; decidedAt: string; effectiveAt: string; reasonText: string | null; policyVersion: string | null; statusCaseId: string | null } | null;
  decisionAllowedFrom: string | null;
  ukviReportDueBy: string | null;
  subject: RegistrationConfirmation['subject'];
}

export const listNonRegistrationCases = (open = true) => api.get<NonRegistrationCase[]>(`/api/v1/non-registration-cases${open ? '?open=true' : ''}`);
export const recordNonRegistrationContact = (caseId: string, body: { channelCode: string; reference?: string }) =>
  api.post<NonRegistrationCase>(`/api/v1/non-registration-cases/${caseId}/contact-attempts`, body);
export const recordWrittenNonContinuation = (caseId: string, reference: string) =>
  api.post<NonRegistrationCase>(`/api/v1/non-registration-cases/${caseId}/written-statement`, { reference });
export const referNonRegistrationCase = (caseId: string, statusCaseId: string) =>
  api.post<NonRegistrationCase>(`/api/v1/non-registration-cases/${caseId}/referral`, { statusCaseId });
export const decideNonRegistration = (caseId: string, body: { reason: string; policyVersion: string; effectiveDate?: string; lastEngagementDate?: string }) =>
  api.post<NonRegistrationCase>(`/api/v1/non-registration-cases/${caseId}/decision`, body);
