import { api } from './client.js';

/** Programme rule sets and diet groups (BP-03-002). */

export interface RuleSet { programmeRuleSetId: string; programmeId: string; programmeRouteId: string | null; entryAcademicYear: string | null; ruleSetCode: string; description: string | null }
export interface DietGroupMember { moduleGroupMemberId: string; moduleId: string; moduleCode: string; moduleTitle: string; isDefault: boolean; isNonCondonable: boolean }
export interface DietGroup {
  moduleGroupId: string; programmeRuleSetId: string; fheqLevel: number | null; groupCode: string; title: string;
  groupTypeCode: 'compulsory' | 'optional-pool' | 'elective-pool'; minModules: number | null; maxModules: number | null;
  minCredits: number | null; maxCredits: number | null; minFheqLevel: number | null; maxFheqLevel: number | null; members: DietGroupMember[];
}
export interface CurriculumBinding { enrolmentCurriculumBindingId: string; enrolmentId: string; programmeRouteId: string | null; programmeRuleSetId: string; decisionAuthorityCode: string; decisionReason: string | null }

export const listRuleSets = (programmeId: string) => api.get<RuleSet[]>(`/api/v1/programme-rule-sets?programmeId=${encodeURIComponent(programmeId)}`);
export const createRuleSet = (body: { programmeId: string; ruleSetCode: string; entryAcademicYear?: string; description?: string }) =>
  api.post<{ programmeRuleSetId: string }>('/api/v1/programme-rule-sets', body);
export const listDietGroups = (programmeRuleSetId: string) => api.get<DietGroup[]>(`/api/v1/module-groups?programmeRuleSetId=${encodeURIComponent(programmeRuleSetId)}`);
export const createDietGroup = (body: {
  programmeRuleSetId: string; groupCode: string; title: string; groupTypeCode: DietGroup['groupTypeCode']; fheqLevel?: number;
  minModules?: number; maxModules?: number; minCredits?: number; maxCredits?: number;
}) => api.post<{ moduleGroupId: string }>('/api/v1/module-groups', body);
export const addDietGroupMember = (moduleGroupId: string, body: { moduleId: string; isDefault?: boolean; isNonCondonable?: boolean }) =>
  api.post(`/api/v1/module-groups/${moduleGroupId}/members`, body);
export const getCurriculumBinding = (enrolmentId: string) => api.get<CurriculumBinding>(`/api/v1/enrolment-curriculum-bindings/${enrolmentId}`);

/** A change to one student's binding (D-11): applied at once, or proposed for a programme approver. */
export interface BindingChange {
  curriculumBindingChangeId: string; enrolmentId: string; programmeRouteId: string | null; programmeRuleSetId: string;
  changeReasonCode: string; reason: string; effectiveDate: string; statusCode: 'proposed' | 'approved' | 'rejected' | 'applied-directly';
  proposedBy: string; proposedAt: string; decidedBy: string | null; decidedAt: string | null; decisionReason: string | null;
  subject?: { personId: string; studentNumber: string; studentName: string; programmeCode: string | null; programmeTitle: string | null };
}
export const proposeBindingChange = (enrolmentId: string, body: { programmeRuleSetId: string; changeReasonCode: string; reason: string; effectiveDate: string }) =>
  api.post<{ applied: boolean; change: BindingChange }>(`/api/v1/enrolment-curriculum-bindings/${enrolmentId}`, body);
export const listPendingBindingChanges = () => api.get<BindingChange[]>('/api/v1/curriculum-binding-changes?pending=true');
export const listBindingChangesFor = (enrolmentId: string) => api.get<BindingChange[]>(`/api/v1/curriculum-binding-changes?enrolmentId=${encodeURIComponent(enrolmentId)}`);
export const decideBindingChange = (changeId: string, decisionCode: 'approved' | 'rejected', reason: string) =>
  api.post<BindingChange>(`/api/v1/curriculum-binding-changes/${changeId}/decision`, { decisionCode, reason });
