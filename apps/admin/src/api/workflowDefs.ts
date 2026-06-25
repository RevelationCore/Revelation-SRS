import { api } from './client.js';

export interface WorkflowStep {
  stepKey:       string;
  stepTypeCode:  string;
  displayName:   string;
  ownerRoleCode: string | null;
  sortOrder:     number;
}

export interface WorkflowDefinition {
  workflowDefinitionId:   string;
  tenantId:               string | null;
  definitionCode:         string;
  displayName:            string;
  description:            string | null;
  statusCode:             string;
  currentVersionNumber:   number | null;
  ownerModuleCode:        string;
  createdBy:              string;
  createdAt:              string;
  updatedAt:              string;
}

export interface WorkflowDefinitionVersion {
  workflowDefinitionVersionId: string;
  workflowDefinitionId:        string;
  versionNumber:               number;
  statusCode:                  string;
  definitionJson:              Record<string, unknown>;
  bpmnSourceId:                string | null;
  effectiveFrom:               string | null;
  effectiveTo:                 string | null;
  createdBy:                   string;
  createdAt:                   string;
  steps:                       WorkflowStep[];
}

export interface WorkflowAssignmentRule {
  workflowAssignmentRuleId:    string;
  tenantId:                    string | null;
  definitionCode:              string;
  workflowDefinitionVersionId: string;
  stepKey:                     string;
  ruleKey:                     string;
  priority:                    number;
  roleCode:                    string | null;
  assigneeRoleCode:            string | null;
  assigneeExpression:          string | null;
  configuration:               Record<string, unknown>;
  active:                      boolean;
  createdAt:                   string;
}

export function listWorkflowDefinitions(): Promise<WorkflowDefinition[]> {
  return api.get<WorkflowDefinition[]>('/api/v1/workflow-definitions');
}

export function createWorkflowDefinition(body: {
  definitionCode: string;
  displayName:    string;
  description?:   string;
}): Promise<{ workflowDefinitionId: string }> {
  return api.post('/api/v1/workflow-definitions', body);
}

export function getWorkflowDefinition(workflowDefinitionId: string): Promise<WorkflowDefinition> {
  return api.get<WorkflowDefinition>(`/api/v1/workflow-definitions/${workflowDefinitionId}`);
}

export function updateWorkflowDefinition(
  workflowDefinitionId: string,
  body: { statusCode?: string; displayName?: string; description?: string },
): Promise<void> {
  return api.patch(`/api/v1/workflow-definitions/${workflowDefinitionId}`, body);
}

export function listWorkflowDefinitionVersions(workflowDefinitionId: string): Promise<WorkflowDefinitionVersion[]> {
  return api.get<WorkflowDefinitionVersion[]>(`/api/v1/workflow-definitions/${workflowDefinitionId}/versions`);
}

export function getWorkflowDefinitionVersion(versionId: string): Promise<WorkflowDefinitionVersion> {
  return api.get<WorkflowDefinitionVersion>(`/api/v1/workflow-definition-versions/${versionId}`);
}

export function listWorkflowAssignmentRules(): Promise<WorkflowAssignmentRule[]> {
  return api.get<WorkflowAssignmentRule[]>('/api/v1/workflow-assignment-rules');
}

export function createWorkflowAssignmentRule(body: {
  workflowDefinitionVersionId: string;
  stepKey:                     string;
  ruleKey:                     string;
  assigneeRoleCode?:           string;
  priority?:                   number;
}): Promise<{ workflowAssignmentRuleId: string }> {
  return api.post('/api/v1/workflow-assignment-rules', body);
}
