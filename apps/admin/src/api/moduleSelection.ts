import { api } from './client.js';

export interface ProposalValidationMessage {
  ruleTypeCode: string;
  message:      string;
  severity:     'error' | 'warning';
}

export interface ProposalItem {
  proposalItemId:      string;
  moduleId:            string;
  moduleCode:          string;
  moduleTitle:         string;
  creditValue:         number | null;
  fheqLevel:           number | null;
  moduleOfferingId:    string | null;
  preferenceRank:      number | null;
  sourceCode:          string;
  validationStateCode: string;
  validationMessages:  ProposalValidationMessage[];
}

export interface ModuleSelectionProposal {
  moduleSelectionProposalId: string;
  enrolmentId:               string;
  academicPeriodId:          string;
  programmeRuleSetId:        string;
  statusCode:                string;
  submittedAt:               string | null;
  decidedAt:                 string | null;
  decisionAuthorityCode:     string | null;
  decisionReason:            string | null;
  workflowInstanceId:        string | null;
  items:                     ProposalItem[];
}

export function listModuleSelectionProposals(params?: { statusCode?: string }): Promise<ModuleSelectionProposal[]> {
  const qs = params?.statusCode ? `?statusCode=${params.statusCode}` : '';
  return api.get(`/api/v1/module-selection-proposals${qs}`);
}

export function decideModuleSelectionProposal(
  proposalId:   string,
  decisionCode: 'approved' | 'rejected' | 'returned',
  reason:       string,
): Promise<ModuleSelectionProposal> {
  return api.post(`/api/v1/module-selection-proposals/${proposalId}/decision`, { decisionCode, reason });
}

// ── Selection windows (Phase 4 D-29) ────────────────────────────────────────

export type AllocationMode = 'first-come' | 'ranked';

export interface SelectionWindow {
  moduleSelectionWindowId: string;
  academicPeriodId:        string;
  academicYear:            string;
  periodCode:              string;
  programmeId:             string | null;
  fheqLevel:               number | null;
  opensAt:                 string;
  closesAt:                string;
  resubmissionClosesAt:    string | null;
  allocationModeCode:      AllocationMode;
  allocationSeeded:        boolean;
}

export function listSelectionWindows(): Promise<SelectionWindow[]> {
  return api.get('/api/v1/module-selection-windows');
}

export function createSelectionWindow(body: {
  academicPeriodId: string; programmeId?: string; fheqLevel?: number; opensAt: string; closesAt: string;
  resubmissionClosesAt?: string; allocationModeCode: AllocationMode;
}): Promise<{ moduleSelectionWindowId: string }> {
  return api.post('/api/v1/module-selection-windows', body);
}

export function updateSelectionWindow(
  moduleSelectionWindowId: string,
  body: { opensAt: string; closesAt: string; resubmissionClosesAt: string | null; allocationModeCode?: AllocationMode },
): Promise<void> {
  return api.patch(`/api/v1/module-selection-windows/${moduleSelectionWindowId}`, body);
}

// ── Ranked allocation (Phase 4 D-30) ────────────────────────────────────────

export interface AllocationResult {
  proposalId: string; enrolmentId: string; orderPosition: number; tier: number; choiceSlot: number | null;
  outcomeCode: 'allocated' | 'unallocated' | 'fixed'; allocatedItemId: string | null; moduleCode: string | null; reason: string | null;
}

export interface AllocationRun {
  allocationRunId: string; windowId: string; kindCode: 'main' | 'top-up'; statusCode: string; algorithmVersion: string;
  priorityOrder: string[]; inputsHash: string;
  summary: { proposals: number; fullyAllocated: number; partlyAllocated: number; compulsoryOverflow: Array<{ moduleCode: string; over: number }> };
  createdBy: string; createdAt: string; submittedBy: string | null; approvedBy: string | null; appliedAt: string | null;
  results?: AllocationResult[];
}

export const listAllocationRuns = (windowId: string) => api.get<AllocationRun[]>(`/api/v1/module-selection-windows/${windowId}/allocation-runs`);
export const getAllocationRun = (runId: string) => api.get<AllocationRun>(`/api/v1/allocation-runs/${runId}`);
export const previewAllocation = (windowId: string, kindCode: 'main' | 'top-up') =>
  api.post<AllocationRun>(`/api/v1/module-selection-windows/${windowId}/allocation-runs`, { kindCode });
export const submitAllocationRun = (runId: string) => api.post<AllocationRun>(`/api/v1/allocation-runs/${runId}/submission`, {});
export const decideAllocationRun = (runId: string, decisionCode: 'approved' | 'rejected') =>
  api.post<AllocationRun>(`/api/v1/allocation-runs/${runId}/decision`, { decisionCode });

// ── Module subject areas (D-27) ──────────────────────────────────────────────

export interface SubjectShare { subjectAreaCode: string; proportionPercent: number }
export const getModuleSubjects = (moduleId: string) => api.get<SubjectShare[]>(`/api/v1/modules/${moduleId}/subjects`);
export const putModuleSubjects = (moduleId: string, shares: SubjectShare[]) => api.put<SubjectShare[]>(`/api/v1/modules/${moduleId}/subjects`, shares);
