import { api } from './client.js';

/** Academic misconduct outcomes and their effects, never allegations or evidence (BP-05-006; D-5; ADR-017). */

export interface MisconductOutcome {
  misconductCaseId: string;
  misconductOutcomeId: string;
  enrolmentId: string;
  caseReference: string;
  caseStatusCode: string;
  penaltyCode: string;
  effectiveDate: string;
  actorId: string;
  recordedAt: string;
  penaltyEffects: Array<{ targetEntityType: string; targetEntityId: string; penaltyDetail: string | null }>;
}

export const listMisconductOutcomes = (personId: string) => api.get<MisconductOutcome[]>(`/api/v1/students/${personId}/misconduct-outcomes`);
export const recordMisconductOutcome = (personId: string, body: {
  enrolmentId: string; caseReference: string; caseStatusCode?: string; penaltyCode: string; effectiveDate: string;
  penaltyEffects?: Array<{ targetEntityType: 'mark' | 'module_registration'; targetEntityId: string; penaltyDetail?: string }>;
}) => api.post<{ misconductOutcomeId: string }>(`/api/v1/students/${personId}/misconduct-outcomes`, body);
