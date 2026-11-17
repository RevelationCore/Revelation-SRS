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
