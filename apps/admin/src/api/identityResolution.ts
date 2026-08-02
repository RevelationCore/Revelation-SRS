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

export function decide(
  caseId: string,
  body: { decisionTypeCode: IdentityDecisionType; survivorPersonId?: string },
): Promise<{ decisionId: string }> {
  return api.post(`/api/v1/identity-resolution/cases/${caseId}/decision`, body);
}

export function linkPersons(body: {
  sourcePersonId: string;
  targetPersonId: string;
  linkTypeCode:   string;
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
