import {
  workflowCommands,
  workflowDecisionAudits,
  workflowInstances,
  workflowOperationReceipts,
  workflowTasks,
  type Db,
  type TenantScopedDb,
  type WorkflowCommand,
  type WorkflowInstance,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, EVENT_TYPES, NotFoundError, ValidationError } from '@revelation-srs/domain';
import type {
  ApplyReviewCommandInput,
  EscalateReviewTaskInput,
  EscalateReviewTaskResult,
  RecordWorkflowEventInput,
  ReviewCommandOutcome,
  SrsWorkerActivities,
} from '@revelation-srs/workflow';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';

import type { AuditService } from '../audit/service.js';

import { enqueueWorkflowEvent, type WorkflowEventOutbox } from './workflow-event-outbox.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

/**
 * A business change applied when a review is approved, e.g. creating a
 * module registration. It runs before the review is closed and must be
 * idempotent for the same command ID: a retry after a crash must find the
 * change it already made rather than make a second one.
 *
 * Throw ValidationError, ConflictError or NotFoundError when a business rule
 * prevents the change. Those are recorded as a failed outcome (the decision
 * is kept, the task reopens). Anything else is treated as transient and the
 * activity is retried.
 */
export type DomainEffect = (context: {
  tenantId: string;
  commandId: string;
  instance: WorkflowInstance;
  command: WorkflowCommand;
}) => Promise<Record<string, unknown> | null>;

export interface DomainEffectRegistration {
  /** Decision codes that trigger the effect; others close the review with no change. */
  decisionCodes: string[];
  apply: DomainEffect;
}

const BUSINESS_RULE_ERRORS = [ValidationError, ConflictError, NotFoundError];

/**
 * Database-backed implementations of the review workflow's activities.
 * Runs in the worker process. Every method is safe to retry.
 */
export class ReviewActivitiesService {
  readonly #effects = new Map<string, DomainEffectRegistration>();

  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly outbox: WorkflowEventOutbox,
    private readonly recordEvent: (input: RecordWorkflowEventInput) => Promise<void>,
  ) {}

  registerEffect(workflowCode: string, registration: DomainEffectRegistration): void {
    this.#effects.set(workflowCode, registration);
  }

  activities(): SrsWorkerActivities {
    return {
      applyReviewCommand: (input) => this.applyReviewCommand(input),
      escalateReviewTask: (input) => this.escalateReviewTask(input),
      recordWorkflowEvent: (input) => this.recordEvent(input),
    };
  }

  async applyReviewCommand(input: ApplyReviewCommandInput): Promise<ReviewCommandOutcome> {
    const loaded = await withTenantContext(this.db, input.tenantId, async (tx) => {
      const rows = await tx.select({ command: workflowCommands, instance: workflowInstances, task: workflowTasks })
        .from(workflowCommands)
        .innerJoin(workflowInstances, eq(workflowCommands.workflowInstanceId, workflowInstances.id))
        .innerJoin(workflowTasks, eq(workflowCommands.workflowTaskId, workflowTasks.id))
        .where(and(
          eq(workflowCommands.id, input.commandId as Uuid),
          eq(workflowCommands.tenantId, input.tenantId as Uuid),
        ))
        .limit(1);
      return rows[0] ?? null;
    });
    // Only commands saved for this instance and tenant are honoured. Commands
    // are committed before they are delivered, so an unknown ID is a forged
    // or misrouted signal: ignore it rather than retry (which would block
    // the review's queue forever).
    if (!loaded || loaded.instance.id !== input.workflowInstanceId) {
      return {
        commandId: input.commandId,
        outcome: 'superseded',
        commandType: 'decision',
        decisionCode: null,
        instanceClosed: false,
        errorCode: 'unknown-command',
        errorDetail: 'No such command for this review',
      };
    }
    const { command, instance, task } = loaded;

    const previous = storedOutcome(command);
    if (previous) return previous;

    if (command.taskRevision !== task.revision || ['completed', 'cancelled'].includes(task.statusCode)) {
      return this.#finish(input.tenantId, command, { outcome: 'superseded', instanceClosed: false });
    }

    let effectResult: Record<string, unknown> | null = null;
    const effect = command.commandType === 'decision' ? this.#effects.get(instance.workflowCode) : undefined;
    if (effect && command.decisionCode && effect.decisionCodes.includes(command.decisionCode)) {
      try {
        effectResult = await effect.apply({ tenantId: input.tenantId, commandId: command.id, instance, command });
      } catch (error) {
        if (BUSINESS_RULE_ERRORS.some((type) => error instanceof type)) {
          return this.#finish(input.tenantId, command, {
            outcome: 'failed',
            instanceClosed: false,
            errorCode: error instanceof ConflictError ? 'conflict' : error instanceof NotFoundError ? 'not-found' : 'validation',
            errorDetail: (error as Error).message,
          });
        }
        throw error;
      }
    }

    return this.#finish(input.tenantId, command, {
      outcome: 'applied',
      instanceClosed: true,
      closedAs: command.commandType === 'cancellation' ? 'cancelled' : 'completed',
      ...(effectResult ? { result: effectResult } : {}),
    });
  }

  async escalateReviewTask(input: EscalateReviewTaskInput): Promise<EscalateReviewTaskResult> {
    const operationKey = `escalation:${input.workflowTaskId}`;
    const { result, eventIds } = await withTenantContext(this.db, input.tenantId, async (tx): Promise<{
      result: EscalateReviewTaskResult;
      eventIds: string[];
    }> => {
      const receipt = await this.#receipt(tx, input.tenantId, operationKey);
      if (receipt) return { result: receipt as unknown as EscalateReviewTaskResult, eventIds: [] as string[] };

      const taskRows = await tx.select().from(workflowTasks).where(and(
        eq(workflowTasks.id, input.workflowTaskId as Uuid),
        eq(workflowTasks.tenantId, input.tenantId as Uuid),
      )).for('update').limit(1);
      const task = taskRows[0];
      if (!task) throw new NotFoundError('WorkflowTask', input.workflowTaskId);
      if (['completed', 'cancelled'].includes(task.statusCode)) {
        return { result: { outcome: 'not-open' }, eventIds: [] as string[] };
      }

      // A decision accepted on or before the deadline wins over the timer.
      const pending = await tx.select({ id: workflowCommands.id }).from(workflowCommands).where(and(
        eq(workflowCommands.workflowTaskId, task.id),
        eq(workflowCommands.taskRevision, task.revision),
        inArray(workflowCommands.deliveryState, ['pending', 'delivered']),
        ...(task.dueAt ? [lte(workflowCommands.acceptedAt, task.dueAt)] : []),
      )).limit(1);
      if (pending[0]) {
        return {
          result: { outcome: 'decision-pending', pendingCommandId: pending[0].id },
          eventIds: [] as string[],
        };
      }

      const escalateTo = input.escalateToRoleCode ?? null;
      const outcome: EscalateReviewTaskResult = escalateTo ? { outcome: 'escalated' } : { outcome: 'needs-attention' };
      await tx.update(workflowTasks).set({
        statusCode: escalateTo ? 'escalated' : task.statusCode,
        assigneeRoleCode: escalateTo ?? task.assigneeRoleCode,
        // An escalated task is for the role, not the original individual.
        assigneeActorId: escalateTo ? null : task.assigneeActorId,
        attentionReasonCode: escalateTo ? null : 'deadline-passed-no-escalation-role',
        escalatedAt: sql`now()`,
        revision: task.revision + 1,
        updatedAt: sql`now()`,
      }).where(eq(workflowTasks.id, task.id));

      await tx.update(workflowInstances).set({
        executionStatus: escalateTo ? 'awaiting-decision' : 'needs-attention',
        executionStatusDetail: escalateTo
          ? `Escalated to ${escalateTo} after the deadline`
          : 'Deadline passed and no escalation role is configured',
        executionUpdatedAt: sql`now()`,
      }).where(eq(workflowInstances.id, task.workflowInstanceId));

      const eventId = await enqueueWorkflowEvent(tx, {
        tenantId: input.tenantId,
        eventType: EVENT_TYPES.WORKFLOW_TASK_ESCALATED,
        correlationId: task.workflowInstanceId,
        payload: {
          workflowInstanceId: task.workflowInstanceId,
          workflowTaskId: task.id,
          reasonCode: 'deadline-expired',
          escalatedToRoleCode: escalateTo ?? undefined,
          needsAttention: !escalateTo,
        },
      });

      await this.audit.record({
        tenantId: input.tenantId,
        entityType: 'workflow_task',
        entityId: task.id,
        actionType: 'update',
        actorType: 'system',
        actorId: 'temporal-worker',
        workflowInstanceId: task.workflowInstanceId,
        reasonCode: escalateTo ? 'task-escalated' : 'task-needs-attention',
        beforeValue: { assigneeRoleCode: task.assigneeRoleCode, revision: task.revision },
        afterValue: { assigneeRoleCode: escalateTo ?? task.assigneeRoleCode, revision: task.revision + 1 },
      }, tx);

      await this.#saveReceipt(tx, input.tenantId, operationKey, task.workflowInstanceId, outcome as unknown as Record<string, unknown>);
      return { result: outcome, eventIds: [eventId] };
    });

    await this.outbox.publishNow(input.tenantId, eventIds);
    return result;
  }

  /**
   * Record a command's outcome and, if it closes the review, close the task
   * and instance — all in one transaction with its receipt, decision audit,
   * audit trail and events.
   */
  async #finish(
    tenantId: string,
    command: WorkflowCommand,
    outcome: Omit<ReviewCommandOutcome, 'commandId' | 'commandType' | 'decisionCode'>,
  ): Promise<ReviewCommandOutcome> {
    const full: ReviewCommandOutcome = {
      commandId: command.id,
      commandType: command.commandType,
      decisionCode: command.decisionCode,
      ...outcome,
    };
    const operationKey = `command:${command.id}`;

    const { final, eventIds } = await withTenantContext(this.db, tenantId, async (tx) => {
      const receipt = await this.#receipt(tx, tenantId, operationKey);
      if (receipt) return { final: receipt as unknown as ReviewCommandOutcome, eventIds: [] as string[] };

      const taskRows = await tx.select().from(workflowTasks)
        .where(eq(workflowTasks.id, command.workflowTaskId!))
        .for('update').limit(1);
      const task = taskRows[0]!;
      const events: string[] = [];

      // The task may have moved on while a business change was being applied.
      if (full.outcome !== 'superseded' && (task.revision !== command.taskRevision
        || ['completed', 'cancelled'].includes(task.statusCode))) {
        full.outcome = 'superseded';
        full.instanceClosed = false;
        delete full.closedAs;
      }

      if (command.commandType === 'decision' && full.outcome !== 'superseded') {
        await tx.insert(workflowDecisionAudits).values({
          tenantId: tenantId as Uuid,
          workflowInstanceId: command.workflowInstanceId,
          gatewayKey: `${task.stepKey}:completion`,
          decisionCode: command.decisionCode!,
          conditionSummary: typeof command.payload['note'] === 'string' ? command.payload['note'] : null,
          actorId: command.actorId,
          metadata: {
            commandId: command.id,
            changeApplied: full.outcome === 'applied',
            ...(full.errorDetail ? { error: full.errorDetail } : {}),
          },
        });
        events.push(await enqueueWorkflowEvent(tx, {
          tenantId,
          eventType: EVENT_TYPES.WORKFLOW_DECISION_RECORDED,
          correlationId: command.workflowInstanceId,
          payload: {
            workflowInstanceId: command.workflowInstanceId,
            gatewayKey: `${task.stepKey}:completion`,
            decisionCode: command.decisionCode,
            changeApplied: full.outcome === 'applied',
          },
        }));
      }

      if (full.instanceClosed) {
        await tx.update(workflowTasks).set({
          statusCode: full.closedAs === 'cancelled' ? 'cancelled' : 'completed',
          completedBy: command.actorId,
          completedAt: sql`now()`,
          payload: {
            ...task.payload,
            ...command.payload,
            ...(command.decisionCode ? { decisionCode: command.decisionCode } : {}),
          },
          updatedAt: sql`now()`,
        }).where(eq(workflowTasks.id, task.id));
        await tx.update(workflowInstances).set({
          statusCode: full.closedAs === 'cancelled' ? 'cancelled' : 'completed',
          completedAt: sql`now()`,
          executionStatus: full.closedAs === 'cancelled' ? 'cancelled' : 'completed',
          executionStatusDetail: null,
          executionUpdatedAt: sql`now()`,
        }).where(eq(workflowInstances.id, command.workflowInstanceId));
        events.push(await enqueueWorkflowEvent(tx, {
          tenantId,
          eventType: EVENT_TYPES.WORKFLOW_TASK_COMPLETED,
          correlationId: command.workflowInstanceId,
          payload: { workflowInstanceId: command.workflowInstanceId, workflowTaskId: task.id, completedBy: command.actorId },
        }));
        events.push(await enqueueWorkflowEvent(tx, {
          tenantId,
          eventType: EVENT_TYPES.WORKFLOW_COMPLETED,
          correlationId: command.workflowInstanceId,
          payload: {
            workflowInstanceId: command.workflowInstanceId,
            statusCode: full.closedAs === 'cancelled' ? 'cancelled' : 'completed',
            metadata: { decisionCode: command.decisionCode },
          },
        }));
      } else if (full.outcome === 'failed') {
        // Keep the decision, reopen the task for a new one.
        await tx.update(workflowTasks).set({
          revision: task.revision + 1,
          updatedAt: sql`now()`,
        }).where(eq(workflowTasks.id, task.id));
        await tx.update(workflowInstances).set({
          executionStatus: 'awaiting-decision',
          executionStatusDetail: `Decision '${command.decisionCode}' recorded but not applied: ${full.errorDetail ?? 'unknown reason'}`,
          executionUpdatedAt: sql`now()`,
        }).where(eq(workflowInstances.id, command.workflowInstanceId));
      }

      await tx.update(workflowCommands).set({
        deliveryState: full.outcome,
        appliedAt: sql`now()`,
        deliveredAt: sql`coalesce(${workflowCommands.deliveredAt}, now())`,
        result: { outcome: full as unknown as Record<string, unknown> },
        errorCode: full.errorCode ?? null,
        errorDetail: full.errorDetail ?? null,
      }).where(eq(workflowCommands.id, command.id));

      await this.audit.record({
        tenantId,
        entityType: 'workflow_instance',
        entityId: command.workflowInstanceId,
        actionType: 'update',
        actorType: 'user',
        actorId: command.actorId,
        workflowInstanceId: command.workflowInstanceId,
        reasonCode: `command-${full.outcome}`,
        afterValue: {
          commandId: command.id,
          commandType: command.commandType,
          decisionCode: command.decisionCode,
          instanceClosed: full.instanceClosed,
          ...(full.errorDetail ? { error: full.errorDetail } : {}),
        },
      }, tx);

      await this.#saveReceipt(tx, tenantId, operationKey, command.workflowInstanceId, full as unknown as Record<string, unknown>);
      return { final: full, eventIds: events };
    });

    await this.outbox.publishNow(tenantId, eventIds);
    return final;
  }

  async #receipt(tx: TenantScopedDb, tenantId: string, operationKey: string): Promise<Record<string, unknown> | null> {
    const rows = await tx.select({ result: workflowOperationReceipts.result }).from(workflowOperationReceipts).where(and(
      eq(workflowOperationReceipts.tenantId, tenantId as Uuid),
      eq(workflowOperationReceipts.operationKey, operationKey),
    )).limit(1);
    return rows[0]?.result ?? null;
  }

  async #saveReceipt(
    tx: TenantScopedDb,
    tenantId: string,
    operationKey: string,
    workflowInstanceId: string,
    result: Record<string, unknown>,
  ): Promise<void> {
    await tx.insert(workflowOperationReceipts).values({
      tenantId: tenantId as Uuid,
      operationKey,
      workflowInstanceId: workflowInstanceId as Uuid,
      result,
    });
  }
}

function storedOutcome(command: WorkflowCommand): ReviewCommandOutcome | null {
  if (!['applied', 'failed', 'superseded'].includes(command.deliveryState)) return null;
  const outcome = command.result['outcome'] as ReviewCommandOutcome | undefined;
  return outcome ?? null;
}
