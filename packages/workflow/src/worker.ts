import { NativeConnection, Worker } from '@temporalio/worker';

import { auditActivities } from './activities/audit.activities.js';

/**
 * Temporal worker entry point.
 *
 * Each SRS service (apps/api, modules/wellbeing) starts its own worker
 * pointing at the appropriate task queue for its Temporal namespace.
 *
 * The namespace is per-tenant: srs-{tenantId}.
 * For the platform worker (platform health, provisioning) use the
 * srs-platform namespace.
 */
export async function startWorker(options: {
  temporalAddress: string;
  namespace:        string;
  taskQueue:        string;
}): Promise<Worker> {
  const connection = await NativeConnection.connect({
    address: options.temporalAddress,
  });

  const worker = await Worker.create({
    workflowsPath: new URL('./workflows/index.js', import.meta.url).pathname,
    activities:    { ...auditActivities },
    taskQueue:     options.taskQueue,
    namespace:     options.namespace,
    connection,
  });

  return worker;
}

// When run directly, start a platform-level worker
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const address   = process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233';
  const namespace = process.env['TEMPORAL_NAMESPACE'] ?? 'srs-platform';
  const taskQueue = process.env['TEMPORAL_TASK_QUEUE'] ?? 'srs-platform';

  const worker = await startWorker({ temporalAddress: address, namespace, taskQueue });
  await worker.run();
}
