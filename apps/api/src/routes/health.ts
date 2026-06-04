import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

/**
 * Health and readiness endpoints.
 *
 * GET /health  — Liveness: is the process alive?
 * GET /ready   — Readiness: can it serve traffic?
 *
 * These routes skip JWT authentication (no preValidation hooks applied).
 * Container orchestrators (Docker Compose healthcheck, Kubernetes probes)
 * call these without credentials.
 *
 * See docs/architecture/deployment-architecture.md §Health and Readiness.
 */
export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
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
      const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

      // Database check
      try {
        const t0 = Date.now();
        await fastify.db.execute(sql`SELECT 1`);
        checks['database'] = { status: 'ok', latencyMs: Date.now() - t0 };
      } catch (err) {
        checks['database'] = { status: 'error', error: String(err) };
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
}
