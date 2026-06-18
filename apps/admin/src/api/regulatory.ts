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

export function generateSlcConfirmations(): Promise<void> {
  return api.post('/api/v1/regulatory/slc/confirmations/generate', {});
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

// ── OfS ──────────────────────────────────────────────────────────────────────

export interface OfsB3Extract {
  extractId:   string;
  statusCode:  string;
  generatedAt: string | null;
  generatedBy: string | null;
}

export function generateOfsB3Extract(): Promise<{ extractId: string }> {
  return api.post('/api/v1/regulatory/ofs/b3-extracts', {});
}

export function getOfsB3Extract(extractId: string): Promise<OfsB3Extract> {
  return api.get<OfsB3Extract>(`/api/v1/regulatory/ofs/b3-extracts/${extractId}`);
}

export function generateOfsParticipationReport(): Promise<void> {
  return api.post('/api/v1/regulatory/ofs/participation-reports', {});
}
