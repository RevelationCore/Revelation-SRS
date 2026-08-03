import { api } from './client.js';

export interface SupportOutcome {
  supportOutcomeId:     string;
  enrolmentId:          string;
  sourceCaseId:         string | null;
  sourceDecisionId:     string | null;
  outcomeTypeCode:      string;
  minimumNecessaryText: string;
  visibilityScopeCode:  string;
  actorId:              string;
  validFrom:            string;
  validTo:              string | null;
  recordedAt:           string;
  recordedUntil:        string | null;
}

export function listSupportOutcomes(enrolmentId: string): Promise<SupportOutcome[]> {
  return api.get<SupportOutcome[]>(`/api/v1/enrolments/${enrolmentId}/support-outcomes`);
}

export function recordSupportOutcome(
  enrolmentId: string,
  body: {
    outcomeTypeCode:      string;
    minimumNecessaryText: string;
    visibilityScopeCode:  string;
    sourceCaseId?:        string;
    sourceDecisionId?:    string;
  },
): Promise<{ supportOutcomeId: string }> {
  return api.post(`/api/v1/enrolments/${enrolmentId}/support-outcomes`, body);
}

export function distributeSupportOutcome(
  supportOutcomeId: string,
  targetSystemCodes: string[],
): Promise<{ distributionItemIds: string[] }> {
  return api.post(`/api/v1/support-outcomes/${supportOutcomeId}/distribute`, { targetSystemCodes });
}
