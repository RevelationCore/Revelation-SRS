import { api } from './client.js';

// ── Environment runtime ───────────────────────────────────────────────────────

export interface WorkflowDefinitionStatus {
  definitionCode:       string;
  currentVersionNumber: number | null;
}

export interface FeatureFlagStatus {
  flagKey:           string;
  statusCode:        string;
  defaultVariantKey: string;
}

export interface DeploymentEnvironment {
  deploymentEnvironmentId: string;
  environmentCode:         string;
  displayName:             string;
  environmentTypeCode:     string;
  productionLike:          boolean;
  liveIntegrationsAllowed: boolean;
  active:                  boolean;
  createdAt:               string;
  updatedAt:               string;
}

export interface EnvironmentRuntime {
  environment:         DeploymentEnvironment;
  releaseVersion:      string;
  imageDigest:         string | null;
  migrationVersion:    string;
  workflowDefinitions: WorkflowDefinitionStatus[];
  featureFlags:        FeatureFlagStatus[];
}

export interface EnvironmentPromotion {
  promotionId:      string;
  sourceEnvId:      string;
  targetEnvId:      string;
  statusCode:       string;
  promotedBy:       string;
  promotedAt:       string;
  completedAt:      string | null;
  notes:            string | null;
}

export function getEnvironmentRuntime(): Promise<EnvironmentRuntime> {
  return api.get<EnvironmentRuntime>('/api/v1/environment-runtime');
}

export function listEnvironments(): Promise<DeploymentEnvironment[]> {
  return api.get<DeploymentEnvironment[]>('/api/v1/environments');
}

export function getEnvironment(deploymentEnvironmentId: string): Promise<DeploymentEnvironment> {
  return api.get<DeploymentEnvironment>(`/api/v1/environments/${deploymentEnvironmentId}`);
}

export function listEnvironmentPromotions(): Promise<EnvironmentPromotion[]> {
  return api.get<EnvironmentPromotion[]>('/api/v1/environment-promotions');
}

export function createEnvironmentPromotion(body: {
  sourceEnvId: string;
  targetEnvId: string;
  notes?:      string;
}): Promise<{ promotionId: string }> {
  return api.post('/api/v1/environment-promotions', body);
}
