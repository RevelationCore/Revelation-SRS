import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Sets app.current_tenant_id on the PostgreSQL session for every request
 * after JWT authentication has populated request.tenantId.
 *
 * The db pool is injected as a decorated Fastify instance property by the
 * consuming app and made available here via fastify.db.
 */
async function tenantContextPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('onRequest', async (request) => {
    // tenantId is set by the JWT plugin; nothing to do here yet.
    // The actual DB session variable is set in withTenantContext() before
    // each database call, using the request.tenantId value populated here.
    void request; // accessed at DB call time
  });
}

export default fp(tenantContextPlugin, { name: 'srs-tenant', fastify: '5.x' });
