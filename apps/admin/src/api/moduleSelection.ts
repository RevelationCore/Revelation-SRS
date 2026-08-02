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
