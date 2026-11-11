/* eslint-disable no-console -- command-line script: progress goes to stdout */
/**
 * Worker smoke check (plan Stage 1): proves a worker is polling the
 * configured namespace and task queue and can run review workflow code.
 *
 *   pnpm --filter @revelation-srs/api workflow:smoke            # run and clean up
 *   pnpm --filter @revelation-srs/api workflow:smoke --keep     # leave it waiting
 *   pnpm --filter @revelation-srs/api workflow:smoke --check <workflowId>
 *
 * With --keep, restart the worker and then run --check to show the same
 * execution resumed on the new worker. The smoke workflow has no deadline
 * and no database rows, so it never calls an activity and changes nothing.
 */
import { randomUUID } from 'node:crypto';

import { Client, Connection } from '@temporalio/client';
import {
  REVIEW_EXECUTION_CONTRACT_VERSION,
  queryReviewState,
  startReviewWorkflow,
} from '@revelation-srs/workflow';

const address = process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233';
const namespace = process.env['TEMPORAL_NAMESPACE'] ?? 'srs-local';
const taskQueue = process.env['TEMPORAL_TASK_QUEUE'] ?? 'srs-workflows';
const args = process.argv.slice(2);

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const connection = await Connection.connect({ address, connectTimeout: '5 seconds' })
  .catch((error: unknown) => fail(`Cannot reach Temporal at ${address}: ${String(error)}`));
const client = new Client({ connection, namespace });

try {
  await connection.workflowService.describeNamespace({ namespace })
    .catch(() => fail(`Namespace '${namespace}' does not exist on ${address}`));
  console.log(`✓ Temporal reachable at ${address}, namespace '${namespace}' exists`);

  const queue = await connection.workflowService.describeTaskQueue({
    namespace,
    taskQueue: { name: taskQueue },
    taskQueueType: 1, // workflow task queue
  });
  const pollers = queue.pollers ?? [];
  if (pollers.length === 0) fail(`No worker is polling task queue '${taskQueue}'. Start one with: pnpm --filter @revelation-srs/api worker`);
  console.log(`✓ ${pollers.length} worker(s) polling '${taskQueue}': ${pollers.map((p) => p.identity).join(', ')}`);

  const checkIndex = args.indexOf('--check');
  const workflowId = checkIndex >= 0 ? args[checkIndex + 1] ?? fail('--check needs a workflow ID') : `srs:smoke:${randomUUID()}`;

  if (checkIndex < 0) {
    await startReviewWorkflow(client, {
      taskQueue,
      workflowId,
      input: {
        contractVersion: REVIEW_EXECUTION_CONTRACT_VERSION,
        tenantId: 'smoke',
        workflowInstanceId: randomUUID(),
        workflowTaskId: randomUUID(),
        dueAt: null,
        escalateToRoleCode: null,
      },
    });
    console.log(`✓ Started smoke review ${workflowId}`);
  }

  // A query needs a worker to run the workflow code, so an answer proves it.
  const state = await queryReviewState(client, workflowId);
  if (state.phase !== 'awaiting-decision') fail(`Unexpected phase '${state.phase}'`);
  console.log(`✓ Worker ran the workflow: phase '${state.phase}'`);

  if (args.includes('--keep')) {
    console.log(`Left running. Restart the worker, then run: workflow:smoke --check ${workflowId}`);
  } else {
    await client.workflow.getHandle(workflowId).terminate('smoke check complete');
    console.log('✓ Smoke review terminated');
  }
} finally {
  await connection.close();
}
