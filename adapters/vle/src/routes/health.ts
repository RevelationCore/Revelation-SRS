import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import type { VleDb } from '../db/client.js';

// eslint-disable-next-line @typescript-eslint/require-await
export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/health', async (_request, reply) => {
    return reply.send({ status: 'ok', service: 'vle-connector' });
  });

  fastify.get('/ready', async (_request, reply) => {
    const db: VleDb = fastify.vleDb;
    try {
      await db.execute(sql`SELECT 1`);
      return reply.send({ status: 'ready' });
    } catch {
      return reply.code(503).send({ status: 'unavailable', reason: 'database unreachable' });
    }
  });
}
