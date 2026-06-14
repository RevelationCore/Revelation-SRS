import {
  workflowDecisionAudits,
  workflowInstances,
  workflowTasks,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { EVENT_TYPES, NotFoundError } from '@revelation-srs/domain';
import type {
  AssignWorkflowTaskActivityInput,
  CompleteWorkflowInstanceActivityInput,
  CompleteWorkflowTaskActivityInput,
  EscalateWorkflowTaskActivityInput,
  RecordWorkflowDecisionActivityInput,
  RecordWorkflowEventInput,
  StartWorkflowInstanceActivityInput,
  WorkflowActivities,
  WorkflowInstanceActivityResult,
  WorkflowTaskActivityResult,
} from '@revelation-srs/workflow';
import { and, eq } from 'drizzle-orm';

import type { AuditService } from '../audit/service.js';
import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';

export class WorkflowBridgeService implements WorkflowActivities {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly eventBus: IntegrationBusPublisher,
  ) {}

  async recordWorkflowEvent(input: RecordWorkflowEventInput): Promise<void> {
    await this.audit.record({
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      entityType: 'workflow_instance',
      entityId: input.workflowInstanceId,
      actionType: 'update',
      actorType: input.actorId ? 'user' : 'system',
      actorId: input.actorId ?? 'system',
      workflowInstanceId: input.workflowInstanceId,
      reasonCode: input.event,
      afterValue: {
        workflowType: input.workflowType,
        occurredAt: input.occurredAt,
        metadata: input.metadata ?? {},
      },
    });
  }

  async startWorkflowInstance(input: StartWorkflowInstanceActivityInput): Promise<WorkflowInstanceActivityResult> {
    const rows = await withTenantContext(this.db, input.tenantId, async (tx) =>
      tx.insert(workflowInstances).values({
        tenantId: input.tenantId as `${string}-${string}-${string}-${string}-${string}`,
        environmentId: input.environmentId as `${string}-${string}-${string}-${string}-${string}` | undefined ?? null,
        workflowDefinitionVersionId: input.workflowDefinitionVersionId as `${string}-${string}-${string}-${string}-${string}`,
        workflowCode: input.workflowCode,
        subjectEntityType: input.subjectEntityType,
        subjectEntityId: input.subjectEntityId as `${string}-${string}-${string}-${string}-${string}` | undefined ?? null,
        statusCode: 'running',
        correlationId: input.correlationId as `${string}-${string}-${string}-${string}-${string}` | undefined ?? null,
        startedBy: input.startedBy,
        context: input.context ?? {},
      }).returning({ id: workflowInstances.id }),
    );
    return { workflowInstanceId: rows[0]!.id };
  }

  async assignWorkflowTask(input: AssignWorkflowTaskActivityInput): Promise<WorkflowTaskActivityResult> {
    const statusCode = input.assigneeActorId || input.assigneeRoleCode ? 'assigned' : 'pending';
    const rows = await withTenantContext(this.db, input.tenantId, async (tx) =>
      tx.insert(workflowTasks).values({
        tenantId: input.tenantId as `${string}-${string}-${string}-${string}-${string}`,
        workflowInstanceId: input.workflowInstanceId as `${string}-${string}-${string}-${string}-${string}`,
        stepKey: input.stepKey,
        taskTypeCode: input.taskTypeCode ?? 'human-task',
        statusCode,
        assigneeActorId: input.assigneeActorId ?? null,
        assigneeRoleCode: input.assigneeRoleCode ?? null,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        payload: input.payload ?? {},
      }).returning({ id: workflowTasks.id }),
    );
    const workflowTaskId = rows[0]!.id;

    await this.#publishWorkflowEvent(EVENT_TYPES.WORKFLOW_TASK_ASSIGNED, input.tenantId, input.workflowInstanceId, {
      workflowInstanceId: input.workflowInstanceId,
      workflowTaskId,
      stepKey: input.stepKey,
      assigneeActorId: input.assigneeActorId,
      assigneeRoleCode: input.assigneeRoleCode,
      dueAt: input.dueAt,
    });

    await this.recordWorkflowEvent({
      tenantId: input.tenantId,
      workflowInstanceId: input.workflowInstanceId,
      workflowType: 'generic',
      event: 'task-assigned',
      occurredAt: new Date().toISOString(),
      metadata: { workflowTaskId, stepKey: input.stepKey },
    });

    return { workflowTaskId };
  }

  async completeWorkflowTask(input: CompleteWorkflowTaskActivityInput): Promise<void> {
    const task = await this.#getTask(input.tenantId, input.workflowTaskId);
    const now = new Date();
    await withTenantContext(this.db, input.tenantId, async (tx) => {
      await tx.update(workflowTasks).set({
        statusCode: 'completed',
        completedBy: input.completedBy,
        completedAt: now,
        payload: input.payload ?? task.payload,
        updatedAt: now,
      }).where(and(
        eq(workflowTasks.id, input.workflowTaskId as `${string}-${string}-${string}-${string}-${string}`),
        eq(workflowTasks.tenantId, input.tenantId as `${string}-${string}-${string}-${string}-${string}`),
      ));
    });

    await this.#publishWorkflowEvent(EVENT_TYPES.WORKFLOW_TASK_COMPLETED, input.tenantId, task.workflowInstanceId, {
      workflowInstanceId: task.workflowInstanceId,
      workflowTaskId: input.workflowTaskId,
      completedBy: input.completedBy,
    });
    await this.recordWorkflowEvent({
      tenantId: input.tenantId,
      workflowInstanceId: task.workflowInstanceId,
      workflowType: 'generic',
      event: 'task-completed',
      actorId: input.completedBy,
      occurredAt: now.toISOString(),
      metadata: { workflowTaskId: input.workflowTaskId },
    });
  }

  async escalateWorkflowTask(input: EscalateWorkflowTaskActivityInput): Promise<void> {
    const task = await this.#getTask(input.tenantId, input.workflowTaskId);
    const now = new Date();
    await withTenantContext(this.db, input.tenantId, async (tx) => {
      await tx.update(workflowTasks).set({
        statusCode: 'escalated',
        assigneeRoleCode: input.escalatedToRoleCode ?? task.assigneeRoleCode,
        updatedAt: now,
      }).where(and(
        eq(workflowTasks.id, input.workflowTaskId as `${string}-${string}-${string}-${string}-${string}`),
        eq(workflowTasks.tenantId, input.tenantId as `${string}-${string}-${string}-${string}-${string}`),
      ));
    });

    await this.#publishWorkflowEvent(EVENT_TYPES.WORKFLOW_TASK_ESCALATED, input.tenantId, task.workflowInstanceId, {
      workflowInstanceId: task.workflowInstanceId,
      workflowTaskId: input.workflowTaskId,
      reasonCode: input.reasonCode,
      escalatedToRoleCode: input.escalatedToRoleCode,
    });
    await this.recordWorkflowEvent({
      tenantId: input.tenantId,
      workflowInstanceId: task.workflowInstanceId,
      workflowType: 'generic',
      event: 'task-escalated',
      occurredAt: now.toISOString(),
      metadata: { workflowTaskId: input.workflowTaskId, reasonCode: input.reasonCode },
    });
  }

  async recordWorkflowDecision(input: RecordWorkflowDecisionActivityInput): Promise<void> {
    await withTenantContext(this.db, input.tenantId, async (tx) => {
      await tx.insert(workflowDecisionAudits).values({
        tenantId: input.tenantId as `${string}-${string}-${string}-${string}-${string}`,
        workflowInstanceId: input.workflowInstanceId as `${string}-${string}-${string}-${string}-${string}`,
        gatewayKey: input.gatewayKey,
        decisionCode: input.decisionCode,
        conditionSummary: input.conditionSummary ?? null,
        inputHash: input.inputHash ?? null,
        outcomeStepKey: input.outcomeStepKey ?? null,
        actorId: input.actorId ?? 'system',
        metadata: input.metadata ?? {},
      });
    });

    await this.#publishWorkflowEvent(EVENT_TYPES.WORKFLOW_DECISION_RECORDED, input.tenantId, input.workflowInstanceId, {
      workflowInstanceId: input.workflowInstanceId,
      gatewayKey: input.gatewayKey,
      decisionCode: input.decisionCode,
      outcomeStepKey: input.outcomeStepKey,
    });
    await this.recordWorkflowEvent({
      tenantId: input.tenantId,
      workflowInstanceId: input.workflowInstanceId,
      workflowType: 'generic',
      event: 'decision-recorded',
      ...(input.actorId ? { actorId: input.actorId } : {}),
      occurredAt: new Date().toISOString(),
      metadata: { gatewayKey: input.gatewayKey, decisionCode: input.decisionCode },
    });
  }

  async completeWorkflowInstance(input: CompleteWorkflowInstanceActivityInput): Promise<void> {
    const now = new Date();
    await withTenantContext(this.db, input.tenantId, async (tx) => {
      await tx.update(workflowInstances).set({
        statusCode: input.statusCode ?? 'completed',
        completedAt: now,
      }).where(and(
        eq(workflowInstances.id, input.workflowInstanceId as `${string}-${string}-${string}-${string}-${string}`),
        eq(workflowInstances.tenantId, input.tenantId as `${string}-${string}-${string}-${string}-${string}`),
      ));
    });

    await this.#publishWorkflowEvent(EVENT_TYPES.WORKFLOW_COMPLETED, input.tenantId, input.workflowInstanceId, {
      workflowInstanceId: input.workflowInstanceId,
      statusCode: input.statusCode ?? 'completed',
      metadata: input.metadata ?? {},
    });
    await this.recordWorkflowEvent({
      tenantId: input.tenantId,
      workflowInstanceId: input.workflowInstanceId,
      workflowType: 'generic',
      event: 'workflow-completed',
      ...(input.actorId ? { actorId: input.actorId } : {}),
      occurredAt: now.toISOString(),
      metadata: input.metadata ?? {},
    });
  }

  async #getTask(tenantId: string, workflowTaskId: string): Promise<typeof workflowTasks.$inferSelect> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(workflowTasks).where(and(
        eq(workflowTasks.id, workflowTaskId as `${string}-${string}-${string}-${string}-${string}`),
        eq(workflowTasks.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
      )).limit(1),
    );
    if (!rows[0]) throw new NotFoundError('WorkflowTask', workflowTaskId);
    return rows[0];
  }

  async #publishWorkflowEvent(
    eventType: (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES],
    tenantId: string,
    correlationId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.eventBus.isConnected()) return;
    await this.eventBus.publish(eventType, '1.0.0', tenantId, correlationId, 'standard', payload);
  }
}
