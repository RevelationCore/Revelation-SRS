import { api } from './client.js';

export interface FeatureFlagVariant {
  featureFlagVariantId: string;
  variantKey:           string;
  displayName:          string;
  value:                unknown;
  sortOrder:            number;
}

export interface FeatureFlag {
  featureFlagId:       string;
  flagKey:             string;
  displayName:         string;
  description:         string | null;
  ownerModuleCode:     string;
  statusCode:          string;
  valueTypeCode:       string;
  defaultVariantKey:   string;
  createdBy:           string;
  createdAt:           string;
  updatedAt:           string;
  variants:            FeatureFlagVariant[];
  flagClassCode:       string;
  riskClassCode:       string;
  ownerContact:        string | null;
  reviewDate:          string | null;
  retirementCondition: string | null;
  allowedScopeCodes:   string[];
  nonBypassable:       boolean;
}

export interface FeatureFlagAssignment {
  featureFlagAssignmentId:     string;
  featureFlagId:               string;
  tenantId:                    string | null;
  environmentId:               string | null;
  variantId:                   string | null;
  roleCode:                    string | null;
  cohortCode:                  string | null;
  programmeId:                 string | null;
  academicYear:                string | null;
  sourceSystemCode:            string | null;
  priority:                    number;
  statusCode:                  string;
  ruleExpression:              string | null;
  configuration:               Record<string, unknown>;
  activeFrom:                  string;
  activeTo:                    string | null;
  createdBy:                   string;
  createdAt:                   string;
  updatedAt:                   string;
}

export interface FeatureFlagImpact {
  activeAssignmentCount:      number;
  activeTenantsCount:         number;
  activeTenantIds:            string[];
  referencingTriggerRuleKeys: string[];
  currentDefaultVariantKey:   string;
  currentDefaultValue:        unknown;
}

export function listFeatureFlags(): Promise<FeatureFlag[]> {
  return api.get<FeatureFlag[]>('/api/v1/feature-flags');
}

export function createFeatureFlag(body: {
  flagKey:          string;
  displayName:      string;
  ownerModuleCode:  string;
  description?:     string;
  defaultVariantKey?: string;
}): Promise<{ featureFlagId: string }> {
  return api.post('/api/v1/feature-flags', body);
}

export function getFeatureFlag(featureFlagId: string): Promise<FeatureFlag> {
  return api.get<FeatureFlag>(`/api/v1/feature-flags/${featureFlagId}`);
}

export function updateFeatureFlag(
  featureFlagId: string,
  body: { displayName?: string; description?: string; ownerModuleCode?: string; statusCode?: string; defaultVariantKey?: string },
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
    variantKey?:  string;
    roleCode?:    string;
    cohortCode?:  string;
    programmeId?: string;
    priority?:    number;
    activeFrom?:  string;
    activeTo?:    string;
  },
): Promise<{ featureFlagAssignmentId: string }> {
  return api.post(`/api/v1/feature-flags/${featureFlagId}/assignments`, body);
}

export function getFeatureFlagImpact(featureFlagId: string): Promise<FeatureFlagImpact> {
  return api.get<FeatureFlagImpact>(`/api/v1/feature-flags/${featureFlagId}/impact`);
}
