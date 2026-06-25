import { api } from './client.js';

export interface CorrectionCase {
  caseId:       string;
  enrolmentId:  string;
  caseTypeCode: string;
  statusCode:   string;
  reference:    string;
  actorId:      string;
  validFrom:    string;
  validTo:      string | null;
  recordedAt:   string;
  recordedUntil: string | null;
}

export function listCorrectionCases(enrolmentId: string): Promise<CorrectionCase[]> {
  return api.get<CorrectionCase[]>(`/api/v1/enrolments/${enrolmentId}/correction-cases`);
}

export function createCorrectionCase(
  enrolmentId:  string,
  caseTypeCode: string,
  reference?:   string,
): Promise<{ caseId: string }> {
  const body: { caseTypeCode: string; reference?: string } = { caseTypeCode };
  if (reference) body.reference = reference;
  return api.post(`/api/v1/enrolments/${enrolmentId}/correction-cases`, body);
}

export function updateCaseStatus(
  caseId:     string,
  statusCode: string,
): Promise<void> {
  return api.patch(`/api/v1/correction-cases/${caseId}/status`, { statusCode });
}

export function addCaseAmendment(
  caseId: string,
  body: {
    entityType: 'mark' | 'module-registration' | 'enrolment';
    entityId:   string;
    afterValue: Record<string, unknown>;
    notes?:     string;
  },
): Promise<{ amendmentId: string }> {
  return api.post(`/api/v1/correction-cases/${caseId}/amendments`, body);
}
