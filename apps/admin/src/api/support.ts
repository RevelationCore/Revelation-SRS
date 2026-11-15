import { api } from './client.js';

export interface SupportInstalment {
  instalmentId: string; awardId: string; paymentTypeCode: string; currencyCode: string; amountMinorUnits: number;
  periodStart: string; periodEnd: string; dueDate: string; statusCode: string;
  approvedBy: string | null; approvedAt: string | null; paymentReference: string | null;
  paidOn: string | null; paidAmountMinorUnits: number | null; rejectionReason: string | null; createdBy: string;
}

export interface SupportAward {
  awardId: string; personId: string; enrolmentId: string; awardTypeCode: string; awardReference: string;
  funder: string; startDate: string; endDate: string | null; statusCode: string; createdBy: string;
  approvedBy: string | null; approvedAt: string | null; instalments: SupportInstalment[];
}

export interface EmploymentLink {
  linkId: string; personId: string; hrEmploymentReference: string; roleTypeCode: string;
  startDate: string; endDate: string | null; weeklyHours: number; moduleOfferingIds: string[];
  supervisorAgreedAt: string | null; sourceCode: string;
}

export interface WorkLimitWarning { ruleCode: string; message: string }
export interface WorkLimit { ruleCode: string; maxWeeklyHours: number; description: string; isDefault: boolean }

export const listSupportAwards = (personId: string) => api.get<SupportAward[]>(`/api/v1/students/${personId}/support-awards`);
export const createSupportAward = (personId: string, body: { enrolmentId: string; awardTypeCode: string; awardReference: string; funder: string; startDate: string; endDate?: string }) =>
  api.post<SupportAward>(`/api/v1/students/${personId}/support-awards`, body);
export const approveSupportAward = (awardId: string) => api.post<SupportAward>(`/api/v1/support-awards/${awardId}/approve`, {});
export const addSupportInstalment = (awardId: string, body: { paymentTypeCode: string; amountMinorUnits: number; periodStart: string; periodEnd: string; dueDate: string }) =>
  api.post<SupportInstalment>(`/api/v1/support-awards/${awardId}/instalments`, body);
export const approveSupportInstalment = (instalmentId: string) => api.post<SupportInstalment>(`/api/v1/support-instalments/${instalmentId}/approve`, {});
export const cancelSupportInstalment = (instalmentId: string) => api.post<SupportInstalment>(`/api/v1/support-instalments/${instalmentId}/cancel`, {});

export const listEmploymentLinks = (personId: string) =>
  api.get<{ links: EmploymentLink[]; warnings: WorkLimitWarning[] }>(`/api/v1/students/${personId}/employment-links`);
export const saveEmploymentLink = (personId: string, hrRef: string, body: { roleTypeCode: string; startDate: string; endDate?: string | null; weeklyHours: number; supervisorAgreedAt?: string | null }) =>
  api.put<{ link: EmploymentLink; warnings: WorkLimitWarning[] }>(`/api/v1/students/${personId}/employment-links/${encodeURIComponent(hrRef)}`, body);
export const listWorkLimits = () => api.get<WorkLimit[]>('/api/v1/work-limits');
export const setWorkLimit = (ruleCode: string, maxWeeklyHours: number) => api.put<WorkLimit>(`/api/v1/work-limits/${ruleCode}`, { maxWeeklyHours });
