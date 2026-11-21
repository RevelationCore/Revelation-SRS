import net from 'node:net';

import { fetchWithTimeout } from '@revelation-srs/auth';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

type CheckResult = { status: string; latencyMs?: number; error?: string; required?: boolean; detail?: unknown };

async function tcpCheck(address: string, defaultPort: number): Promise<CheckResult> {
  const t0 = Date.now();  // clock:allow — latency timing
  const url = address.includes('://') ? new URL(address) : new URL(`tcp://${address}`);
  const host = url.hostname || 'localhost';
  const port = Number(url.port || defaultPort);

  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve({ status: 'error', error: 'timeout' });
    }, 1_000);

    socket.once('connect', () => {
      clearTimeout(timeout);
      socket.end();
      resolve({ status: 'ok', latencyMs: Date.now() - t0 });  // clock:allow
    });

    socket.once('error', (err: Error) => {
      clearTimeout(timeout);
      resolve({ status: 'error', error: err.message });
    });
  });
}

async function jwksCheck(jwksUrl: string): Promise<CheckResult> {
  const t0 = Date.now();  // clock:allow — latency timing
  try {
    const res = await fetchWithTimeout(jwksUrl, {}, 1_500);
    return res.ok
      ? { status: 'ok', latencyMs: Date.now() - t0 }  // clock:allow
      : { status: 'error', error: `HTTP ${res.status}` };
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Health and readiness endpoints.
 *
 * GET /health  - Liveness: is the process alive?
 * GET /ready   - Readiness: can it serve traffic?
 *
 * These routes skip JWT authentication (no preValidation hooks applied).
 * Container orchestrators (Docker Compose healthcheck, Kubernetes probes)
 * call these without credentials.
 *
   * See docs/architecture/deployment-architecture.md, Health and Readiness.
 */
export function healthRoutes(fastify: FastifyInstance): void {
  fastify.get(
    '/health',
    { schema: { hide: true }, config: { skipAuth: true } },
    async (_req, reply) => {
      await reply.code(200).send({
        status:  'ok',
        version: process.env['npm_package_version'] ?? '0.0.1',
        uptime:  Math.floor(process.uptime()),
      });
    },
  );

  fastify.get(
    '/ready',
    { schema: { hide: true }, config: { skipAuth: true } },
    async (_req, reply) => {
      const checks: Record<string, CheckResult> = {};

      // Database check
      try {
        const t0 = Date.now();  // clock:allow — latency timing
        await fastify.db.execute(sql`SELECT 1`);
        checks['database'] = { status: 'ok', latencyMs: Date.now() - t0 };  // clock:allow
      } catch (err) {
        checks['database'] = { status: 'error', error: String(err) };
      }

      // Readiness depends on the database only (ADR-027, readiness 2.2). NATS
      // and Keycloak are reported but do not take the pod out of service: a
      // broker outage must not stop the API serving records (events are
      // published when it returns), and token keys are cached.
      checks['nats'] = {
        ...(fastify.eventBus.isConnected() ? { status: 'ok' as const } : { status: 'error' as const, error: 'not connected' }),
        required: false,
      };

      // Temporal is reported but does not gate readiness (ADR-024): during a
      // workflow outage the API must keep serving records and saving
      // decisions, which the reconciler delivers once Temporal is back. An
      // open port is not proof a worker is polling; the backlog numbers
      // below (and the worker's own /ready) are the meaningful signals.
      checks['temporal'] = {
        ...(await tcpCheck(fastify.config.temporalAddress, 7233)),
        required: false,
      };

      if (fastify.config.keycloakJwksUrl) {
        checks['keycloakJwks'] = { ...(await jwksCheck(fastify.config.keycloakJwksUrl)), required: false };
      }

      const allOk = Object.values(checks).every((c) => c.required === false || c.status === 'ok');

      await reply.code(allOk ? 200 : 503).send({
        status: allOk ? 'ok' : 'degraded',
        checks,
        version: process.env['npm_package_version'] ?? '0.0.1',
        uptime:  Math.floor(process.uptime()),
      });
    },
  );

  fastify.get(
    '/metrics',
    { schema: { hide: true }, config: { skipAuth: true } },
    async (_req, reply) => {
      const uptime = process.uptime();
      const memory = process.memoryUsage();

      await reply
        .type('text/plain; version=0.0.4')
        .send([
          '# HELP srs_api_uptime_seconds Process uptime in seconds.',
          '# TYPE srs_api_uptime_seconds gauge',
          `srs_api_uptime_seconds ${uptime}`,
          '# HELP srs_api_memory_rss_bytes Resident memory size in bytes.',
          '# TYPE srs_api_memory_rss_bytes gauge',
          `srs_api_memory_rss_bytes ${memory.rss}`,
          '# HELP srs_api_event_bus_connected Whether the API is connected to NATS JetStream.',
          '# TYPE srs_api_event_bus_connected gauge',
          `srs_api_event_bus_connected ${fastify.eventBus.isConnected() ? 1 : 0}`,
          '',
        ].join('\n'));
    },
  );
}
