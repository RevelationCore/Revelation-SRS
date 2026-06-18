import type { FastifyInstance } from 'fastify';

import type { StubVleStore } from '../store.js';

// eslint-disable-next-line @typescript-eslint/require-await
export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  const store: StubVleStore = fastify.stubStore;

  fastify.get('/stub/health', async (_req, reply) => {
    return reply.send({ status: 'ok', service: 'stub-vle' });
  });

  fastify.delete('/stub/reset', async (_req, reply) => {
    store.reset();
    return reply.code(204).send();
  });
}
