import type { FastifyInstance } from 'fastify';

import type { StubVleStore } from '../store.js';

// eslint-disable-next-line @typescript-eslint/require-await
export async function markRoutes(fastify: FastifyInstance): Promise<void> {
  const store: StubVleStore = fastify.stubStore;

  fastify.post<{
    Body: {
      moduleRegistrationId:  string;
      assessmentComponentId: string;
      rawMark:               number;
      sourceReference:       string;
    };
  }>('/stub/marks', async (request, reply) => {
    const mark = store.addMark(request.body);
    return reply.code(201).send(mark);
  });

  fastify.get('/stub/marks', async (_request, reply) => {
    return reply.send({ items: [...store.marks.values()] });
  });
}
