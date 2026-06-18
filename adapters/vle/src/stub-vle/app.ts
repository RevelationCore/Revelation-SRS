import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { StubVleStore } from './store.js';
import { adminRoutes } from './routes/admin.js';
import { adjustmentRoutes } from './routes/adjustments.js';
import { courseRoutes } from './routes/courses.js';
import { enrolmentRoutes } from './routes/enrolments.js';
import { markRoutes } from './routes/marks.js';

declare module 'fastify' {
  interface FastifyInstance {
    stubStore: StubVleStore;
  }
}

export async function buildStubVleApp(logLevel = 'silent'): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: { level: logLevel } });
  const store   = new StubVleStore();

  fastify.decorate('stubStore', store);

  await fastify.register(adminRoutes);
  await fastify.register(courseRoutes);
  await fastify.register(enrolmentRoutes);
  await fastify.register(adjustmentRoutes);
  await fastify.register(markRoutes);

  return fastify;
}
