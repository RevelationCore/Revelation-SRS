import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimiter from '@fastify/rate-limit';
import { jwtPlugin, tenantContextPlugin } from '@revelation-srs/auth';
import { createDb } from '@revelation-srs/db';
import type { DomainError } from '@revelation-srs/domain';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import type { Config } from './config.js';
import { AuditService } from './platform/audit/service.js';
import { IntegrationBusPublisher } from './platform/integration-bus/publisher.js';
import { RulesEngine } from './platform/rules-engine/engine.js';
import { ValueSetService } from './platform/value-sets/service.js';
import { healthRoutes } from './routes/health.js';
import { valueSetsRoutes } from './routes/value-sets.js';

/**
 * Builds and configures the Fastify application.
 * Decoupled from process startup so it can be instantiated in tests.
 */
export async function buildApp(config: Config): Promise<FastifyInstance> {
  const serializers = {
    req(req: { method: string; url: string; headers: Record<string, string | string[] | undefined> }) {
      return {
        method:        req.method,
        url:           req.url,
        correlationId: req.headers['x-correlation-id'],
      };
    },
  };

  const fastify = Fastify({
    logger: config.nodeEnv === 'development'
      ? {
          level: config.logLevel,
          transport: { target: 'pino-pretty', options: { colorize: true } },
          serializers,
        }
      : {
          level: config.logLevel,
          serializers,
        },
    genReqId: () => crypto.randomUUID(),
    disableRequestLogging: false,
  });

  // - Platform infrastructure -

  const db        = createDb(config.databaseUrl);
  const audit     = new AuditService(db);
  const rules     = new RulesEngine(db);
  const valueSets = new ValueSetService(db);
  const eventBus  = new IntegrationBusPublisher(config.natsUrl);

  // Decorate the Fastify instance so plugins and routes can access shared services
  fastify.decorate('config',   config);
  fastify.decorate('db',       db);
  fastify.decorate('audit',    audit);
  fastify.decorate('rules',    rules);
  fastify.decorate('valueSetService', valueSets);
  fastify.decorate('eventBus', eventBus);

  // - Security plugins -

  await fastify.register(helmet, { global: true });

  await fastify.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
  });

  await fastify.register(rateLimiter, {
    max:       1000,
    timeWindow: 60_000,
    keyGenerator: (req) => req.tenantId ?? req.ip,
  });

  await fastify.register(jwtPlugin, {
    secret:  config.jwtSecret,
    ...(config.keycloakJwksUrl ? { jwksUrl: config.keycloakJwksUrl } : {}),
  });
  await fastify.register(tenantContextPlugin);

  // - Global error handler -

  fastify.setErrorHandler((err, req, reply) => {
    const error = err as Error & Partial<DomainError> & { statusCode?: number; fields?: unknown };
    const isDomain = typeof error.code === 'string' && typeof error.statusCode === 'number';
    const status   = isDomain ? error.statusCode! : (error.statusCode ?? 500);

    if (status >= 500) {
      req.log.error({ err }, 'Unhandled error');
    }

    void reply.code(status).send({
      type:          `https://srs.example.com/errors/${isDomain ? error.code : 'internal-error'}`,
      title:         status >= 500 ? 'Internal Server Error' : error.message,
      status,
      detail:        status < 500 ? error.message : 'An unexpected error occurred',
      instance:      req.url,
      correlationId: req.id,
      ...(isDomain && error.fields
        ? { errors: error.fields }
        : {}),
    });
  });

  // - Routes -

  await fastify.register(healthRoutes);
  await fastify.register(valueSetsRoutes, { prefix: '/api/v1' });

  // Domain routes are registered by phase-specific route modules:
  // await fastify.register(studentRoutes, { prefix: '/api/v1' });
  // ... added in Phase 4 onwards

  return fastify;
}

// Fastify module augmentation for decorated properties
declare module 'fastify' {
  interface FastifyInstance {
    db:       ReturnType<typeof createDb>;
    config:   Config;
    audit:    AuditService;
    rules:    RulesEngine;
    valueSetService: ValueSetService;
    eventBus: IntegrationBusPublisher;
  }
  interface FastifyContextConfig {
    skipAuth?: boolean;
  }
}
