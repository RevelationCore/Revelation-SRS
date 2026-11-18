import { wellbeingApi } from './wellbeingModule.js';

// Disability support cases, mental-health cases and early-warning alerts,
// served by the wellbeing module (a separate service). Each detail response
// carries allowedNextStatuses: the module enforces every lifecycle, and the
// screens only offer the moves it allows.

// ── Disability support cases ────────────────────────────────────────────────

export interface DisabilityCase {
  id: string;
  wellbeingCaseId: string;
  caseRef: string;
  personId: string;
  supportTypeCode: string;
  statusCode: string;
  supportPlanStatusCode: string;
  dsaAwardRef: string | null;
  assignedAdvisorId: string | null;
  notes: string | null;
  validFrom: string;
  recordedAt: string;
  allowedNextStatuses: string[];
}

export interface DisabilityEvidence {
  id: string;
  evidenceTypeCode: string;
  edrmsDocumentRef: string | null;
  statusCode: string;
  receivedAt: string | null;
  uploadedBy: string;
  createdAt: string;
  allowedNextStatuses: string[];
}

export interface DsaEntitlement {
  id: string;
  entitlementTypeCode: string;
  providerRef: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  approvedBy: string;
}

export interface DisabilityCaseDetail extends DisabilityCase {
  evidence: DisabilityEvidence[];
  entitlements: DsaEntitlement[];
}

export interface CaseloadQuery {
  statusCode?: string;
  assignedTo?: 'me';
}

function qs(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
}

export function listDisabilityCaseload(query: CaseloadQuery = {}): Promise<{ items: DisabilityCase[]; total: number }> {
  return wellbeingApi.get(`/api/v1/disability-cases/caseload${qs({ ...query })}`);
}

export function listDisabilityCasesForPerson(personId: string): Promise<{ items: DisabilityCase[]; total: number }> {
  return wellbeingApi.get(`/api/v1/disability-cases?personId=${encodeURIComponent(personId)}`);
}

export function getDisabilityCase(caseId: string): Promise<DisabilityCaseDetail> {
  return wellbeingApi.get(`/api/v1/disability-cases/${caseId}`);
}

export function createDisabilityCase(input: {
  personId: string; supportTypeCode: string; dsaAwardRef?: string; notes?: string; assignedAdvisorId?: string;
}): Promise<{ id: string; wellbeingCaseId: string }> {
  return wellbeingApi.post('/api/v1/disability-cases', input);
}

export function changeDisabilityCaseStatus(caseId: string, statusCode: string): Promise<void> {
  return wellbeingApi.patch(`/api/v1/disability-cases/${caseId}/status`, { statusCode });
}

export function registerDisabilityEvidence(caseId: string, input: {
  evidenceTypeCode: string; filename: string; contentType: string;
}): Promise<{ evidenceId: string; documentRef: string; documentUrl: string }> {
  return wellbeingApi.post(`/api/v1/disability-cases/${caseId}/evidence`, input);
}

export function changeEvidenceStatus(evidenceId: string, statusCode: string): Promise<void> {
  return wellbeingApi.patch(`/api/v1/evidence/${evidenceId}/status`, { statusCode });
}

export function addDsaEntitlement(caseId: string, input: {
  entitlementTypeCode: string; providerRef?: string; effectiveFrom: string; effectiveTo?: string; approvedBy: string;
}): Promise<{ id: string }> {
  return wellbeingApi.post(`/api/v1/disability-cases/${caseId}/dsa-entitlements`, input);
}

// ── Mental-health cases ─────────────────────────────────────────────────────

export interface MentalHealthCase {
  id: string;
  wellbeingCaseId: string;
  personId: string;
  presentingConcernCode: string;
  statusCode: string;
  riskLevelCode: string;
  consentGiven: boolean;
  consentDate: string | null;
  validFrom: string;
  recordedAt: string;
  allowedNextStatuses: string[];
}

export interface InterventionPlan {
  id: string;
  planTypeCode: string;
  statusCode: string;
  practitionerId: string;
  sessionFrequencyCode: string | null;
  plannedSessionCount: string | null;
  goals: Array<{ goal: string; targetDate?: string }> | null;
  reviewDate: string | null;
  externalReferral: boolean;
  externalReferralDetails: string | null;
  validFrom: string;
  allowedNextStatuses: string[];
}

export interface MentalHealthCaseDetail extends MentalHealthCase {
  interventionPlans: InterventionPlan[];
}

export interface SessionNote {
  id: string;
  practitionerId: string;
  sessionDate: string;
  sessionTypeCode: string;
  content: string;
  createdAt: string;
}

export function listMentalHealthCaseload(query: CaseloadQuery & { riskLevelCode?: string } = {}): Promise<{ items: MentalHealthCase[]; total: number }> {
  return wellbeingApi.get(`/api/v1/mental-health-cases/caseload${qs({ ...query })}`);
}

export function listMentalHealthCasesForPerson(personId: string): Promise<{ items: MentalHealthCase[]; total: number }> {
  return wellbeingApi.get(`/api/v1/mental-health-cases?personId=${encodeURIComponent(personId)}`);
}

export function getMentalHealthCase(caseId: string): Promise<MentalHealthCaseDetail> {
  return wellbeingApi.get(`/api/v1/mental-health-cases/${caseId}`);
}

export function createMentalHealthCase(input: {
  personId: string; presentingConcernCode: string; riskLevelCode?: string; assignedAdvisorId?: string; notes?: string;
}): Promise<{ id: string; wellbeingCaseId: string }> {
  return wellbeingApi.post('/api/v1/mental-health-cases', input);
}

export function changeMentalHealthCaseStatus(caseId: string, statusCode: string): Promise<void> {
  return wellbeingApi.patch(`/api/v1/mental-health-cases/${caseId}/status`, { statusCode });
}

export function changeRiskLevel(caseId: string, riskLevelCode: string): Promise<void> {
  return wellbeingApi.patch(`/api/v1/mental-health-cases/${caseId}/risk`, { riskLevelCode });
}

export function recordConsent(caseId: string, consentDate: string): Promise<void> {
  return wellbeingApi.post(`/api/v1/mental-health-cases/${caseId}/consent`, { consentDate });
}

export function createInterventionPlan(caseId: string, input: {
  planTypeCode: string; practitionerId: string; sessionFrequencyCode?: string; plannedSessionCount?: string;
  goals?: Array<{ goal: string; targetDate?: string }>; reviewDate?: string; externalReferral?: boolean; externalReferralDetails?: string;
}): Promise<{ id: string }> {
  return wellbeingApi.post(`/api/v1/mental-health-cases/${caseId}/intervention-plans`, input);
}

export function changePlanStatus(caseId: string, planId: string, statusCode: string): Promise<void> {
  return wellbeingApi.patch(`/api/v1/mental-health-cases/${caseId}/intervention-plans/${planId}/status`, { statusCode });
}

/** Every read is audited by the module; only call it when the practitioner asks to see the notes. */
export function listSessionNotes(caseId: string): Promise<{ items: SessionNote[]; total: number }> {
  return wellbeingApi.get(`/api/v1/mental-health-cases/${caseId}/session-notes`);
}

export function addSessionNote(caseId: string, input: {
  practitionerId: string; sessionDate: string; sessionTypeCode: string; content: string;
}): Promise<{ id: string }> {
  return wellbeingApi.post(`/api/v1/mental-health-cases/${caseId}/session-notes`, input);
}

// ── Early-warning alerts ────────────────────────────────────────────────────

export interface EarlyWarningAlert {
  id: string;
  personId: string;
  alertTypeCode: string;
  alertSourceCode: string;
  triageStatusCode: string;
  assignedCaseId: string | null;
  alertPayload: Record<string, unknown>;
  receivedAt: string;
  triagedBy: string | null;
  triagedAt: string | null;
  allowedNextStatuses: string[];
}

export function listAlertQueue(triageStatus: 'pending' | 'open'): Promise<{ items: EarlyWarningAlert[]; total: number }> {
  return wellbeingApi.get(`/api/v1/early-warning-alerts?triageStatus=${triageStatus}`);
}

export function listAlertsForPerson(personId: string): Promise<{ items: EarlyWarningAlert[]; total: number }> {
  return wellbeingApi.get(`/api/v1/early-warning-alerts?personId=${encodeURIComponent(personId)}`);
}

export function raiseConcern(input: { personId: string; alertTypeCode: string; summary: string }): Promise<{ id: string }> {
  return wellbeingApi.post('/api/v1/early-warning-alerts', input);
}

export function triageAlert(alertId: string, triageStatusCode: string, assignedCaseId?: string): Promise<void> {
  return wellbeingApi.patch(`/api/v1/early-warning-alerts/${alertId}/triage`, {
    triageStatusCode, ...(assignedCaseId ? { assignedCaseId } : {}),
  });
}

export interface WellbeingSummary {
  openMentalHealthCases: number;
  activeInterventionPlans: number;
  pendingAlerts: number;
}

export function getWellbeingSummary(): Promise<WellbeingSummary> {
  return wellbeingApi.get('/api/v1/reports/wellbeing-summary');
}
