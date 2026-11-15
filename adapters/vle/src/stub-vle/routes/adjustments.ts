import type { FastifyInstance } from 'fastify';

import type { StubVleStore } from '../store.js';

/**
 * Stub VLE time accommodations: one additional-time percentage per student
 * per course (what StubVleDriver writes). Real platforms hold this per
 * assessment — see src/vle-platforms for Canvas and Moodle.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function adjustmentRoutes(fastify: FastifyInstance): Promise<void> {
  const store: StubVleStore = fastify.stubStore;

  fastify.put<{
    Params: { vleCourseId: string; personId: string };
    Body:   { extraTimePercent: number };
  }>('/stub/courses/:vleCourseId/time-accommodations/:personId', async (request, reply) => {
    const { vleCourseId, personId } = request.params;
    const record = store.setTimeAccommodation(vleCourseId, personId, request.body.extraTimePercent);
    return reply.send(record);
  });

  fastify.delete<{
    Params: { vleCourseId: string; personId: string };
  }>('/stub/courses/:vleCourseId/time-accommodations/:personId', async (request, reply) => {
    const { vleCourseId, personId } = request.params;
    return store.clearTimeAccommodation(vleCourseId, personId)
      ? reply.code(204).send()
      : reply.code(404).send({ error: 'No time accommodation' });
  });

  fastify.get('/stub/time-accommodations', async (_request, reply) => {
    return reply.send({ items: [...store.timeAccommodations.values()] });
  });
}
