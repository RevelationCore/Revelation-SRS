import type { FastifyInstance } from 'fastify';

import type { StubVleStore } from '../store.js';

// eslint-disable-next-line @typescript-eslint/require-await
export async function adjustmentRoutes(fastify: FastifyInstance): Promise<void> {
  const store: StubVleStore = fastify.stubStore;

  fastify.post<{
    Body: {
      adjustmentId:       string;
      distributionId:     string;
      personId:           string;
      enrolmentId:        string;
      adjustmentTypeCode: string;
      scopeCode:          string;
      validFrom:          string;
      validTo?:           string;
    };
  }>('/stub/adjustments', async (request, reply) => {
    const { validTo, ...rest } = request.body;
    const adjustment = store.addAdjustment({ ...rest, validTo: validTo ?? null });
    return reply.code(201).send(adjustment);
  });

  fastify.get('/stub/adjustments', async (_request, reply) => {
    return reply.send({ items: [...store.adjustments.values()] });
  });

  fastify.get<{
    Params: { adjustmentId: string };
  }>('/stub/adjustments/:adjustmentId', async (request, reply) => {
    const found = [...store.adjustments.values()].find(
      a => a.adjustmentId === request.params.adjustmentId,
    );
    if (!found) return reply.code(404).send({ error: 'Adjustment not found' });
    return reply.send(found);
  });
}
