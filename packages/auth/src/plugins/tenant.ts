import { withTenantContext } from '@revelation-srs/db';
import type { Db, TenantScopedDb } from '@revelation-srs/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Provides a request-scoped tenant-context database accessor.
 *
 * After JWT validation has populated request.tenantId, routes and
 * services call:
 *
 *   const data = await request.withDb((db) => db.select().from(...))
 *
 * This wraps the call in `withTenantContext()` from @revelation-srs/db,
 * which runs SET LOCAL app.current_tenant_id inside a transaction so
 * all queries in that block are subject to RLS.
 *
 * Direct use of `fastify.db` (without withDb) is reserved for platform
 * administration operations that explicitly bypass RLS (BYPASSRLS role).
 */
function tenantContextPlugin(fastify: FastifyInstance): void {
  // Decorate request with a null placeholder; the real function is assigned
  // in preHandler after JWT sets request.tenantId.
  fastify.decorateRequest('withDb', () =>
    Promise.reject(new Error('Tenant database context is not available before authentication')));

  fastify.addHook('preHandler', (request: FastifyRequest, _reply, done) => {
    if (request.routeOptions.config?.skipAuth === true) {
      done();
      return;
    }

    // withDb is a closure that captures the authenticated tenantId for
    // this specific request.  It is set here rather than in preValidation
    // to ensure tenantId has already been populated by the JWT hook.
    const tenantId = request.tenantId;
    if (!tenantId) {
      done();
      return;
    }

    const db = (fastify as FastifyInstance & { db: Db }).db;
    request.withDb = <T>(fn: (db: TenantScopedDb) => Promise<T>): Promise<T> =>
      withTenantContext(db, tenantId, fn);

    done();
  });
}

export default fp(tenantContextPlugin, { name: 'srs-tenant', fastify: '5.x' });
