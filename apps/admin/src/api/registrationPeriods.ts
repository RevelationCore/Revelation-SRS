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
