import {
  Client,
  Connection,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  type WorkflowHandle,
} from '@temporalio/client';

import {
  REVIEW_COMMAND_SIGNAL,
  REVIEW_COMMAND_UPDATE,
  REVIEW_STATE_QUERY,
  REVIEW_WORKFLOW_TYPE,
  type ReviewCommandOutcome,
  type ReviewCommandRef,
  type ReviewWorkflowInput,
  type ReviewWorkflowState,
} from './contracts/review.js';

export interface WorkflowClientOptions {
  temporalAddress: string;
  namespace: string;
}

export async function createWorkflowClient(options: WorkflowClientOptions): Promise<Client> {
  const connection = await Connection.connect({ address: options.temporalAddress });
  return new Client({ connection, namespace: options.namespace });
}

/**
 * Start (or find) a review execution. The stable workflow ID plus
 * USE_EXISTING makes a repeated start return the running execution, and
 * REJECT_DUPLICATE stops a closed review from being started again.
 */
export async function startReviewWorkflow(
  client: Client,
  options: { taskQueue: string; workflowId: string; input: ReviewWorkflowInput },
): Promise<{ runId: string }> {
  const handle = await client.workflow.start(REVIEW_WORKFLOW_TYPE, {
    taskQueue: options.taskQueue,
    workflowId: options.workflowId,
    workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
    workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
    args: [options.input],
  });
  return { runId: handle.firstExecutionRunId };
}

export function reviewHandle(client: Client, workflowId: string): WorkflowHandle {
  return client.workflow.getHandle(workflowId);
}

/** Deliver a command and wait for the workflow to apply it. */
export async function submitReviewCommand(
  client: Client,
  workflowId: string,
  ref: ReviewCommandRef,
): Promise<ReviewCommandOutcome> {
  return reviewHandle(client, workflowId).executeUpdate<ReviewCommandOutcome, [ReviewCommandRef]>(
    REVIEW_COMMAND_UPDATE,
    { args: [ref] },
  );
}

/** Deliver a command without waiting (used by the reconciler). */
export async function signalReviewCommand(
  client: Client,
  workflowId: string,
  ref: ReviewCommandRef,
): Promise<void> {
  await reviewHandle(client, workflowId).signal<[ReviewCommandRef]>(REVIEW_COMMAND_SIGNAL, ref);
}

/** Start-if-needed and deliver in one call (used when the start may not have happened yet). */
export async function signalWithStartReview(
  client: Client,
  options: { taskQueue: string; workflowId: string; input: ReviewWorkflowInput; ref: ReviewCommandRef },
): Promise<{ runId: string }> {
  const handle = await client.workflow.signalWithStart(REVIEW_WORKFLOW_TYPE, {
    taskQueue: options.taskQueue,
    workflowId: options.workflowId,
    workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
    workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
    args: [options.input],
    signal: REVIEW_COMMAND_SIGNAL,
    signalArgs: [options.ref],
  });
  return { runId: handle.signaledRunId };
}

export async function queryReviewState(client: Client, workflowId: string): Promise<ReviewWorkflowState> {
  return reviewHandle(client, workflowId).query<ReviewWorkflowState>(REVIEW_STATE_QUERY);
}
