import { createHash, randomUUID } from 'node:crypto';

import {
  workflowCommands,
  workflowInstances,
  workflowSteps,
  workflowTasks,
  type Db,
  type TenantScopedDb,
  type WorkflowCommand,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, EVENT_TYPES, NotFoundError, ValidationError } from '@revelation-srs/domain';
import {
  REVIEW_EXECUTION_CONTRACT_VERSION,
  reviewWorkflowId,
  type ReviewCommandOutcome,
  type ReviewCommandRef,
  type ReviewWorkflowInput,
} from '@revelation-srs/workflow';
import { and, eq, sql } from 'drizzle-orm';

import type { AuditService } from '../audit/service.js';

import type { FeatureFlagService } from './feature-flag-service.js';
import { enqueueWorkflowEvent, type WorkflowEventOutbox } from './workflow-event-outbox.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export const TEMPORAL_EXECUTION_FLAG_KEY = 'workflow.temporal-execution';

/** Deployment settings for live execution. Disabled unless explicitly enabled. */
export interface TemporalExecutionSettings {
  enabled: boolean;
  namespace: string;
  taskQueue: string;
  environmentCode: string;
  /** How long a decision request waits for the workflow to apply it. */
  decisionWaitMs: number;
}

/**
 * The calls the API makes to Temporal. An interface so tests and a disabled
 * deployment can supply something other than the SDK client.
 */
export interface TemporalGateway {
  startReview(workflowId: string, input: ReviewWorkflowInput): Promise<{ runId: string }>;
  submitCommand(workflowId: string, ref: ReviewCommandRef, waitMs: number): Promise<ReviewCommandOutcome>;
  signalCommand(workflowId: string, ref: ReviewCommandRef): Promise<void>;
}

export interface StartReviewInput {
  tenantId: string;
  environmentId?: string;
  workflowDefinitionVersionId: string;
  workflowCode: string;
  subjectEntityType: string;
  subjectEntityId?: string;
  correlationId?: string;
  startedBy: string;
  context: Record<string, unknown>;
  task: {
    stepKey: string;
    taskTypeCode?: string;
    assigneeActorId?: string;
    assigneeRoleCode?: string;
    /** Used only when the step configuration does not define a duration. */
    dueAt?: string;
    payload: Record<string, unknown>;
  };
}

export interface StartReviewResult {
  workflowInstanceId: string;
  workflowTaskId: string;
  executionBackend: 'temporal';
  executionStatus: string;
}

export interface SubmitCommandInput {
  tenantId: string;
  workflowTaskId: string;
  actorId: string;
  commandType: 'decision' | 'cancellation';
  decisionCode?: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
}

export type CommandStatus = 'applied' | 'pending' | 'failed' | 'superseded';

export interface CommandReceipt {
  commandId: string;
  workflowInstanceId: string;
  workflowTaskId: string | null;
  commandType: 'decision' | 'cancellation';
  decisionCode: string | null;
  status: CommandStatus;
  acceptedAt: Date;
  appliedAt: Date | null;
  result: Record<string, unknown>;
  errorCode: string | null;
  errorDetail: string | null;
}

/**
 * Starts reviews on Temporal and accepts decisions for them.
 *
 * The database stays authoritative. A review's instance and task are saved
 * in one transaction before Temporal is contacted; a decision is saved as a
 * workflow_command, unique per task revision, before it is delivered. If
 * Temporal or the worker is unavailable, nothing accepted is lost: the
 * reconciler starts or delivers it later.
 */
export class ReviewExecutionService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly outbox: WorkflowEventOutbox,
    private readonly featureFlags: FeatureFlagService,
    private readonly settings: TemporalExecutionSettings,
    private readonly gateway: TemporalGateway | null,
  ) {}

  get isAvailable(): boolean {
    return this.settings.enabled && this.gateway !== null;
  }

  get taskQueue(): string {
    return this.settings.taskQueue;
  }

  /**
   * Which engine a new review runs on. Temporal only when the deployment
   * enables it and the rollout flag is on for this tenant/environment/version.
   * Fixed at start: changing the flag affects new starts only.
   */
  async selectBackend(
    tenantId: string,
    opts: { workflowDefinitionVersionId: string; environmentId?: string },
  ): Promise<'legacy' | 'temporal'> {
    if (!this.isAvailable) return 'legacy';
    try {
      const flag = await this.featureFlags.getFlagByKey(TEMPORAL_EXECUTION_FLAG_KEY);
      if (flag.statusCode === 'retired') return 'legacy';
      const base = { tenantId, workflowDefinitionVersionId: opts.workflowDefinitionVersionId };
      // Scope by environment when it is registered; an unregistered
      // environment code falls back to tenant/version scoping rather than
      // failing (which would silently force every start onto legacy).
      const result = await this.featureFlags.evaluatePreview(flag.featureFlagId, opts.environmentId
        ? { ...base, environmentId: opts.environmentId }
        : { ...base, environmentCode: this.settings.environmentCode })
        .catch((error: unknown) => {
          if (error instanceof NotFoundError && !opts.environmentId) {
            return this.featureFlags.evaluatePreview(flag.featureFlagId, base);
          }
          throw error;
        });
      return result.value === true || result.variantKey === 'on' ? 'temporal' : 'legacy';
    } catch {
      return 'legacy';
    }
  }

  async startReview(input: StartReviewInput): Promise<StartReviewResult> {
    if (!this.isAvailable) throw new Error('Temporal execution is not enabled for this deployment');

    const stepConfig = await this.#stepConfiguration(input.tenantId, input.workflowDefinitionVersionId, input.task.stepKey);
    const dueAfterHours = typeof stepConfig['dueAfterHours'] === 'number' ? stepConfig['dueAfterHours'] : null;
    const escalateToRoleCode = typeof stepConfig['escalateToRoleCode'] === 'string' && stepConfig['escalateToRoleCode']
      ? stepConfig['escalateToRoleCode']
      : null;

    const workflowInstanceId = randomUUID();
    const workflowId = reviewWorkflowId(this.settings.environmentCode, input.tenantId, workflowInstanceId);

    const { workflowTaskId, dueAt, eventIds } = await withTenantContext(this.db, input.tenantId, async (tx) => {
      // The deadline is resolved once, from the database clock, and stored.
      const dueRows = await tx.execute<{ due_at: string | null }>(dueAfterHours !== null
        ? sql`SELECT (now() + make_interval(secs => ${dueAfterHours * 3600}))::text AS due_at`
        : sql`SELECT ${input.task.dueAt ?? null}::timestamptz::text AS due_at`);
      const dueAtText = firstRow<{ due_at: string | null }>(dueRows)?.due_at ?? null;
      const resolvedDueAt = dueAtText ? new Date(dueAtText) : null;

      await tx.insert(workflowInstances).values({
        id: workflowInstanceId,
        tenantId: input.tenantId as Uuid,
        environmentId: (input.environmentId as Uuid | undefined) ?? null,
        workflowDefinitionVersionId: input.workflowDefinitionVersionId as Uuid,
        workflowCode: input.workflowCode,
        subjectEntityType: input.subjectEntityType,
        subjectEntityId: (input.subjectEntityId as Uuid | undefined) ?? null,
        statusCode: 'running',
        correlationId: (input.correlationId as Uuid | undefined) ?? null,
        startedBy: input.startedBy,
        context: input.context,
        executionBackend: 'temporal',
        executionStatus: 'starting',
        executionUpdatedAt: sql`now()`,
        temporalNamespace: this.settings.namespace,
        temporalTaskQueue: this.settings.taskQueue,
        temporalWorkflowId: workflowId,
        executionContractVersion: REVIEW_EXECUTION_CONTRACT_VERSION,
      });

      const statusCode = input.task.assigneeActorId || input.task.assigneeRoleCode ? 'assigned' : 'pending';
      const taskRows = await tx.insert(workflowTasks).values({
        tenantId: input.tenantId as Uuid,
        workflowInstanceId: workflowInstanceId,
        stepKey: input.task.stepKey,
        taskTypeCode: input.task.taskTypeCode ?? 'human-task',
        statusCode,
        assigneeActorId: input.task.assigneeActorId ?? null,
        assigneeRoleCode: input.task.assigneeRoleCode ?? null,
        dueAt: resolvedDueAt,
        payload: {
          ...input.task.payload,
          workflowEscalation: { escalateToRoleCode },
        },
      }).returning({ id: workflowTasks.id });
      const taskId = taskRows[0]!.id;

      const assignedEvent = await enqueueWorkflowEvent(tx, {
        tenantId: input.tenantId,
        eventType: EVENT_TYPES.WORKFLOW_TASK_ASSIGNED,
        correlationId: workflowInstanceId,
        payload: {
          workflowInstanceId,
          workflowTaskId: taskId,
          stepKey: input.task.stepKey,
          assigneeActorId: input.task.assigneeActorId,
          assigneeRoleCode: input.task.assigneeRoleCode,
          dueAt: resolvedDueAt?.toISOString(),
        },
      });

      await this.audit.record({
        tenantId: input.tenantId,
        entityType: 'workflow_instance',
        entityId: workflowInstanceId,
        actionType: 'create',
        actorType: 'user',
        actorId: input.startedBy,
        workflowInstanceId,
        reasonCode: 'workflow-started',
        afterValue: { workflowCode: input.workflowCode, executionBackend: 'temporal', workflowTaskId: taskId },
      }, tx);

      return { workflowTaskId: taskId, dueAt: resolvedDueAt, eventIds: [assignedEvent] };
    });

    await this.outbox.publishNow(input.tenantId, eventIds);

    const executionStatus = await this.ensureStarted(input.tenantId, workflowInstanceId, {
      workflowTaskId,
      dueAt: dueAt?.toISOString() ?? null,
      escalateToRoleCode,
    });

    return { workflowInstanceId, workflowTaskId, executionBackend: 'temporal', executionStatus };
  }

  /**
   * Start the execution if it has not been started. Safe to repeat: the
   * stable workflow ID returns the existing execution. Returns the stored
   * execution status (still 'starting' if Temporal could not be reached).
   */
  async ensureStarted(
    tenantId: string,
    workflowInstanceId: string,
    known?: { workflowTaskId: string; dueAt: string | null; escalateToRoleCode: string | null },
  ): Promise<string> {
    if (!this.gateway) return 'starting';
    const instance = await this.#getInstance(tenantId, workflowInstanceId);
    if (instance.executionStatus !== 'starting') return instance.executionStatus ?? 'starting';

    const reviewInput = known
      ? this.#reviewInput(tenantId, workflowInstanceId, known)
      : await this.#reviewInputFromDb(tenantId, workflowInstanceId);

    try {
      const { runId } = await this.gateway.startReview(instance.temporalWorkflowId!, reviewInput);
      await withTenantContext(this.db, tenantId, async (tx) => {
        await tx.update(workflowInstances).set({
          temporalRunId: runId,
          executionStatus: 'awaiting-decision',
          executionStatusDetail: null,
          executionUpdatedAt: sql`now()`,
        }).where(and(
          eq(workflowInstances.id, workflowInstanceId as Uuid),
          eq(workflowInstances.executionStatus, 'starting'),
        ));
      });
      return 'awaiting-decision';
    } catch (error) {
      await withTenantContext(this.db, tenantId, async (tx) => {
        await tx.update(workflowInstances).set({
          executionStatusDetail: `Start pending: ${safeMessage(error)}`,
          executionUpdatedAt: sql`now()`,
        }).where(eq(workflowInstances.id, workflowInstanceId as Uuid));
      });
      return 'starting';
    }
  }

  /**
   * Accept a decision or cancellation for a Temporal-run task, then try to
   * deliver it and wait briefly for the outcome.
   *
   * - The same idempotency key and payload return the same receipt.
   * - A second, different command for the same task revision is a conflict.
   * - After the deadline, while escalation is still pending, decisions are
   *   refused with a conflict rather than accepted for the old assignee.
   */
  async submitCommand(input: SubmitCommandInput): Promise<CommandReceipt> {
    const payload = input.payload ?? {};
    const payloadHash = hashPayload({
      commandType: input.commandType,
      decisionCode: input.decisionCode ?? null,
      payload,
    });

    const { command, created } = await withTenantContext(this.db, input.tenantId, async (tx) => {
      const taskRows = await tx.select({ task: workflowTasks, instance: workflowInstances })
        .from(workflowTasks)
        .innerJoin(workflowInstances, eq(workflowTasks.workflowInstanceId, workflowInstances.id))
        .where(and(
          eq(workflowTasks.id, input.workflowTaskId as Uuid),
          eq(workflowTasks.tenantId, input.tenantId as Uuid),
        ))
        .for('update', { of: workflowTasks })
        .limit(1);
      const row = taskRows[0];
      if (!row) throw new NotFoundError('WorkflowTask', input.workflowTaskId);
      if (row.instance.executionBackend !== 'temporal') {
        throw new ValidationError('This task is not run by the Temporal execution backend');
      }

      const idempotencyKey = input.idempotencyKey
        ?? `${input.workflowTaskId}:${row.task.revision}:${input.actorId}:${payloadHash}`;
      const existing = await this.#findByIdempotencyKey(tx, input.tenantId, idempotencyKey);
      if (existing) {
        if (existing.payloadHash !== payloadHash) {
          throw new ConflictError('This idempotency key was already used for a different request');
        }
        return { command: existing, created: false };
      }

      if (['completed', 'cancelled'].includes(row.task.statusCode) || row.instance.statusCode !== 'running') {
        throw new ConflictError('This review is already closed');
      }

      if (input.commandType === 'decision' && row.task.dueAt && !row.task.escalatedAt) {
        const late = await tx.execute<{ late: boolean }>(
          sql`SELECT now() > ${row.task.dueAt.toISOString()}::timestamptz AS late`,
        );
        if (firstRow<{ late: boolean }>(late)?.late) {
          throw new ConflictError(
            'The deadline for this task has passed and escalation is pending. Try again shortly.',
          );
        }
      }

      const inserted = await tx.insert(workflowCommands).values({
        tenantId: input.tenantId as Uuid,
        workflowInstanceId: row.instance.id,
        workflowTaskId: row.task.id,
        taskRevision: row.task.revision,
        commandType: input.commandType,
        idempotencyKey,
        payloadHash,
        decisionCode: input.decisionCode ?? null,
        payload,
        actorId: input.actorId,
      }).onConflictDoNothing().returning();
      if (!inserted[0]) {
        throw new ConflictError('A decision has already been made for this task');
      }

      await this.audit.record({
        tenantId: input.tenantId,
        entityType: 'workflow_task',
        entityId: row.task.id,
        actionType: 'update',
        actorType: 'user',
        actorId: input.actorId,
        workflowInstanceId: row.instance.id,
        reasonCode: input.commandType === 'decision' ? 'decision-accepted' : 'cancellation-accepted',
        afterValue: { commandId: inserted[0].id, decisionCode: input.decisionCode ?? null, taskRevision: row.task.revision },
      }, tx);

      return { command: inserted[0], created: true };
    });

    if (created || command.deliveryState === 'pending') {
      await this.#deliver(input.tenantId, command);
    }
    return this.getCommand(input.tenantId, command.id);
  }

  async getCommand(tenantId: string, commandId: string): Promise<CommandReceipt> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(workflowCommands).where(and(
        eq(workflowCommands.id, commandId as Uuid),
        eq(workflowCommands.tenantId, tenantId as Uuid),
      )).limit(1),
    );
    if (!rows[0]) throw new NotFoundError('WorkflowCommand', commandId);
    return toReceipt(rows[0]);
  }

  async isCommandActor(tenantId: string, commandId: string, actorId: string): Promise<boolean> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ actorId: workflowCommands.actorId }).from(workflowCommands).where(and(
        eq(workflowCommands.id, commandId as Uuid),
        eq(workflowCommands.tenantId, tenantId as Uuid),
      )).limit(1),
    );
    return rows[0]?.actorId === actorId;
  }

  async findOpenTaskId(tenantId: string, workflowInstanceId: string): Promise<string | null> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ id: workflowTasks.id, statusCode: workflowTasks.statusCode }).from(workflowTasks).where(and(
        eq(workflowTasks.workflowInstanceId, workflowInstanceId as Uuid),
        eq(workflowTasks.tenantId, tenantId as Uuid),
      )),
    );
    return rows.find((r) => !['completed', 'cancelled'].includes(r.statusCode))?.id ?? null;
  }

  /** Re-deliver a saved command (reconciler path). Returns true if delivered. */
  async redeliver(tenantId: string, commandId: string): Promise<boolean> {
    if (!this.gateway) return false;
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ command: workflowCommands, instance: workflowInstances })
        .from(workflowCommands)
        .innerJoin(workflowInstances, eq(workflowCommands.workflowInstanceId, workflowInstances.id))
        .where(eq(workflowCommands.id, commandId as Uuid))
        .limit(1),
    );
    const row = rows[0];
    if (!row || row.command.deliveryState !== 'pending') return false;
    if (row.instance.executionStatus === 'starting') {
      const status = await this.ensureStarted(tenantId, row.instance.id);
      if (status === 'starting') {
        await this.#recordDeliveryFailure(tenantId, commandId, 'execution not started yet');
        return false;
      }
    }
    try {
      await this.gateway.signalCommand(row.instance.temporalWorkflowId!, { commandId });
      await withTenantContext(this.db, tenantId, async (tx) => {
        await tx.update(workflowCommands).set({
          deliveryState: 'delivered',
          deliveredAt: sql`now()`,
          deliveryAttempts: sql`${workflowCommands.deliveryAttempts} + 1`,
        }).where(and(eq(workflowCommands.id, commandId as Uuid), eq(workflowCommands.deliveryState, 'pending')));
      });
      return true;
    } catch (error) {
      await this.#recordDeliveryFailure(tenantId, commandId, safeMessage(error));
      return false;
    }
  }

  async #deliver(tenantId: string, command: WorkflowCommand): Promise<void> {
    if (!this.gateway) return;
    const instance = await this.#getInstance(tenantId, command.workflowInstanceId);
    if (instance.executionStatus === 'starting') {
      const status = await this.ensureStarted(tenantId, instance.id);
      if (status === 'starting') return;
    }
    try {
      // The activity marks the command applied/failed/superseded; the
      // returned outcome is not needed here because getCommand re-reads it.
      await this.gateway.submitCommand(instance.temporalWorkflowId!, { commandId: command.id }, this.settings.decisionWaitMs);
    } catch (error) {
      // Saved but not confirmed: the reconciler will deliver it.
      await this.#recordDeliveryFailure(tenantId, command.id, safeMessage(error), false);
    }
  }

  async #recordDeliveryFailure(tenantId: string, commandId: string, detail: string, countAttempt = true): Promise<void> {
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.update(workflowCommands).set({
        errorDetail: `Delivery pending: ${detail}`.slice(0, 500),
        ...(countAttempt ? {
          deliveryAttempts: sql`${workflowCommands.deliveryAttempts} + 1`,
          nextDeliveryAt: sql`now() + make_interval(secs => least(300, power(2, ${workflowCommands.deliveryAttempts} + 1)))`,
        } : {}),
      }).where(and(eq(workflowCommands.id, commandId as Uuid), eq(workflowCommands.deliveryState, 'pending')));
    });
  }

  async #findByIdempotencyKey(tx: TenantScopedDb, tenantId: string, key: string): Promise<WorkflowCommand | null> {
    const rows = await tx.select().from(workflowCommands).where(and(
      eq(workflowCommands.tenantId, tenantId as Uuid),
      eq(workflowCommands.idempotencyKey, key),
    )).limit(1);
    return rows[0] ?? null;
  }

  async #getInstance(tenantId: string, workflowInstanceId: string) {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(workflowInstances).where(and(
        eq(workflowInstances.id, workflowInstanceId as Uuid),
        eq(workflowInstances.tenantId, tenantId as Uuid),
      )).limit(1),
    );
    if (!rows[0]) throw new NotFoundError('WorkflowInstance', workflowInstanceId);
    return rows[0];
  }

  async #stepConfiguration(tenantId: string, versionId: string, stepKey: string): Promise<Record<string, unknown>> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ configuration: workflowSteps.configuration }).from(workflowSteps).where(and(
        eq(workflowSteps.workflowDefinitionVersionId, versionId as Uuid),
        eq(workflowSteps.stepKey, stepKey),
      )).limit(1),
    );
    return rows[0]?.configuration ?? {};
  }

  #reviewInput(
    tenantId: string,
    workflowInstanceId: string,
    known: { workflowTaskId: string; dueAt: string | null; escalateToRoleCode: string | null },
  ): ReviewWorkflowInput {
    return {
      contractVersion: REVIEW_EXECUTION_CONTRACT_VERSION,
      tenantId,
      workflowInstanceId,
      workflowTaskId: known.workflowTaskId,
      dueAt: known.dueAt,
      escalateToRoleCode: known.escalateToRoleCode,
    };
  }

  async #reviewInputFromDb(tenantId: string, workflowInstanceId: string): Promise<ReviewWorkflowInput> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(workflowTasks).where(and(
        eq(workflowTasks.workflowInstanceId, workflowInstanceId as Uuid),
        eq(workflowTasks.tenantId, tenantId as Uuid),
      )).orderBy(workflowTasks.createdAt).limit(1),
    );
    const task = rows[0];
    if (!task) throw new NotFoundError('WorkflowTask', `for instance ${workflowInstanceId}`);
    const escalation = task.payload['workflowEscalation'] as { escalateToRoleCode?: string | null } | undefined;
    return this.#reviewInput(tenantId, workflowInstanceId, {
      workflowTaskId: task.id,
      dueAt: task.dueAt?.toISOString() ?? null,
      escalateToRoleCode: escalation?.escalateToRoleCode ?? null,
    });
  }
}

export function toReceipt(row: WorkflowCommand): CommandReceipt {
  const status: CommandStatus = row.deliveryState === 'applied' || row.deliveryState === 'failed' || row.deliveryState === 'superseded'
    ? row.deliveryState
    : 'pending';
  return {
    commandId: row.id,
    workflowInstanceId: row.workflowInstanceId,
    workflowTaskId: row.workflowTaskId,
    commandType: row.commandType,
    decisionCode: row.decisionCode,
    status,
    acceptedAt: row.acceptedAt,
    appliedAt: row.appliedAt,
    result: row.result,
    errorCode: row.errorCode,
    errorDetail: row.errorDetail,
  };
}

function hashPayload(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

/** drizzle's execute() returns rows directly or as { rows } depending on driver. */
export function firstRow<T>(result: unknown): T | undefined {
  const r = result as { rows?: T[] } | T[];
  return Array.isArray(r) ? r[0] : r.rows?.[0];
}
