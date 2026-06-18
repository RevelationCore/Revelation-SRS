import type { FastifyInstance } from 'fastify';

/**
 * GET /api/v1/demo/status
 *
 * Public endpoint (no authentication required) that returns the currently-loaded
 * demo scenario and the demo clock's current time. Consumed by:
 *   - The demo site banner in apps/admin and apps/portal
 *   - pnpm demo:status CLI command
 *
 * Returns { active: false, ... } with null fields when no demo scenario is loaded
 * or when the API is not running against a demo tenant.
 */
export function demoRoutes(fastify: FastifyInstance): void {
  fastify.get(
    '/api/v1/demo/status',
    { schema: { hide: true }, config: { skipAuth: true } },
    async (_req, reply) => {
      const status = await fastify.demoService.getStatus();
      await reply.code(200).send(status);
    },
  );
}
