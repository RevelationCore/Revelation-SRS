// OTel must be bootstrapped before any other import so instrumentation patches load first.
import './telemetry.js';

import { createServer, type Server } from 'node:http';
import { hostname } from 'node:os';

import { connectWorker, createSrsWorker } from '@revelation-srs/workflow';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';

/**
 * Temporal worker for Revelation SRS (ADR-024).
 *
 * Runs the review workflows and their database-backed activities, and the
 * reconciler that starts saved reviews, re-delivers saved decisions and
 * publishes saved workflow events. It builds the same service graph as the
 * API (so activities use the same domain services and rules) but does not
 * serve HTTP requests, apart from a small health endpoint.
 *
 * Environment: the API's variables, plus
 *   WORKER_HEALTH_PORT        (default 9466)
 *   RECONCILE_INTERVAL_MS     (default 15000; 0 disables the reconciler)
 */

const config = loadConfig();
const namespace = config.temporalNamespace ?? 'srs-local';
const taskQueue = config.temporalTaskQueue ?? 'srs-workflows';
const reconcileIntervalMs = Number(process.env['RECONCILE_INTERVAL_MS'] ?? 15_000);
const healthPort = Number(process.env['WORKER_HEALTH_PORT'] ?? 9466);
const identity = `srs-worker@${hostname()}:${config.releaseVersion}`;

const app = await buildApp({ ...config, otelServiceName: `${config.otelServiceName}-worker` });
await app.ready();

try {
  await app.eventBus.connect();
  app.log.info('NATS JetStream connected');
} catch (err) {
  app.log.warn({ err }, 'NATS connection failed - workflow events stay in the outbox until resolved');
}

const connection = await connectWorker(config.temporalAddress);
const worker = await createSrsWorker({
  connection,
  namespace,
  taskQueue,
  identity,
  activities: app.reviewActivitiesService.activities(),
});
app.log.info({ namespace, taskQueue, identity }, 'Temporal worker created');

let lastReconcile: { at: string; ok: boolean; result?: unknown; error?: string } | null = null;
let reconciling = false;
const reconcile = async (): Promise<void> => {
  if (reconciling) return;
  reconciling = true;
  try {
    const result = await app.workflowReconciler.runOnce();
    lastReconcile = { at: new Date().toISOString(), ok: true, result };
  } catch (err) {
    lastReconcile = { at: new Date().toISOString(), ok: false, error: err instanceof Error ? err.message : String(err) };
    app.log.error({ err }, 'Workflow reconciliation failed');
  } finally {
    reconciling = false;
  }
};
const reconcileTimer = reconcileIntervalMs > 0 ? setInterval(() => void reconcile(), reconcileIntervalMs) : null;

// Readiness means the worker is polling its queue, not just that a port is open.
const health: Server = createServer((req, res) => {
  const state = worker.getState();
  const ready = state === 'RUNNING';
  res.writeHead(req.url === '/ready' && !ready ? 503 : 200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ state, namespace, taskQueue, identity, lastReconcile }));
});
health.listen(healthPort, '0.0.0.0');

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'Draining Temporal worker');
  if (reconcileTimer) clearInterval(reconcileTimer);
  // Stops polling and waits for in-flight activities, up to the SDK's grace time.
  worker.shutdown();
}
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => shutdown(signal));
}

try {
  await worker.run();
} finally {
  health.close();
  await connection.close();
  await app.close();
  await app.eventBus.close();
  app.log.info('Temporal worker stopped');
}
