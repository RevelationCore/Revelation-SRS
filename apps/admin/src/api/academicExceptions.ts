import { api } from './client.js';

/** Recognised credit and rule exceptions per enrolment (BPR-D05). */

export type ExceptionDecision = 'proposed' | 'approved' | 'rejected' | 'revoked';

export interface RecognisedCredit {
  recognisedCreditId: string;
  enrolmentId: string;
  recognitionTypeCode: string;
  sourceDescription: string;
  creditValue: number;
  fheqLevel: number | null;
  moduleId: string | null;
  statusCaseId: string | null;
  evidenceRef: string | null;
  academicYear: string | null;
  statusCode: ExceptionDecision;
  createdBy: string;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
}

export interface RuleException {
  ruleExceptionId: string;
  enrolmentId: string;
  programmeRuleSetId: string | null;
  ruleCode: string;
  exceptionTypeCode: string;
  description: string;
  validFrom: string;
  validTo: string | null;
  authorityRef: string | null;
  variationValue: Record<string, number | null> | null;
  statusCode: ExceptionDecision;
  createdBy: string;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
}

/**
 * The rules a student's exception can waive or vary, with the values a
 * variation replaces. Mirrors ENROLMENT_RULE_FIELDS in the API's rules
 * engine, which refuses any other rule code.
 */
export const ENROLMENT_RULES: Array<{ code: string; label: string; fields: Array<{ name: string; label: string }> }> = [
  { code: 'max-credits-per-period', label: 'Maximum credits per period', fields: [{ name: 'maxCredits', label: 'Maximum credits' }] },
  { code: 'credit-load-requirement', label: 'Credit load', fields: [{ name: 'minCredits', label: 'Minimum credits' }, { name: 'maxCredits', label: 'Maximum credits' }] },
  { code: 'level-credit-requirement', label: 'Credits at the study level', fields: [{ name: 'minCreditsAtLevel', label: 'Minimum credits at level' }] },
  { code: 'adjacent-level-credit-limit', label: 'Credits at an adjacent level', fields: [{ name: 'maxCredits', label: 'Maximum credits' }] },
  { code: 'progression-credit-requirement', label: 'Credits needed to progress', fields: [{ name: 'requiredCredits', label: 'Required credits' }] },
  { code: 'compensation-credit-limit', label: 'Compensation credit limit', fields: [{ name: 'maxCredits', label: 'Maximum credits' }] },
];

export const listRecognisedCredits = (enrolmentId: string) =>
  api.get<{ credits: RecognisedCredit[]; approvedCreditTotal: number }>(`/api/v1/enrolments/${enrolmentId}/recognised-credits`);
export const proposeRecognisedCredit = (enrolmentId: string, body: {
  recognitionTypeCode: string; sourceDescription: string; creditValue: number; fheqLevel?: number;
  moduleId?: string; evidenceRef?: string; academicYear?: string;
}) => api.post<RecognisedCredit>(`/api/v1/enrolments/${enrolmentId}/recognised-credits`, body);
export const decideRecognisedCredit = (id: string, decisionCode: 'approved' | 'rejected', reason: string) =>
  api.post<RecognisedCredit>(`/api/v1/recognised-credits/${id}/decision`, { decisionCode, reason });

export const listRuleExceptions = (enrolmentId: string) => api.get<RuleException[]>(`/api/v1/enrolments/${enrolmentId}/rule-exceptions`);
export const proposeRuleException = (enrolmentId: string, body: {
  ruleCode: string; exceptionTypeCode: string; description: string; validFrom: string; validTo?: string;
  authorityRef?: string; variationValue?: Record<string, number | null>;
}) => api.post<RuleException>(`/api/v1/enrolments/${enrolmentId}/rule-exceptions`, body);
export const decideRuleException = (id: string, decisionCode: 'approved' | 'rejected', reason: string) =>
  api.post<RuleException>(`/api/v1/rule-exceptions/${id}/decision`, { decisionCode, reason });
export const revokeRuleException = (id: string, reason: string) =>
  api.post<RuleException>(`/api/v1/rule-exceptions/${id}/revocation`, { reason });

export interface ModuleSummary { moduleId: string; code: string; title: string; creditValue: number | null }
export const listModules = () => api.get<ModuleSummary[]>('/api/v1/modules');
