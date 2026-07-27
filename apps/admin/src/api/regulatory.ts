import { api } from './client.js';

// ── HESA ──────────────────────────────────────────────────────────────────────

export interface HesaReturn {
  returnId:            string;
  academicYear:        string;
  statusCode:          string;
  submittedAt:         string | null;
  validatedAt:         string | null;
  submissionReference: string | null;
  amendmentOfId:       string | null;
  generatedBy:         string;
  generatedAt:         string;
  recordCount:         number;
  validationSummary:   Record<string, unknown> | null;
}

export interface HesaValidationResult {
  isValid:  boolean;
  errors:   Array<{ field: string; enrolmentId: string | null; message: string }>;
  warnings: Array<{ field: string; enrolmentId: string | null; message: string }>;
}

export function listHesaReturns(): Promise<HesaReturn[]> {
  return api.get<HesaReturn[]>('/api/v1/regulatory/hesa/returns');
}

export function createHesaReturn(academicYear: string): Promise<{ returnId: string }> {
  return api.post('/api/v1/regulatory/hesa/returns', { academicYear });
}

export function getHesaReturn(returnId: string): Promise<HesaReturn> {
  return api.get<HesaReturn>(`/api/v1/regulatory/hesa/returns/${returnId}`);
}

export function validateHesaReturn(returnId: string): Promise<HesaValidationResult> {
  return api.post(`/api/v1/regulatory/hesa/returns/${returnId}/validate`, {});
}

export function submitHesaReturn(returnId: string, submissionReference?: string): Promise<void> {
  return api.post(`/api/v1/regulatory/hesa/returns/${returnId}/submit`, { submissionReference });
}

export async function downloadHesaFile(returnId: string, token: string | null): Promise<void> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
  const res = await fetch(`${baseUrl}/api/v1/regulatory/hesa/returns/${returnId}/file`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `hesa-return-${returnId}.xml`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── UCAS ─────────────────────────────────────────────────────────────────────

export interface UcasApplication {
  applicationId:     string;
  ucasPersonalId:    string;
  cycle:             string;
  statusCode:        string;
  linkedEnrolmentId: string | null;
  receivedAt:        string;
  validFrom:         string;
  recordedAt:        string;
}

export function listUcasApplications(): Promise<UcasApplication[]> {
  return api.get<UcasApplication[]>('/api/v1/regulatory/ucas/applications');
}

export function generateUcasConfirmations(): Promise<void> {
  return api.post('/api/v1/regulatory/ucas/confirmations/generate', {});
}

// ── SLC ──────────────────────────────────────────────────────────────────────

export interface SlcConfirmationRecord {
  triggerId:        string;
  enrolmentId:      string;
  slcReference:     string;
  programmeId:      string | null;
  modeOfStudyCode:  string;
  confirmationType: 'enrolment' | 'withdrawal' | 'intermission';
  feeAmount:        string | null;
  startDate:        string;
  expectedEndDate:  string | null;
}

export function generateSlcConfirmations(opts: { dryRun?: boolean } = {}): Promise<{
  processedCount: number;
  dryRun: boolean;
  payload: { confirmations: SlcConfirmationRecord[] };
}> {
  const qs = opts.dryRun ? '?dryRun=true' : '';
  return api.post(`/api/v1/regulatory/slc/confirmations/generate${qs}`, {});
}

// ── UKVI ─────────────────────────────────────────────────────────────────────

export interface CasRequest {
  casRequestId: string;
  enrolmentId:  string;
  casReference: string | null;
  statusCode:   string;
  requestedAt:  string;
}

export interface ComplianceAlert {
  alertId:       string;
  enrolmentId:   string;
  casReference:  string | null;
  alertTypeCode: string;
  triggeredAt:   string;
  resolvedAt:    string | null;
  resolvedBy:    string | null;
}

export function listCasRequests(): Promise<CasRequest[]> {
  return api.get<CasRequest[]>('/api/v1/regulatory/ukvi/cas-requests');
}

export function generateCasRequests(): Promise<{
  processedCount: number;
  casRequests:    Array<{ casRequestId: string; enrolmentId: string }>;
}> {
  return api.post('/api/v1/regulatory/ukvi/cas-requests/generate', {});
}

export function listComplianceAlerts(): Promise<ComplianceAlert[]> {
  return api.get<ComplianceAlert[]>('/api/v1/regulatory/ukvi/compliance-alerts');
}

export function evaluateComplianceAlerts(): Promise<void> {
  return api.post('/api/v1/regulatory/ukvi/compliance-alerts/evaluate', {});
}

export function resolveComplianceAlert(alertId: string): Promise<void> {
  return api.post(`/api/v1/regulatory/ukvi/compliance-alerts/${alertId}/resolve`, {});
}

export interface SponsorDecision {
  decisionId:         string;
  enrolmentId:        string;
  evidenceSnapshotId: string;
  outcomeCode:        'report' | 'no-report' | 'further-review';
  rationaleCode:      string;
  guidanceVersion:    string;
  statusCode:         'pending-authorisation' | 'authorised';
  decidedAt:          string;
  decidedBy:          string;
  authorisedAt:       string | null;
  authorisedBy:       string | null;
  externalReportId:   string | null;
}

export interface UkviOperationalStatus {
  reconciliationRequired: number;
  pendingAuthorisation:   number;
  failedExchanges:        number;
}

export function listSponsorDecisions(): Promise<SponsorDecision[]> {
  return api.get<SponsorDecision[]>('/api/v1/regulatory/ukvi/sponsor-decisions');
}

export function authoriseSponsorDecision(decisionId: string): Promise<SponsorDecision> {
  return api.post(`/api/v1/regulatory/ukvi/sponsor-decisions/${decisionId}/authorise`, {});
}

export function getUkviOperationalStatus(): Promise<UkviOperationalStatus> {
  return api.get<UkviOperationalStatus>('/api/v1/regulatory/ukvi/operations/status');
}

// ── OfS ──────────────────────────────────────────────────────────────────────

export interface OfsB3Extract {
  extractId:       string;
  extractTypeCode: string;
  academicYear:    string;
  statusCode:      string;
  generatedAt:     string | null;
  generatedBy:     string | null;
  recordCount:     number;
  payload:         Record<string, unknown>;
}

export function generateOfsB3Extract(academicYear: string): Promise<{ extractId: string }> {
  return api.post('/api/v1/regulatory/ofs/b3-extracts', { academicYear });
}

export function getOfsB3Extract(extractId: string): Promise<OfsB3Extract> {
  return api.get<OfsB3Extract>(`/api/v1/regulatory/ofs/b3-extracts/${extractId}`);
}

export function generateOfsParticipationReport(academicYear: string): Promise<{ extractId: string; recordCount: number; payload: Record<string, unknown> }> {
  return api.post('/api/v1/regulatory/ofs/participation-reports', { academicYear });
}
