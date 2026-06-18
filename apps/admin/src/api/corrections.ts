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

export const CASE_TYPE_CODES = ['appeal', 'administrative-correction', 'misconduct'] as const;
export type CaseTypeCode = typeof CASE_TYPE_CODES[number];

export const CASE_STATUS_CODES = ['open', 'under-review', 'upheld', 'not-upheld', 'withdrawn'] as const;
export type CaseStatusCode = typeof CASE_STATUS_CODES[number];

export function listCorrectionCases(enrolmentId: string): Promise<CorrectionCase[]> {
  return api.get<CorrectionCase[]>(`/api/v1/enrolments/${enrolmentId}/correction-cases`);
}

export function createCorrectionCase(
  enrolmentId:  string,
  caseTypeCode: CaseTypeCode,
): Promise<{ caseId: string }> {
  return api.post(`/api/v1/enrolments/${enrolmentId}/correction-cases`, { caseTypeCode });
}

export function updateCaseStatus(
  caseId:     string,
  statusCode: CaseStatusCode,
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
