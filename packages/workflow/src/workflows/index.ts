import {
  allHandlersFinished,
  condition,
  defineQuery,
  defineSignal,
  defineUpdate,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow';

import type { auditActivities } from '../activities/audit.activities.js';
import {
  REVIEW_COMMAND_SIGNAL,
  REVIEW_COMMAND_UPDATE,
  REVIEW_STATE_QUERY,
  type ReviewActivities,
  type ReviewCommandOutcome,
  type ReviewCommandRef,
  type ReviewWorkflowInput,
  type ReviewWorkflowState,
} from '../contracts/review.js';

const activities = proxyActivities<typeof auditActivities>({
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

// ── Single-review workflow (execution contract v1) ──────────────────────────

/**
 * Review activities retry until they succeed. They are idempotent: each
 * command and escalation is applied under a database receipt, so a retry
 * after a worker crash returns the first result. Business-rule failures are
 * returned as an outcome, not thrown, so they never retry forever.
 */
const review = proxyActivities<ReviewActivities>({
  startToCloseTimeout: '30 seconds',
  retry: {
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumInterval: '1 minute',
  },
});

export const reviewCommandSignal = defineSignal<[ReviewCommandRef]>(REVIEW_COMMAND_SIGNAL);
export const submitReviewCommandUpdate = defineUpdate<ReviewCommandOutcome, [ReviewCommandRef]>(REVIEW_COMMAND_UPDATE);
export const reviewStateQuery = defineQuery<ReviewWorkflowState>(REVIEW_STATE_QUERY);

/**
 * Waits for a decision on one review task, enforces its deadline and applies
 * accepted commands one at a time.
 *
 * - Commands arrive by Update (normal path: the API waits for the outcome)
 *   or by Signal (reconciler re-delivery). Both feed one queue, de-duplicated
 *   by command ID, so a command is applied once however often it arrives.
 * - The deadline is the persisted `dueAt`. If it has already passed when the
 *   workflow starts or resumes, escalation happens immediately.
 * - After escalating, the workflow keeps waiting so the escalation role (or
 *   an operator, if there is none) can decide. Nothing is auto-approved.
 * - A decision accepted on or before the deadline wins over the timer: the
 *   escalation activity reports it as pending and it is applied first.
 */
export async function reviewWorkflow(input: ReviewWorkflowInput): Promise<ReviewWorkflowState> {
  const state: ReviewWorkflowState = {
    workflowInstanceId: input.workflowInstanceId,
    workflowTaskId: input.workflowTaskId,
    phase: 'awaiting-decision',
    escalated: false,
    dueAt: input.dueAt ?? null,
    processedCommandIds: [],
  };

  const queue: string[] = [];
  const seen = new Set<string>();
  const outcomes = new Map<string, ReviewCommandOutcome>();
  let closed = false;

  const enqueue = (commandId: string): void => {
    if (seen.has(commandId)) return;
    seen.add(commandId);
    queue.push(commandId);
  };

  setHandler(reviewCommandSignal, ({ commandId }) => enqueue(commandId));
  setHandler(submitReviewCommandUpdate, async ({ commandId }) => {
    enqueue(commandId);
    await condition(() => outcomes.has(commandId));
    return outcomes.get(commandId)!;
  }, {
    validator: ({ commandId }) => {
      if (typeof commandId !== 'string' || commandId.length === 0) throw new Error('commandId is required');
      if (closed && !outcomes.has(commandId)) throw new Error('This review is already closed');
    },
  });
  setHandler(reviewStateQuery, () => state);

  const deadlineMs = input.dueAt ? Date.parse(input.dueAt) : null;
  let escalationDone = false;

  while (!closed) {
    if (deadlineMs !== null && !escalationDone) {
      const remaining = deadlineMs - Date.now();
      const hasCommand = remaining > 0
        ? await condition(() => queue.length > 0, remaining)
        : queue.length > 0;

      if (!hasCommand) {
        const escalation = await review.escalateReviewTask({
          tenantId: input.tenantId,
          workflowInstanceId: input.workflowInstanceId,
          workflowTaskId: input.workflowTaskId,
          ...(input.escalateToRoleCode ? { escalateToRoleCode: input.escalateToRoleCode } : {}),
        });
        if (escalation.outcome === 'decision-pending' && escalation.pendingCommandId) {
          enqueue(escalation.pendingCommandId);
          continue;
        }
        escalationDone = true;
        if (escalation.outcome === 'escalated') {
          state.escalated = true;
        } else if (escalation.outcome === 'needs-attention') {
          state.escalated = true;
          state.phase = 'needs-attention';
        }
        continue;
      }
    } else {
      await condition(() => queue.length > 0);
    }

    const commandId = queue.shift()!;
    const resumePhase = state.phase === 'needs-attention' ? 'needs-attention' : 'awaiting-decision';
    state.phase = 'applying';
    const outcome = await review.applyReviewCommand({
      tenantId: input.tenantId,
      workflowInstanceId: input.workflowInstanceId,
      commandId,
    });
    outcomes.set(commandId, outcome);
    state.processedCommandIds.push(commandId);

    if (outcome.instanceClosed) {
      closed = true;
      state.phase = outcome.closedAs === 'cancelled' ? 'cancelled' : 'completed';
    } else {
      state.phase = resumePhase;
    }
  }

  // Let in-flight update handlers return their outcome before completing.
  await condition(allHandlersFinished);
  return state;
}
