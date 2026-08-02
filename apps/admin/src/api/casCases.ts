import { api } from './client.js';

export interface CasCase {
  casCaseId:     string;
  enrolmentId:   string;
  casReference:  string | null;
  statusCode:    string;
  actorId:       string;
  validFrom:     string;
  validTo:       string | null;
  recordedAt:    string;
  recordedUntil: string | null;
}

export function listCasCases(enrolmentId: string): Promise<CasCase[]> {
  return api.get<CasCase[]>(`/api/v1/enrolments/${enrolmentId}/regulatory/cas-cases`);
}

export function openCasCase(
  enrolmentId:  string,
  casReference?: string,
): Promise<{ casCaseId: string }> {
  const body: { casReference?: string } = {};
  if (casReference) body.casReference = casReference;
  return api.post(`/api/v1/enrolments/${enrolmentId}/regulatory/cas-cases`, body);
}

export function recordEligibilityCheck(
  casCaseId: string,
  body: {
    guidanceVersion: string;
    checkTypeCode:   string;
    resultCode:      string;
    evidenceRef?:    string;
  },
): Promise<{ checkId: string }> {
  return api.post(`/api/v1/regulatory/cas-cases/${casCaseId}/eligibility-checks`, body);
}

export function recordAssignmentVersion(
  casCaseId: string,
  body: {
    assignedPayloadHash: string;
    casNumber?:          string;
    smsRequestSentAt?:   string;
    smsReceiptRef?:      string;
  },
): Promise<{ assignmentId: string }> {
  return api.post(`/api/v1/regulatory/cas-cases/${casCaseId}/assignment-versions`, body);
}

export function recordSponsorReportVersion(
  casCaseId: string,
  body: {
    reportPayloadRef:   string;
    distributionItemId?: string;
  },
): Promise<{ reportId: string }> {
  return api.post(`/api/v1/regulatory/cas-cases/${casCaseId}/sponsor-report-versions`, body);
}
