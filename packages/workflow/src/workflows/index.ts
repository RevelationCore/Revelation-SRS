import { condition, defineQuery, defineSignal, proxyActivities, setHandler } from '@temporalio/workflow';

import type { auditActivities } from '../activities/audit.activities.js';
import type { WorkflowActivities } from '../activities/workflow.activities.js';

const activities = proxyActivities<typeof auditActivities>({
  startToCloseTimeout: '30 seconds',
  retry: {
    initialInterval: '1 second',
    maximumAttempts: 3,
  },
});

const workflowActivities = proxyActivities<WorkflowActivities>({
  startToCloseTimeout: '30 seconds',
  retry: {
    initialInterval: '1 second',
    maximumAttempts: 3,
  },
});

export interface RecordAuditWorkflowInput {
  tenantId?: string;
  workflowInstanceId: string;
  workflowType: string;
  event:        string;
  actorId?:     string;
  occurredAt:   string;
  metadata?:    Record<string, unknown>;
}

export async function recordAuditWorkflow(input: RecordAuditWorkflowInput): Promise<void> {
  await activities.recordWorkflowEvent(input);
}

export interface GenericHumanTaskWorkflowInput {
  tenantId: string;
  environmentId?: string;
  workflowDefinitionVersionId: string;
  workflowCode: string;
  subjectEntityType: string;
  subjectEntityId?: string;
  correlationId?: string;
  startedBy: string;
  context?: Record<string, unknown>;
  task: {
    stepKey: string;
    taskTypeCode?: string;
    assigneeActorId?: string;
    assigneeRoleCode?: string;
    dueAfterMs?: number;
    dueAt?: string;
    payload?: Record<string, unknown>;
  };
}

export interface CompleteTaskSignalInput {
  completedBy: string;
  payload?: Record<string, unknown>;
}

export interface GenericHumanTaskWorkflowState {
  workflowInstanceId: string | null;
  workflowTaskId: string | null;
  status: 'starting' | 'task-assigned' | 'task-completed' | 'escalated' | 'completed';
}

export const completeTaskSignal = defineSignal<[CompleteTaskSignalInput]>('completeTask');
export const workflowStateQuery = defineQuery<GenericHumanTaskWorkflowState>('state');

export async function genericHumanTaskWorkflow(input: GenericHumanTaskWorkflowInput): Promise<GenericHumanTaskWorkflowState> {
  let completedBy: string | null = null;
  let completionPayload: Record<string, unknown> | undefined;
  const state: GenericHumanTaskWorkflowState = {
    workflowInstanceId: null,
    workflowTaskId: null,
    status: 'starting',
  };

  setHandler(completeTaskSignal, (signalInput) => {
    completedBy = signalInput.completedBy;
    completionPayload = signalInput.payload;
  });
  setHandler(workflowStateQuery, () => state);

  const instance = await workflowActivities.startWorkflowInstance({
    tenantId: input.tenantId,
    ...(input.environmentId ? { environmentId: input.environmentId } : {}),
    workflowDefinitionVersionId: input.workflowDefinitionVersionId,
    workflowCode: input.workflowCode,
    subjectEntityType: input.subjectEntityType,
    ...(input.subjectEntityId ? { subjectEntityId: input.subjectEntityId } : {}),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    startedBy: input.startedBy,
    context: input.context ?? {},
  });
  state.workflowInstanceId = instance.workflowInstanceId;

  await activities.recordWorkflowEvent({
    tenantId: input.tenantId,
    workflowInstanceId: state.workflowInstanceId,
    workflowType: input.workflowCode,
    event: 'workflow-started',
    actorId: input.startedBy,
    occurredAt: new Date().toISOString(),
    ...(input.context ? { metadata: input.context } : {}),
  });

  const dueAt = input.task.dueAt ?? (input.task.dueAfterMs ? new Date(Date.now() + input.task.dueAfterMs).toISOString() : undefined);
  const task = await workflowActivities.assignWorkflowTask({
    tenantId: input.tenantId,
    workflowInstanceId: state.workflowInstanceId,
    stepKey: input.task.stepKey,
    ...(input.task.taskTypeCode ? { taskTypeCode: input.task.taskTypeCode } : {}),
    ...(input.task.assigneeActorId ? { assigneeActorId: input.task.assigneeActorId } : {}),
    ...(input.task.assigneeRoleCode ? { assigneeRoleCode: input.task.assigneeRoleCode } : {}),
    ...(dueAt ? { dueAt } : {}),
    payload: input.task.payload ?? {},
  });
  state.workflowTaskId = task.workflowTaskId;
  state.status = 'task-assigned';

  const completed = input.task.dueAfterMs
    ? await condition(() => completedBy !== null, input.task.dueAfterMs)
    : (await condition(() => completedBy !== null), true);

  if (!completed) {
    await workflowActivities.escalateWorkflowTask({
      tenantId: input.tenantId,
      workflowTaskId: state.workflowTaskId,
      reasonCode: 'deadline-expired',
      ...(input.task.assigneeRoleCode ? { escalatedToRoleCode: input.task.assigneeRoleCode } : {}),
    });
    state.status = 'escalated';
    return state;
  }

  await workflowActivities.completeWorkflowTask({
    tenantId: input.tenantId,
    workflowTaskId: state.workflowTaskId,
    completedBy: completedBy!,
    payload: completionPayload ?? {},
  });
  state.status = 'task-completed';

  await workflowActivities.recordWorkflowDecision({
    tenantId: input.tenantId,
    workflowInstanceId: state.workflowInstanceId,
    gatewayKey: `${input.task.stepKey}:completion`,
    decisionCode: 'approved',
    actorId: completedBy!,
    metadata: completionPayload ?? {},
  });

  await workflowActivities.completeWorkflowInstance({
    tenantId: input.tenantId,
    workflowInstanceId: state.workflowInstanceId,
    statusCode: 'completed',
    actorId: completedBy!,
  });
  state.status = 'completed';

  return state;
}
