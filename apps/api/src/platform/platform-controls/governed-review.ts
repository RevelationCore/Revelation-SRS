import { createHash } from 'node:crypto';

import type { WorkflowInstance } from '@revelation-srs/db';
import { ConflictError } from '@revelation-srs/domain';

import { clockNow } from '../clock.js';

import type { ReviewActivitiesService } from './review-activities.js';
import type { ReviewExecutionService } from './review-execution-service.js';
import type { WorkflowBridgeService } from './workflow-bridge-service.js';

/** A UUID-shaped value derived from a stable key (same key, same UUID). */
export function deterministicUuid(key: string): string {
  const h = createHash('sha256').update(key).digest('hex');
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export interface GovernedReviewSpec {
  workflowCode: string;
  stepKey: string;
  gatewayKey: string;
  /** Recorded as the decision's outcome step on the legacy bridge. */
  outcomeStepKey: string;
  assigneeRoleCode: string;
  subjectEntityType: string;
  /** Decisions that change business state; others only close the review. */
  effectDecisionCodes: string[];
}

export interface ReviewEffectInput {
  tenantId: string;
  workflowInstanceId: string;
  context: Record<string, unknown>;
  decisionCode: string;
  actorId: string;
  reason?: string;
  /**
   * Stable for one decision: the command ID on Temporal, the instance ID on
   * the legacy bridge. Derive any created record's ID from it, so a retried
   * effect finds what it already made.
   */
  operationKey: string;
}

/**
 * Applies the business change for a decision. Must be idempotent for the
 * same operationKey. Throw ValidationError, ConflictError or NotFoundError
 * when a business rule prevents the change: the decision is kept and the
 * review stays open.
 */
export type ReviewEffect = (input: ReviewEffectInput) => Promise<Record<string, unknown>>;

export interface StartedReview {
  workflowInstanceId: string;
  workflowTaskId: string;
  statusCode: 'running';
  context: Record<string, unknown>;
  startedAt: Date;
}

export type ReviewDecisionResult =
  | { status: 'applied'; result: Record<string, unknown>; commandId?: string }
  | { status: 'pending'; result: null; commandId: string };

/**
 * One approval review whose decision changes a business record (ADR-024
 * Stage 6a). Starts on Temporal when the tenant's rollout selects it, and
 * otherwise on the legacy bridge. Each instance keeps the backend it started on.
 *
 * Both backends apply the business change before the review closes. A
 * change that fails leaves the review open and the decision can be made again.
 */
export class GovernedReview {
  constructor(
    private readonly bridge: WorkflowBridgeService,
    private readonly reviewExecution: ReviewExecutionService | undefined,
    private readonly spec: GovernedReviewSpec,
  ) {}

  get workflowCode(): string { return this.spec.workflowCode; }

  async start(tenantId: string, input: {
    workflowDefinitionVersionId: string;
    subjectEntityId?: string;
    startedBy: string;
    context: Record<string, unknown>;
    taskPayload?: Record<string, unknown>;
  }): Promise<StartedReview> {
    const payload = input.taskPayload ?? input.context;
    if (this.reviewExecution
      && (await this.reviewExecution.selectBackend(tenantId, { workflowDefinitionVersionId: input.workflowDefinitionVersionId })) === 'temporal') {
      const started = await this.reviewExecution.startReview({
        tenantId,
        workflowDefinitionVersionId: input.workflowDefinitionVersionId,
        workflowCode: this.spec.workflowCode,
        subjectEntityType: this.spec.subjectEntityType,
        ...(input.subjectEntityId ? { subjectEntityId: input.subjectEntityId } : {}),
        startedBy: input.startedBy,
        context: input.context,
        task: { stepKey: this.spec.stepKey, assigneeRoleCode: this.spec.assigneeRoleCode, payload },
      });
      return { workflowInstanceId: started.workflowInstanceId, workflowTaskId: started.workflowTaskId, statusCode: 'running', context: input.context, startedAt: clockNow() };
    }

    const instance = await this.bridge.startWorkflowInstance({
      tenantId,
      workflowDefinitionVersionId: input.workflowDefinitionVersionId,
      workflowCode: this.spec.workflowCode,
      subjectEntityType: this.spec.subjectEntityType,
      ...(input.subjectEntityId ? { subjectEntityId: input.subjectEntityId } : {}),
      startedBy: input.startedBy,
      context: input.context,
    });
    const task = await this.bridge.assignWorkflowTask({
      tenantId,
      workflowInstanceId: instance.workflowInstanceId,
      stepKey: this.spec.stepKey,
      assigneeRoleCode: this.spec.assigneeRoleCode,
      payload,
    });
    return { workflowInstanceId: instance.workflowInstanceId, workflowTaskId: task.workflowTaskId, statusCode: 'running', context: input.context, startedAt: clockNow() };
  }

  /**
   * Decide a running review. `instance` must already be checked as this
   * review's, and running. `legacyTaskId` is the open decision task on the
   * legacy bridge, if any.
   */
  async decide(tenantId: string, input: {
    instance: WorkflowInstance;
    legacyTaskId: string | null;
    decisionCode: string;
    actorId: string;
    reason?: string;
    effect: ReviewEffect;
    metadata?: Record<string, unknown>;
  }): Promise<ReviewDecisionResult> {
    const { instance, decisionCode, actorId, reason } = input;

    if (instance.executionBackend === 'temporal') {
      if (!this.reviewExecution) throw new Error('Temporal execution is not configured');
      const workflowTaskId = await this.reviewExecution.findOpenTaskId(tenantId, instance.id);
      if (!workflowTaskId) throw new ConflictError('This request is already closed');
      const receipt = await this.reviewExecution.submitCommand({
        tenantId, workflowTaskId, actorId, commandType: 'decision', decisionCode,
        payload: reason ? { note: reason } : {},
      });
      if (receipt.status === 'failed') {
        throw new ConflictError(
          `Decision recorded, but the change was not applied: ${receipt.errorDetail ?? 'unknown reason'}. `
          + 'The request is still open and can be decided again.',
        );
      }
      if (receipt.status === 'superseded') {
        throw new ConflictError('This request was updated before the decision could be applied. Reload and try again.');
      }
      if (receipt.status === 'pending') return { status: 'pending', result: null, commandId: receipt.commandId };
      const outcome = receipt.result['outcome'] as { result?: Record<string, unknown> } | undefined;
      return { status: 'applied', result: outcome?.result ?? {}, commandId: receipt.commandId };
    }

    // Legacy bridge: apply first, so a failed change leaves the review open.
    const result = this.spec.effectDecisionCodes.includes(decisionCode)
      ? await input.effect({
        tenantId, workflowInstanceId: instance.id, context: instance.context, decisionCode, actorId,
        ...(reason ? { reason } : {}), operationKey: instance.id,
      })
      : {};

    await this.bridge.recordWorkflowDecision({
      tenantId,
      workflowInstanceId: instance.id,
      gatewayKey: this.spec.gatewayKey,
      decisionCode,
      ...(reason ? { conditionSummary: reason } : {}),
      outcomeStepKey: this.spec.outcomeStepKey,
      actorId,
      metadata: input.metadata ?? { context: instance.context },
    });
    if (input.legacyTaskId) {
      await this.bridge.completeWorkflowTask({
        tenantId, workflowTaskId: input.legacyTaskId, completedBy: actorId,
        payload: { decisionCode, ...(reason ? { reason } : {}) },
      });
    }
    await this.bridge.completeWorkflowInstance({
      tenantId, workflowInstanceId: instance.id, actorId, statusCode: 'completed', metadata: { decisionCode },
    });
    return { status: 'applied', result };
  }

  /** Register the effect the worker applies for Temporal-run decisions. */
  register(activities: ReviewActivitiesService, effect: ReviewEffect): void {
    activities.registerEffect(this.spec.workflowCode, {
      decisionCodes: this.spec.effectDecisionCodes,
      apply: ({ tenantId, commandId, instance, command }) => {
        const note = command.payload['note'];
        return effect({
          tenantId,
          workflowInstanceId: instance.id,
          context: instance.context,
          decisionCode: command.decisionCode ?? '',
          actorId: command.actorId,
          ...(typeof note === 'string' ? { reason: note } : {}),
          operationKey: commandId,
        });
      },
    });
  }
}
