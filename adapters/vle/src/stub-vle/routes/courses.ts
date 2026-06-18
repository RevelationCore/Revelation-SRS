import type { FastifyInstance } from 'fastify';

import type { StubVleStore } from '../store.js';

// eslint-disable-next-line @typescript-eslint/require-await
export async function courseRoutes(fastify: FastifyInstance): Promise<void> {
  const store: StubVleStore = fastify.stubStore;

  fastify.post<{
    Body: { moduleId: string; code: string; title: string; creditValue?: number };
  }>('/stub/courses', async (request, reply) => {
    const { moduleId, code, title, creditValue = 0 } = request.body;
    const course = store.upsertCourse({
      moduleId,
      vleCourseId: `vle-course-${moduleId}`,
      code,
      title,
      creditValue,
    });
    return reply.code(201).send(course);
  });

  fastify.get('/stub/courses', async (_request, reply) => {
    return reply.send({ items: [...store.courses.values()] });
  });

  fastify.get<{
    Params: { moduleId: string };
  }>('/stub/courses/:moduleId', async (request, reply) => {
    const course = store.courses.get(request.params.moduleId);
    if (!course) return reply.code(404).send({ error: 'Course not found' });
    const enrolments = store.enrolmentsForModule(request.params.moduleId);
    const result     = store.results.get(request.params.moduleId);
    return reply.send({ ...course, enrolments, result: result ?? null });
  });

  // Stub mark receipt to indicate a result has been ratified
  fastify.patch<{
    Params: { moduleId: string; moduleRegistrationId: string };
    Body:   { aggregateMark: number; resultCode: string; ratifiedAt: string };
  }>('/stub/courses/:moduleId/enrolments/:moduleRegistrationId/result', async (request, reply) => {
    const { moduleRegistrationId } = request.params;
    const { aggregateMark, resultCode, ratifiedAt } = request.body;
    const enrolment = store.enrolments.get(moduleRegistrationId);
    if (!enrolment) return reply.code(404).send({ error: 'Enrolment not found' });
    store.setResult({ moduleRegistrationId, aggregateMark, resultCode, ratifiedAt });
    return reply.code(204).send();
  });

  // Canonical module id for the stub
  fastify.get<{
    Params: { moduleId: string };
  }>('/stub/courses/:moduleId/enrolments', async (request, reply) => {
    return reply.send({ items: store.enrolmentsForModule(request.params.moduleId) });
  });
}
