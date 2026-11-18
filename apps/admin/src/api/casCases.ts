import { api } from './client.js';

/** One CAS record (BPR-D03; Phase 3 D-16). */
export interface CasCase {
  casCaseId: string;
  personId: string;
  applicationId: string | null;
  enrolmentId: string | null;
  casReference: string | null;
  statusCode: string; // opened | eligibility-checked | prepared | approved | requested | assigned | withdrawn
  preparedBy: string | null;
  preparedPayload: Record<string, unknown> | null;
  openedAt: string;
  subject: { studentName: string | null; programmeCode: string | null; programmeTitle: string | null };
  eligibilityChecks: Array<{ checkId: string; guidanceVersion: string; checkTypeCode: string; resultCode: string; checkedBy: string; checkedAt: string }>;
  assignmentVersions: Array<{ assignmentVersionId: string; versionNumber: number; assignedPayloadHash: string; casNumber: string | null; approvedBy: string; approvedAt: string; smsRequestSentAt: string | null; smsReceiptRef: string | null }>;
  /** Set when the applicant withdrew while the case was still in hand (Phase 5 D-39). */
  attentionReason?: 'application-withdrawn' | null;
}

/** A sponsor report made to UKVI about this CAS (Phase 5 D-43a). */
export interface SponsorReportVersion { reportId: string; reportPayloadRef: string; distributionItemId: string | null; generatedAt: string; generatedBy: string }
export const listSponsorReportVersions = (casCaseId: string) => api.get<SponsorReportVersion[]>(`/api/v1/regulatory/cas-cases/${casCaseId}/sponsor-report-versions`);
export const recordSponsorReportVersion = (casCaseId: string, body: { reportPayloadRef: string }) =>
  api.post<{ reportId: string }>(`/api/v1/regulatory/cas-cases/${casCaseId}/sponsor-report-versions`, body);

export interface CasSmsExport { contract: string; generatedAt: string; processedCount: number; casRequests: unknown[] }

const qs = (q: Record<string, string | boolean | undefined>) => {
  const p = Object.entries(q).filter(([, v]) => v !== undefined && v !== false).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return p.length ? `?${p.join('&')}` : '';
};

export const listCasCaseWorklist = (q: { open?: boolean; statusCode?: string; personId?: string; applicationId?: string } = {}) =>
  api.get<CasCase[]>(`/api/v1/regulatory/cas-cases${qs(q)}`);
export const listCasCases = (enrolmentId: string) => api.get<CasCase[]>(`/api/v1/enrolments/${enrolmentId}/regulatory/cas-cases`);
export const openCasCaseForApplication = (applicationId: string) => api.post<CasCase>(`/api/v1/applications/${applicationId}/cas-cases`, {});
export const openCasCase = (enrolmentId: string) => api.post<CasCase>(`/api/v1/enrolments/${enrolmentId}/regulatory/cas-cases`, {});
export const recordEligibilityCheck = (casCaseId: string, body: { guidanceVersion: string; checkTypeCode: string; resultCode: string; evidenceRef?: string }) =>
  api.post<{ checkId: string }>(`/api/v1/regulatory/cas-cases/${casCaseId}/eligibility-checks`, body);
export const prepareCas = (casCaseId: string) => api.post<CasCase>(`/api/v1/regulatory/cas-cases/${casCaseId}/preparation`);
export const approveCas = (casCaseId: string) => api.post<CasCase>(`/api/v1/regulatory/cas-cases/${casCaseId}/approval`);
export const recordCasNumber = (casCaseId: string, body: { casNumber: string; smsReceiptRef?: string }) =>
  api.post<CasCase>(`/api/v1/regulatory/cas-cases/${casCaseId}/cas-number`, body);
export const reopenCasForCorrection = (casCaseId: string) => api.post<CasCase>(`/api/v1/regulatory/cas-cases/${casCaseId}/correction`);
export const withdrawCas = (casCaseId: string) => api.post<CasCase>(`/api/v1/regulatory/cas-cases/${casCaseId}/withdrawal`);
export const exportCasForSms = () => api.post<CasSmsExport>('/api/v1/regulatory/cas-cases/sms-export');
