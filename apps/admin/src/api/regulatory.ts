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

export interface HesaSubmissionRequest {
  workflowInstanceId: string;
  workflowTaskId:      string;
  statusCode:          string;
  context:             Record<string, unknown>;
  startedAt:           string;
}

/** Requests approval to mark a validated, file-generated HESA return submitted. */
export function requestHesaReturnSubmission(
  returnId: string,
  submissionReference?: string,
  reason?: string,
): Promise<HesaSubmissionRequest> {
  return api.post(`/api/v1/regulatory/hesa/returns/${returnId}/submission-requests`, { submissionReference, reason });
}

export function listHesaSubmissionRequests(): Promise<HesaSubmissionRequest[]> {
  return api.get<HesaSubmissionRequest[]>('/api/v1/regulatory/hesa/returns/submission-requests');
}

export function decideHesaSubmissionRequest(
  workflowInstanceId: string,
  decisionCode: 'approved' | 'rejected',
  reason?: string,
): Promise<void> {
  return api.post(`/api/v1/regulatory/hesa/returns/submission-requests/${workflowInstanceId}/decision`, { decisionCode, reason });
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

export function generateUcasConfirmations(cycle: string): Promise<void> {
  return api.post('/api/v1/regulatory/ucas/confirmations/generate', { cycle });
}

export interface UcasSubmissionRequest {
  workflowInstanceId: string;
  workflowTaskId:      string;
  statusCode:          string;
  recordCount:         number;
  context:             Record<string, unknown> & { cycle: string };
  startedAt:           string;
}

/** Snapshots the current preview for a cycle and starts a regulatory-officer approval workflow for it. */
export function requestUcasSubmission(cycle: string, reason?: string): Promise<UcasSubmissionRequest> {
  return api.post('/api/v1/regulatory/ucas/confirmations/requests', { cycle, reason });
}

export function listUcasSubmissionRequests(): Promise<UcasSubmissionRequest[]> {
  return api.get<UcasSubmissionRequest[]>('/api/v1/regulatory/ucas/confirmations/requests');
}

export function decideUcasSubmissionRequest(
  workflowInstanceId: string,
  decisionCode: 'approved' | 'rejected',
  reason?: string,
): Promise<{ processedCount: number }> {
  return api.post(`/api/v1/regulatory/ucas/confirmations/requests/${workflowInstanceId}/decision`, { decisionCode, reason });
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

export interface SlcSubmissionRequest {
  workflowInstanceId: string;
  workflowTaskId:      string;
  statusCode:          string;
  recordCount:         number;
  context:             Record<string, unknown>;
  startedAt:           string;
}

/** Snapshots the current preview and starts a regulatory-officer approval workflow for it. */
export function requestSlcSubmission(reason?: string): Promise<SlcSubmissionRequest> {
  return api.post('/api/v1/regulatory/slc/confirmations/requests', { reason });
}

export function listSlcSubmissionRequests(): Promise<SlcSubmissionRequest[]> {
  return api.get<SlcSubmissionRequest[]>('/api/v1/regulatory/slc/confirmations/requests');
}

export function decideSlcSubmissionRequest(
  workflowInstanceId: string,
  decisionCode: 'approved' | 'rejected',
  reason?: string,
): Promise<{ processedCount: number }> {
  return api.post(`/api/v1/regulatory/slc/confirmations/requests/${workflowInstanceId}/decision`, { decisionCode, reason });
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

export interface UkviCasSubmissionRequest {
  workflowInstanceId: string;
  workflowTaskId:      string;
  statusCode:          string;
  recordCount:         number;
  context:             Record<string, unknown>;
  startedAt:           string;
}

/** Snapshots the current preview of pending CAS requests and starts a regulatory-officer approval workflow for it. */
export function requestUkviCasSubmission(reason?: string): Promise<UkviCasSubmissionRequest> {
  return api.post('/api/v1/regulatory/ukvi/cas-requests/submission-requests', { reason });
}

export function listUkviCasSubmissionRequests(): Promise<UkviCasSubmissionRequest[]> {
  return api.get<UkviCasSubmissionRequest[]>('/api/v1/regulatory/ukvi/cas-requests/submission-requests');
}

export function decideUkviCasSubmissionRequest(
  workflowInstanceId: string,
  decisionCode: 'approved' | 'rejected',
  reason?: string,
): Promise<{ processedCount: number }> {
  return api.post(`/api/v1/regulatory/ukvi/cas-requests/submission-requests/${workflowInstanceId}/decision`, { decisionCode, reason });
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

export type OfsExtractTypeCode = 'b3-student-outcomes' | 'access-participation-progress';

export interface OfsGenerationRequest {
  workflowInstanceId: string;
  workflowTaskId:      string;
  statusCode:          string;
  context:             Record<string, unknown> & { extractTypeCode: OfsExtractTypeCode; academicYear: string };
  startedAt:           string;
}

export function requestOfsExtractGeneration(
  extractTypeCode: OfsExtractTypeCode,
  academicYear: string,
  reason?: string,
): Promise<OfsGenerationRequest> {
  return api.post('/api/v1/regulatory/ofs/generation-requests', { extractTypeCode, academicYear, reason });
}

export function listOfsGenerationRequests(): Promise<OfsGenerationRequest[]> {
  return api.get<OfsGenerationRequest[]>('/api/v1/regulatory/ofs/generation-requests');
}

export function decideOfsGenerationRequest(
  workflowInstanceId: string,
  decisionCode: 'approved' | 'rejected',
  reason?: string,
): Promise<{ extractId: string | null }> {
  return api.post(`/api/v1/regulatory/ofs/generation-requests/${workflowInstanceId}/decision`, { decisionCode, reason });
}
