import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { jwtPlugin, tenantContextPlugin } from '@revelation-srs/auth';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import type { Config } from './config.js';
import { createAttendanceDb } from './db/client.js';
import type { AttendanceDb } from './db/client.js';
import { healthRoutes } from './routes/health.js';
import { engagementRoutes } from './routes/engagement.js';
import { engagementInterventionRoutes } from './routes/engagement-interventions.js';
import { EngagementService } from './services/engagement-service.js';
import { EngagementPolicyService } from './services/engagement-policy-service.js';
import { EngagementInterventionService } from './services/engagement-intervention-service.js';
import type { SrsEngagementOutcomeClient } from './srs/srs-engagement-outcome-client.js';
import { SrsEngagementOutcomeStubClient } from './srs/srs-engagement-outcome-client.js';
import type { ValueSetClient } from './srs/srs-value-set-client.js';
import { SrsValueSetStubClient } from './srs/srs-value-set-client.js';
import type { LocalEventSink } from './services/engagement-service.js';

export interface AppOptions {
  srsOutcomeClient?: SrsEngagementOutcomeClient;
  valueSetClient?:   ValueSetClient;
  onEvent?:          LocalEventSink;
}

export async function buildApp(config: Config, appOpts: AppOptions = {}): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: config.nodeEnv === 'development'
      ? {
          level:     config.logLevel,
          transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } },
        }
      : { level: config.logLevel },
    trustProxy: true,
  });

  // Security headers
  await fastify.register(helmet, { global: true });

  // CORS
  await fastify.register(cors, {
    origin:      config.corsOrigins,
    credentials: true,
  });

  // JWT authentication (RS256 in prod, HS256 in dev/test)
  const jwtOpts = config.keycloakJwksUrl
    ? { jwksUrl: config.keycloakJwksUrl }
    : { secret:  config.jwtSecret };
  await fastify.register(jwtPlugin, jwtOpts);

  // Extracts tenantId from JWT and makes it available as request.tenantId
  await fastify.register(tenantContextPlugin);

  // - Global error handler -
  fastify.setErrorHandler((err, req, reply) => {
    const error  = err as Error & { statusCode?: number; details?: unknown };
    const status = typeof error.statusCode === 'number' ? error.statusCode : 500;

    if (status >= 500) {
      req.log.error({ err }, 'Unhandled error');
    }

    void reply.code(status).send({
      type:          `https://srs.example.com/errors/${error.name ?? 'internal-error'}`,
      title:         status >= 500 ? 'Internal Server Error' : error.message,
      status,
      detail:        status < 500 ? error.message : 'An unexpected error occurred',
      correlationId: req.id,
      ...(status < 500 && error.details ? { errors: error.details } : {}),
    });
  });

  // Database
  const db = createAttendanceDb(config.databaseUrl);
  fastify.decorate('attendanceDb', db);
  fastify.decorate('config', config);

  const onEvent = appOpts.onEvent ?? ((event) => fastify.log.debug({ event }, 'attendance local event'));
  const srsOutcomeClient = appOpts.srsOutcomeClient ?? new SrsEngagementOutcomeStubClient();
  const valueSetClient   = appOpts.valueSetClient   ?? new SrsValueSetStubClient();

  const engagement             = new EngagementService(db, valueSetClient, onEvent);
  const engagementPolicy       = new EngagementPolicyService(db, srsOutcomeClient, onEvent);
  const engagementIntervention = new EngagementInterventionService(db, srsOutcomeClient, onEvent);

  fastify.decorate('engagementService', engagement);
  fastify.decorate('engagementPolicyService', engagementPolicy);
  fastify.decorate('engagementInterventionService', engagementIntervention);

  await fastify.register(healthRoutes);
  await fastify.register(engagementRoutes, { prefix: '/api/v1' });
  await fastify.register(engagementInterventionRoutes, { prefix: '/api/v1' });

  return fastify;
}

declare module 'fastify' {
  interface FastifyInstance {
    attendanceDb: AttendanceDb;
    config:       Config;
  }
}
