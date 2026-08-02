import { api } from './client.js';

export interface CorrectionCase {
  caseId:       string;
  enrolmentId:  string;
  caseTypeCode: string;
  statusCode:   string;
  reference:    string;
  actorId:      string;
  errorCategoryCode: string | null;
  evidenceRef:       string | null;
  authorisedBy:      string | null;
  validFrom:    string;
  validTo:      string | null;
  recordedAt:   string;
  recordedUntil: string | null;
}

export function listCorrectionCases(enrolmentId: string): Promise<CorrectionCase[]> {
  return api.get<CorrectionCase[]>(`/api/v1/enrolments/${enrolmentId}/correction-cases`);
}

export interface CreateCorrectionCaseInput {
  errorCategoryCode?: string;
  evidenceRef?:       string;
  authorisedBy?:      string;
}

export function createCorrectionCase(
  enrolmentId:  string,
  caseTypeCode: string,
  reference?:   string,
  extra?:       CreateCorrectionCaseInput,
): Promise<{ caseId: string }> {
  const body: { caseTypeCode: string; reference?: string } & CreateCorrectionCaseInput = { caseTypeCode };
  if (reference) body.reference = reference;
  if (extra?.errorCategoryCode) body.errorCategoryCode = extra.errorCategoryCode;
  if (extra?.evidenceRef)       body.evidenceRef       = extra.evidenceRef;
  if (extra?.authorisedBy)      body.authorisedBy      = extra.authorisedBy;
  return api.post(`/api/v1/enrolments/${enrolmentId}/correction-cases`, body);
}

export function updateCaseStatus(
  caseId:     string,
  statusCode: string,
): Promise<void> {
  return api.patch(`/api/v1/correction-cases/${caseId}/status`, { statusCode });
}

export type AmendableEntityType = 'mark' | 'module_result' | 'progression_decision';

export function addCaseAmendment(
  caseId: string,
  body: {
    entityType: AmendableEntityType;
    entityId:   string;
    afterValue: Record<string, unknown>;
  },
): Promise<{ amendmentId: string }> {
  return api.post(`/api/v1/correction-cases/${caseId}/amendments`, body);
}

export function distributeAmendment(
  amendmentId:        string,
  targetSystemCodes:  string[],
): Promise<{ distributionItemIds: string[] }> {
  return api.post(`/api/v1/correction-cases/amendments/${amendmentId}/distribute`, { targetSystemCodes });
}
