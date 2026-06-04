import net from 'node:net';

import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

type CheckResult = { status: string; latencyMs?: number; error?: string };

async function tcpCheck(address: string, defaultPort: number): Promise<CheckResult> {
  const t0 = Date.now();
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
      resolve({ status: 'ok', latencyMs: Date.now() - t0 });
    });

    socket.once('error', (err) => {
      clearTimeout(timeout);
      resolve({ status: 'error', error: err.message });
    });
  });
}

async function jwksCheck(jwksUrl: string): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const res = await fetch(jwksUrl, { signal: AbortSignal.timeout(1_500) });
    return res.ok
      ? { status: 'ok', latencyMs: Date.now() - t0 }
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
    { config: { skipAuth: true } },
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
    { config: { skipAuth: true } },
    async (_req, reply) => {
      const checks: Record<string, CheckResult> = {};

      // Database check
      try {
        const t0 = Date.now();
        await fastify.db.execute(sql`SELECT 1`);
        checks['database'] = { status: 'ok', latencyMs: Date.now() - t0 };
      } catch (err) {
        checks['database'] = { status: 'error', error: String(err) };
      }

      checks['nats'] = fastify.eventBus.isConnected()
        ? { status: 'ok' }
        : { status: 'error', error: 'not connected' };

      checks['temporal'] = await tcpCheck(fastify.config.temporalAddress, 7233);

      if (fastify.config.keycloakJwksUrl) {
        checks['keycloakJwks'] = await jwksCheck(fastify.config.keycloakJwksUrl);
      }

      const allOk = Object.values(checks).every((c) => c.status === 'ok');

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
    { config: { skipAuth: true } },
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
