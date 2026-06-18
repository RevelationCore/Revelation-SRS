import { api } from './client.js';

export interface WorkflowDefinition {
  workflowDefinitionId: string;
  workflowTypeCode:     string;
  name:                 string;
  description:          string | null;
  isEnabled:            boolean;
  currentVersionId:     string | null;
  createdAt:            string;
  updatedAt:            string;
}

export interface WorkflowDefinitionVersion {
  workflowDefinitionVersionId: string;
  workflowDefinitionId:         string;
  versionNumber:                number;
  definition:                   Record<string, unknown>;
  isCurrent:                    boolean;
  publishedAt:                  string | null;
  publishedBy:                  string | null;
  createdAt:                    string;
}

export interface WorkflowAssignmentRule {
  assignmentRuleId:  string;
  workflowTypeCode:  string;
  stepKey:           string;
  assigneeRoleCode:  string;
  priority:          number;
  conditions:        Record<string, unknown> | null;
  isEnabled:         boolean;
  createdAt:         string;
}

export function listWorkflowDefinitions(): Promise<WorkflowDefinition[]> {
  return api.get<WorkflowDefinition[]>('/api/v1/workflow-definitions');
}

export function createWorkflowDefinition(body: {
  workflowTypeCode: string;
  name:             string;
  description?:     string;
}): Promise<{ workflowDefinitionId: string }> {
  return api.post('/api/v1/workflow-definitions', body);
}

export function getWorkflowDefinition(workflowDefinitionId: string): Promise<WorkflowDefinition> {
  return api.get<WorkflowDefinition>(`/api/v1/workflow-definitions/${workflowDefinitionId}`);
}

export function updateWorkflowDefinition(
  workflowDefinitionId: string,
  body: Partial<Pick<WorkflowDefinition, 'name' | 'description' | 'isEnabled'>>,
): Promise<void> {
  return api.patch(`/api/v1/workflow-definitions/${workflowDefinitionId}`, body);
}

export function listWorkflowDefinitionVersions(workflowDefinitionId: string): Promise<WorkflowDefinitionVersion[]> {
  return api.get<WorkflowDefinitionVersion[]>(`/api/v1/workflow-definitions/${workflowDefinitionId}/versions`);
}

export function createWorkflowDefinitionVersion(
  workflowDefinitionId: string,
  body: { definition: Record<string, unknown> },
): Promise<{ workflowDefinitionVersionId: string }> {
  return api.post(`/api/v1/workflow-definitions/${workflowDefinitionId}/versions`, body);
}

export function getWorkflowDefinitionVersion(versionId: string): Promise<WorkflowDefinitionVersion> {
  return api.get<WorkflowDefinitionVersion>(`/api/v1/workflow-definition-versions/${versionId}`);
}

export function listWorkflowAssignmentRules(): Promise<WorkflowAssignmentRule[]> {
  return api.get<WorkflowAssignmentRule[]>('/api/v1/workflow-assignment-rules');
}

export function createWorkflowAssignmentRule(body: {
  workflowTypeCode: string;
  stepKey:          string;
  assigneeRoleCode: string;
  priority?:        number;
  conditions?:      Record<string, unknown>;
}): Promise<{ assignmentRuleId: string }> {
  return api.post('/api/v1/workflow-assignment-rules', body);
}
