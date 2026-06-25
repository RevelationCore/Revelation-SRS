import { api } from './client.js';

export interface AcademicRule {
  academicRuleId:  string;
  programmeId:     string | null;
  ruleTypeCode:    string;
  ruleKey:         string;
  ruleValue:       Record<string, unknown>;
  description:     string | null;
  appliesToLevel:  number | null;
  validFrom:       string;
  validTo:         string | null;
  recordedAt:      string;
  recordedUntil:   string | null;
}

export function listAcademicRules(params?: {
  ruleTypeCode?: string;
}): Promise<AcademicRule[]> {
  const qs = new URLSearchParams();
  if (params?.ruleTypeCode) qs.set('ruleTypeCode', params.ruleTypeCode);
  const query = qs.toString();
  return api.get<AcademicRule[]>(`/api/v1/academic-rules${query ? `?${query}` : ''}`);
}

export function createAcademicRule(body: {
  ruleTypeCode:    string;
  ruleKey:         string;
  ruleValue:       Record<string, unknown>;
  description?:    string;
  programmeId?:    string;
  appliesToLevel?: number;
  validFrom?:      string;
}): Promise<{ academicRuleId: string }> {
  return api.post('/api/v1/academic-rules', body);
}

export function getAcademicRule(academicRuleId: string): Promise<AcademicRule> {
  return api.get<AcademicRule>(`/api/v1/academic-rules/${academicRuleId}`);
}

export function updateAcademicRule(
  academicRuleId: string,
  body: Partial<Pick<AcademicRule, 'ruleKey' | 'description' | 'ruleValue' | 'validTo' | 'appliesToLevel'>>,
): Promise<void> {
  return api.put(`/api/v1/academic-rules/${academicRuleId}`, body);
}

export function deleteAcademicRule(academicRuleId: string): Promise<void> {
  return api.delete(`/api/v1/academic-rules/${academicRuleId}`);
}

export function getAcademicRuleHistory(academicRuleId: string): Promise<AcademicRule[]> {
  return api.get<AcademicRule[]>(`/api/v1/academic-rules/${academicRuleId}/history`);
}
