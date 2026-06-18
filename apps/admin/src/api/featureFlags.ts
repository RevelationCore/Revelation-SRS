import { api } from './client.js';

export interface FeatureFlag {
  featureFlagId:   string;
  flagKey:         string;
  description:     string | null;
  defaultValue:    boolean;
  statusCode:      string;
  governanceOwner: string | null;
  retiredAt:       string | null;
  createdAt:       string;
  updatedAt:       string;
}

export interface FeatureFlagAssignment {
  assignmentId:  string;
  featureFlagId: string;
  scopeTypeCode: string;
  scopeId:       string | null;
  value:         boolean;
  expiresAt:     string | null;
  createdAt:     string;
}

export interface FeatureFlagGovernance {
  featureFlagId:    string;
  approvedBy:       string | null;
  approvedAt:       string | null;
  rationale:        string | null;
  reviewCycle:      string | null;
  nextReviewAt:     string | null;
}

export interface FeatureFlagImpact {
  featureFlagId:    string;
  affectedRuleIds:  string[];
  affectedWorkflows: string[];
  estimatedScope:   string | null;
}

export function listFeatureFlags(): Promise<FeatureFlag[]> {
  return api.get<FeatureFlag[]>('/api/v1/feature-flags');
}

export function createFeatureFlag(body: {
  flagKey:         string;
  description?:    string;
  defaultValue:    boolean;
  governanceOwner?: string;
}): Promise<{ featureFlagId: string }> {
  return api.post('/api/v1/feature-flags', body);
}

export function getFeatureFlag(featureFlagId: string): Promise<FeatureFlag> {
  return api.get<FeatureFlag>(`/api/v1/feature-flags/${featureFlagId}`);
}

export function updateFeatureFlag(
  featureFlagId: string,
  body: Partial<Pick<FeatureFlag, 'description' | 'defaultValue' | 'governanceOwner'>>,
): Promise<void> {
  return api.patch(`/api/v1/feature-flags/${featureFlagId}`, body);
}

export function retireFeatureFlag(featureFlagId: string): Promise<void> {
  return api.post(`/api/v1/feature-flags/${featureFlagId}/retirement`, {});
}

export function listFeatureFlagAssignments(featureFlagId: string): Promise<FeatureFlagAssignment[]> {
  return api.get<FeatureFlagAssignment[]>(`/api/v1/feature-flags/${featureFlagId}/assignments`);
}

export function createFeatureFlagAssignment(
  featureFlagId: string,
  body: {
    scopeTypeCode: string;
    scopeId?:      string;
    value:         boolean;
    expiresAt?:    string;
  },
): Promise<{ assignmentId: string }> {
  return api.post(`/api/v1/feature-flags/${featureFlagId}/assignments`, body);
}

export function getFeatureFlagGovernance(featureFlagId: string): Promise<FeatureFlagGovernance> {
  return api.get<FeatureFlagGovernance>(`/api/v1/feature-flags/${featureFlagId}/governance`);
}

export function getFeatureFlagImpact(featureFlagId: string): Promise<FeatureFlagImpact> {
  return api.get<FeatureFlagImpact>(`/api/v1/feature-flags/${featureFlagId}/impact`);
}

export function evaluateFeatureFlagPreview(
  featureFlagId: string,
  body: { context: Record<string, unknown> },
): Promise<{ result: boolean; reason: string }> {
  return api.post(`/api/v1/feature-flags/${featureFlagId}/evaluation-preview`, body);
}
