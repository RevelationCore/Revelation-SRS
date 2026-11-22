import { api } from './client.js';

export interface IdentityResolutionCase {
  identityResolutionCaseId: string;
  subjectPersonId: string;
  statusCode:      string;
  ownerId:         string;
  createdAt:       string;
}

export interface DataCorrectionCase {
  dataCorrectionCaseId: string;
  personId:             string;
  correctedEntityType:  string;
  correctedFieldName:   string;
  statusCode:           string;
  ownerId:              string;
  createdAt:            string;
}

export function listCases(statusCode?: string): Promise<IdentityResolutionCase[]> {
  const qs = statusCode ? `?statusCode=${statusCode}` : '';
  return api.get(`/api/v1/identity-resolution/cases${qs}`);
}

export function listCorrectionCases(statusCode?: string): Promise<DataCorrectionCase[]> {
  const qs = statusCode ? `?statusCode=${statusCode}` : '';
  return api.get(`/api/v1/identity-resolution/correction-cases${qs}`);
}

export function openCase(body: { subjectPersonId: string; ownerId: string }): Promise<{ identityResolutionCaseId: string }> {
  return api.post('/api/v1/identity-resolution/cases', body);
}

export function addCandidate(
  caseId: string,
  body: { candidatePersonId: string; matchScore: number; matchReasonCode: string },
): Promise<{ candidateId: string }> {
  return api.post(`/api/v1/identity-resolution/cases/${caseId}/candidates`, body);
}

export type IdentityDecisionType = 'merge' | 'reject' | 'link';
export type FactChoice = 'survivor' | 'merged';

export interface MergeProposal {
  proposalId:            string;
  version:               number;
  survivorPersonId:      string;
  mergedPersonId:        string;
  factChoices:           Record<string, FactChoice>;
  identifierResolutions: Record<string, { keep: FactChoice; reason: string }>;
  twoAccountsConfirmed:  boolean;
  proposedBy:            string;
  proposedAt:            string;
  identifierConflicts:   Array<{ identifierClass: string; survivorValues: string[]; mergedValues: string[]; resolved: boolean }>;
}

/** ADR-031: a new version of the case's merge proposal. */
export function putProposal(caseId: string, body: {
  survivorPersonId: string;
  mergedPersonId: string;
  identifierResolutions?: Record<string, { keep: FactChoice; reason: string }>;
  twoAccountsConfirmed?: boolean;
}): Promise<MergeProposal> {
  return api.put(`/api/v1/identity-resolution/cases/${caseId}/proposal`, body);
}

export function getProposal(caseId: string): Promise<MergeProposal> {
  return api.get(`/api/v1/identity-resolution/cases/${caseId}/proposal`);
}

/** ADR-031: decided by someone who did not prepare the case, on the version they read. */
export function decide(
  caseId: string,
  body: { decisionTypeCode: IdentityDecisionType; proposalVersion?: number; reason: string },
): Promise<{ decisionId: string }> {
  return api.post(`/api/v1/identity-resolution/cases/${caseId}/decision`, body);
}

/** Related-record links only; a merge is made by a decision (ADR-031). */
export function linkPersons(body: {
  sourcePersonId: string;
  targetPersonId: string;
  linkTypeCode:   'related-record';
}): Promise<{ linkId: string }> {
  return api.post('/api/v1/identity-resolution/links', body);
}

export function openCorrectionCase(body: {
  personId:            string;
  correctedEntityType: string;
  correctedFieldName:  string;
  ownerId:             string;
}): Promise<{ dataCorrectionCaseId: string }> {
  return api.post('/api/v1/identity-resolution/correction-cases', body);
}
