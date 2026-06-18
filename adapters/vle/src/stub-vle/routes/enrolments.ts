import type { FastifyInstance } from 'fastify';

import type { StubVleStore } from '../store.js';

// eslint-disable-next-line @typescript-eslint/require-await
export async function enrolmentRoutes(fastify: FastifyInstance): Promise<void> {
  const store: StubVleStore = fastify.stubStore;

  fastify.post<{
    Params: { moduleId: string };
    Body:   {
      moduleRegistrationId: string;
      personId:             string;
      enrolmentId:          string;
      statusCode?:          string;
    };
  }>('/stub/courses/:moduleId/enrolments', async (request, reply) => {
    const { moduleId }                                    = request.params;
    const { moduleRegistrationId, personId, enrolmentId, statusCode = 'active' } = request.body;
    const enrolment = store.upsertEnrolment({
      moduleRegistrationId,
      moduleId,
      personId,
      enrolmentId,
      vleEnrolmentId: `vle-enr-${moduleRegistrationId}`,
      statusCode,
    });
    return reply.code(201).send(enrolment);
  });

  fastify.patch<{
    Params: { moduleId: string; moduleRegistrationId: string };
    Body:   { statusCode: string };
  }>('/stub/courses/:moduleId/enrolments/:moduleRegistrationId', async (request, reply) => {
    const { moduleRegistrationId } = request.params;
    const { statusCode }           = request.body;
    const updated = store.updateEnrolmentStatus(moduleRegistrationId, statusCode);
    if (!updated) return reply.code(404).send({ error: 'Enrolment not found' });
    return reply.send(updated);
  });

  // Simplified ratified-result endpoint — no moduleId needed.
  // Called by the connector when srs.assessment.module-result-ratified is received.
  fastify.patch<{
    Params: { moduleRegistrationId: string };
    Body:   { aggregateMark: number; resultCode: string; ratifiedAt: string };
  }>('/stub/enrolments/:moduleRegistrationId/result', async (request, reply) => {
    const { moduleRegistrationId }         = request.params;
    const { aggregateMark, resultCode, ratifiedAt } = request.body;
    const enrolment = store.enrolments.get(moduleRegistrationId);
    if (!enrolment) return reply.code(404).send({ error: 'Enrolment not found' });
    store.setResult({ moduleRegistrationId, aggregateMark, resultCode, ratifiedAt });
    return reply.code(204).send();
  });

  fastify.get<{
    Params: { moduleRegistrationId: string };
  }>('/stub/enrolments/:moduleRegistrationId/result', async (request, reply) => {
    const result = store.results.get(request.params.moduleRegistrationId);
    if (!result) return reply.code(404).send({ error: 'Result not found' });
    return reply.send(result);
  });
}
