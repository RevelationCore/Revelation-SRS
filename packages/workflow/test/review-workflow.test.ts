import { randomUUID } from 'node:crypto';

import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  REVIEW_EXECUTION_CONTRACT_VERSION,
  REVIEW_WORKFLOW_TYPE,
  type ApplyReviewCommandInput,
  type EscalateReviewTaskInput,
  type EscalateReviewTaskResult,
  type ReviewCommandOutcome,
  type ReviewWorkflowInput,
  type ReviewWorkflowState,
} from '../src/contracts/review.js';
import { signalReviewCommand, submitReviewCommand, queryReviewState } from '../src/client.js';
import { workflowsPath } from '../src/worker.js';

/**
 * In-memory stand-in for the database-backed activities. `outcomes` decides
 * what applying each command does; anything not listed is applied and closes
 * the review as completed.
 */
class FakeReviewActivities {
  applied: string[] = [];
  escalations: EscalateReviewTaskInput[] = [];
  outcomes = new Map<string, Partial<ReviewCommandOutcome>>();
  escalationResult: EscalateReviewTaskResult | ((input: EscalateReviewTaskInput) => EscalateReviewTaskResult) = { outcome: 'escalated' };

  activities() {
    return {
      applyReviewCommand: (input: ApplyReviewCommandInput): Promise<ReviewCommandOutcome> => {
        this.applied.push(input.commandId);
        const configured = this.outcomes.get(input.commandId) ?? {};
        return Promise.resolve({
          commandId: input.commandId,
          outcome: 'applied',
          commandType: 'decision',
          decisionCode: 'approved',
          instanceClosed: true,
          closedAs: 'completed',
          ...configured,
        });
      },
      escalateReviewTask: (input: EscalateReviewTaskInput): Promise<EscalateReviewTaskResult> => {
        this.escalations.push(input);
        return Promise.resolve(typeof this.escalationResult === 'function' ? this.escalationResult(input) : this.escalationResult);
      },
      recordWorkflowEvent: (): Promise<void> => Promise.resolve(),
    };
  }
}

let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
}, 120_000);

afterAll(async () => {
  await env?.teardown();
});

function reviewInput(overrides: Partial<ReviewWorkflowInput> = {}): ReviewWorkflowInput {
  return {
    contractVersion: REVIEW_EXECUTION_CONTRACT_VERSION,
    tenantId: '00000000-0000-0000-0000-000000000001',
    workflowInstanceId: randomUUID(),
    workflowTaskId: randomUUID(),
    ...overrides,
  };
}

async function withWorker<T>(fake: FakeReviewActivities, fn: (taskQueue: string) => Promise<T>): Promise<T> {
  const taskQueue = `test-${randomUUID()}`;
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowsPath: workflowsPath(),
    activities: fake.activities(),
  });
  return worker.runUntil(fn(taskQueue));
}

async function start(taskQueue: string, input: ReviewWorkflowInput) {
  const workflowId = `test:${input.workflowInstanceId}`;
  const handle = await env.client.workflow.start(REVIEW_WORKFLOW_TYPE, {
    taskQueue, workflowId, args: [input],
  });
  return { handle, workflowId };
}

describe('reviewWorkflow', () => {
  it('applies a decision delivered by Update and completes with the real outcome', async () => {
    const fake = new FakeReviewActivities();
    fake.outcomes.set('cmd-reject', { decisionCode: 'rejected' });

    await withWorker(fake, async (taskQueue) => {
      const { handle, workflowId } = await start(taskQueue, reviewInput());
      const outcome = await submitReviewCommand(env.client, workflowId, { commandId: 'cmd-reject' });
      expect(outcome).toMatchObject({ outcome: 'applied', decisionCode: 'rejected', instanceClosed: true });
      const final = await handle.result() as ReviewWorkflowState;
      expect(final.phase).toBe('completed');
      expect(fake.applied).toEqual(['cmd-reject']);
    });
  });

  it('applies a command once even when delivered by both Signal and Update', async () => {
    const fake = new FakeReviewActivities();
    await withWorker(fake, async (taskQueue) => {
      const { handle, workflowId } = await start(taskQueue, reviewInput());
      await signalReviewCommand(env.client, workflowId, { commandId: 'cmd-1' });
      await signalReviewCommand(env.client, workflowId, { commandId: 'cmd-1' });
      await handle.result();
      expect(fake.applied).toEqual(['cmd-1']);
    });
  });

  it('escalates at the deadline, keeps waiting, then accepts the escalation role\'s decision', async () => {
    const fake = new FakeReviewActivities();
    await withWorker(fake, async (taskQueue) => {
      const dueAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
      const { handle, workflowId } = await start(taskQueue, reviewInput({ dueAt, escalateToRoleCode: 'head-of-registry' }));

      await env.sleep('3 days');
      expect(fake.escalations).toHaveLength(1);
      expect(fake.escalations[0]!.escalateToRoleCode).toBe('head-of-registry');
      const waiting = await queryReviewState(env.client, workflowId);
      expect(waiting).toMatchObject({ phase: 'awaiting-decision', escalated: true });

      await submitReviewCommand(env.client, workflowId, { commandId: 'cmd-late' });
      const final = await handle.result() as ReviewWorkflowState;
      expect(final.phase).toBe('completed');
      expect(fake.escalations).toHaveLength(1);
    });
  });

  it('flags needs-attention when there is no escalation role, and never auto-completes', async () => {
    const fake = new FakeReviewActivities();
    fake.escalationResult = { outcome: 'needs-attention' };
    await withWorker(fake, async (taskQueue) => {
      const dueAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const { handle, workflowId } = await start(taskQueue, reviewInput({ dueAt }));

      await env.sleep('30 days');
      const waiting = await queryReviewState(env.client, workflowId);
      expect(waiting).toMatchObject({ phase: 'needs-attention', escalated: true });
      expect(fake.applied).toEqual([]);

      await submitReviewCommand(env.client, workflowId, { commandId: 'cmd-operator' });
      expect((await handle.result() as ReviewWorkflowState).phase).toBe('completed');
    });
  });

  it('escalates immediately when the deadline has already passed', async () => {
    const fake = new FakeReviewActivities();
    await withWorker(fake, async (taskQueue) => {
      const dueAt = new Date(Date.now() - 60 * 1000).toISOString();
      const { workflowId } = await start(taskQueue, reviewInput({ dueAt, escalateToRoleCode: 'registry' }));
      // A query round-trip lets the first workflow task run.
      await queryReviewState(env.client, workflowId);
      await env.sleep('1 second');
      expect(fake.escalations).toHaveLength(1);
    });
  });

  it('applies a decision accepted before the deadline instead of escalating', async () => {
    const fake = new FakeReviewActivities();
    fake.escalationResult = { outcome: 'decision-pending', pendingCommandId: 'cmd-on-time' };
    await withWorker(fake, async (taskQueue) => {
      const dueAt = new Date(Date.now() + 60 * 1000).toISOString();
      const { handle } = await start(taskQueue, reviewInput({ dueAt, escalateToRoleCode: 'registry' }));
      const final = await handle.result() as ReviewWorkflowState;
      expect(final.phase).toBe('completed');
      expect(fake.applied).toEqual(['cmd-on-time']);
      expect(final.escalated).toBe(false);
    });
  });

  it('stays open when a decision\'s business change fails, and accepts a later decision', async () => {
    const fake = new FakeReviewActivities();
    fake.outcomes.set('cmd-fails', {
      outcome: 'failed', instanceClosed: false, errorCode: 'conflict', errorDetail: 'Capacity reached',
    });
    await withWorker(fake, async (taskQueue) => {
      const { handle, workflowId } = await start(taskQueue, reviewInput());
      const failed = await submitReviewCommand(env.client, workflowId, { commandId: 'cmd-fails' });
      expect(failed).toMatchObject({ outcome: 'failed', instanceClosed: false, errorCode: 'conflict' });
      expect((await queryReviewState(env.client, workflowId)).phase).toBe('awaiting-decision');

      await submitReviewCommand(env.client, workflowId, { commandId: 'cmd-retry' });
      expect((await handle.result() as ReviewWorkflowState).phase).toBe('completed');
      expect(fake.applied).toEqual(['cmd-fails', 'cmd-retry']);
    });
  });

  it('closes as cancelled when a cancellation command is applied', async () => {
    const fake = new FakeReviewActivities();
    fake.outcomes.set('cmd-cancel', { commandType: 'cancellation', decisionCode: null, closedAs: 'cancelled' });
    await withWorker(fake, async (taskQueue) => {
      const { handle, workflowId } = await start(taskQueue, reviewInput());
      await submitReviewCommand(env.client, workflowId, { commandId: 'cmd-cancel' });
      expect((await handle.result() as ReviewWorkflowState).phase).toBe('cancelled');
    });
  });

  it('replays its own history deterministically', async () => {
    const fake = new FakeReviewActivities();
    const history = await withWorker(fake, async (taskQueue) => {
      const dueAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const { handle, workflowId } = await start(taskQueue, reviewInput({ dueAt, escalateToRoleCode: 'registry' }));
      await env.sleep('2 hours');
      await submitReviewCommand(env.client, workflowId, { commandId: 'cmd-replay' });
      await handle.result();
      return handle.fetchHistory();
    });
    await Worker.runReplayHistory({ workflowsPath: workflowsPath() }, history);
  });
});
