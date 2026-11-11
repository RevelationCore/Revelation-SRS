import { fileURLToPath } from 'node:url';

import { NativeConnection, Worker } from '@temporalio/worker';

import type { WorkflowAuditWriter } from './activities/audit.activities.js';
import type { ReviewActivities } from './contracts/review.js';

/** Every activity a workflow in this package can call. */
export type SrsWorkerActivities = ReviewActivities & WorkflowAuditWriter;

const REQUIRED_ACTIVITIES: Array<keyof SrsWorkerActivities> = [
  'applyReviewCommand',
  'escalateReviewTask',
  'recordWorkflowEvent',
];

/** Path of the workflow module the worker bundles. */
export function workflowsPath(): string {
  // Resolves to src/workflows/index.ts when run from source (tsx/vitest)
  // and dist/workflows/index.js when run from the build.
  const here = fileURLToPath(import.meta.url);
  return here.endsWith('.ts')
    ? fileURLToPath(new URL('./workflows/index.ts', import.meta.url))
    : fileURLToPath(new URL('./workflows/index.js', import.meta.url));
}

export interface CreateSrsWorkerOptions {
  connection: NativeConnection;
  namespace: string;
  taskQueue: string;
  activities: SrsWorkerActivities;
  /** Identifies this worker build in Temporal history and diagnostics. */
  identity?: string;
}

/**
 * Create a worker for the SRS task queue. Fails at startup, not at first
 * use, if any activity implementation is missing.
 */
export async function createSrsWorker(options: CreateSrsWorkerOptions): Promise<Worker> {
  const missing = REQUIRED_ACTIVITIES.filter((name) => typeof options.activities[name] !== 'function');
  if (missing.length > 0) {
    throw new Error(`Temporal worker is missing activity implementations: ${missing.join(', ')}`);
  }

  return Worker.create({
    connection: options.connection,
    namespace: options.namespace,
    taskQueue: options.taskQueue,
    workflowsPath: workflowsPath(),
    activities: options.activities,
    ...(options.identity ? { identity: options.identity } : {}),
  });
}

export async function connectWorker(address: string): Promise<NativeConnection> {
  return NativeConnection.connect({ address });
}
