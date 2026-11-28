import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

export function healthRoutes(fastify: FastifyInstance): void {
  fastify.get(
    '/health',
    { config: { skipAuth: true }, schema: { tags: ['health'], summary: 'Liveness' } },
    async (_req, reply) => {
      await reply.code(200).send({
        status:  'ok',
        service: 'wellbeing',
        version: process.env['npm_package_version'] ?? '0.0.1',
        uptime:  Math.floor(process.uptime()),
      });
    },
  );

  fastify.get(
    '/ready',
    { config: { skipAuth: true }, schema: { tags: ['health'], summary: 'Readiness' } },
    async (_req, reply) => {
      const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

      try {
        const t0 = Date.now();
        await fastify.wellbeingDb.execute(sql`SELECT 1`);
        checks['database'] = { status: 'ok', latencyMs: Date.now() - t0 };
      } catch (err) {
        checks['database'] = { status: 'error', error: String(err) };
      }

      const allOk = Object.values(checks).every((c) => c.status === 'ok');

      await reply.code(allOk ? 200 : 503).send({
        status:  allOk ? 'ok' : 'degraded',
        service: 'wellbeing',
        checks,
        version: process.env['npm_package_version'] ?? '0.0.1',
        uptime:  Math.floor(process.uptime()),
      });
    },
  );
}
