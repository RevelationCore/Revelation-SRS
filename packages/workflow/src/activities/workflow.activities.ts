export interface StartWorkflowInstanceActivityInput {
  tenantId: string;
  environmentId?: string;
  workflowDefinitionVersionId: string;
  workflowCode: string;
  subjectEntityType: string;
  subjectEntityId?: string;
  correlationId?: string;
  startedBy: string;
  context?: Record<string, unknown>;
}

export interface AssignWorkflowTaskActivityInput {
  tenantId: string;
  workflowInstanceId: string;
  stepKey: string;
  taskTypeCode?: string;
  assigneeActorId?: string;
  assigneeRoleCode?: string;
  dueAt?: string;
  payload?: Record<string, unknown>;
}

export interface CompleteWorkflowTaskActivityInput {
  tenantId: string;
  workflowTaskId: string;
  completedBy: string;
  payload?: Record<string, unknown>;
}

export interface EscalateWorkflowTaskActivityInput {
  tenantId: string;
  workflowTaskId: string;
  reasonCode: string;
  escalatedToRoleCode?: string;
}

export interface RecordWorkflowDecisionActivityInput {
  tenantId: string;
  workflowInstanceId: string;
  gatewayKey: string;
  decisionCode: string;
  conditionSummary?: string;
  inputHash?: string;
  outcomeStepKey?: string;
  actorId?: string;
  metadata?: Record<string, unknown>;
}

export interface CompleteWorkflowInstanceActivityInput {
  tenantId: string;
  workflowInstanceId: string;
  statusCode?: 'completed' | 'cancelled' | 'failed';
  actorId?: string;
  metadata?: Record<string, unknown>;
}

export interface WorkflowTaskActivityResult {
  workflowTaskId: string;
}

export interface WorkflowInstanceActivityResult {
  workflowInstanceId: string;
}

export interface WorkflowActivities {
  startWorkflowInstance(input: StartWorkflowInstanceActivityInput): Promise<WorkflowInstanceActivityResult>;
  assignWorkflowTask(input: AssignWorkflowTaskActivityInput): Promise<WorkflowTaskActivityResult>;
  completeWorkflowTask(input: CompleteWorkflowTaskActivityInput): Promise<void>;
  escalateWorkflowTask(input: EscalateWorkflowTaskActivityInput): Promise<void>;
  recordWorkflowDecision(input: RecordWorkflowDecisionActivityInput): Promise<void>;
  completeWorkflowInstance(input: CompleteWorkflowInstanceActivityInput): Promise<void>;
}

export function createUnconfiguredWorkflowActivities(): WorkflowActivities {
  const notConfigured = (): never => {
    throw new Error('Workflow activity is not configured with an implementation');
  };
  return {
    startWorkflowInstance: notConfigured,
    assignWorkflowTask: notConfigured,
    completeWorkflowTask: notConfigured,
    escalateWorkflowTask: notConfigured,
    recordWorkflowDecision: notConfigured,
    completeWorkflowInstance: notConfigured,
  };
}
