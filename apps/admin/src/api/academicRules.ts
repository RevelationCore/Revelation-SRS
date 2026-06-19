import { api } from './client.js';

export interface AcademicRule {
  academicRuleId:  string;
  ruleTypeCode:    string;
  name:            string;
  description:     string | null;
  definition:      Record<string, unknown>;
  effectiveFrom:   string;
  effectiveTo:     string | null;
  featureFlagId:   string | null;
  version:         number;
  createdAt:       string;
  updatedAt:       string;
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
  ruleTypeCode: string;
  name:         string;
  description?: string;
  definition:   Record<string, unknown>;
  effectiveFrom: string;
  effectiveTo?:  string;
  featureFlagId?: string;
}): Promise<{ academicRuleId: string }> {
  return api.post('/api/v1/academic-rules', body);
}

export function getAcademicRule(academicRuleId: string): Promise<AcademicRule> {
  return api.get<AcademicRule>(`/api/v1/academic-rules/${academicRuleId}`);
}

export function updateAcademicRule(
  academicRuleId: string,
  body: Partial<Pick<AcademicRule, 'name' | 'description' | 'definition' | 'effectiveTo' | 'featureFlagId'>>,
): Promise<void> {
  return api.put(`/api/v1/academic-rules/${academicRuleId}`, body);
}

export function deleteAcademicRule(academicRuleId: string): Promise<void> {
  return api.delete(`/api/v1/academic-rules/${academicRuleId}`);
}

export function getAcademicRuleHistory(academicRuleId: string): Promise<AcademicRule[]> {
  return api.get<AcademicRule[]>(`/api/v1/academic-rules/${academicRuleId}/history`);
}
