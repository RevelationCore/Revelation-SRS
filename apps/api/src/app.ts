import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimiter from '@fastify/rate-limit';
import { jwtPlugin, tenantContextPlugin } from '@revelation-srs/auth';
import { createDb } from '@revelation-srs/db';
import type { DomainError } from '@revelation-srs/domain';
import Fastify from 'fastify';

import type { Config } from './config.js';
import { AuditService } from './platform/audit/service.js';
import { IntegrationBusPublisher } from './platform/integration-bus/publisher.js';
import { RulesEngine } from './platform/rules-engine/engine.js';
import { healthRoutes } from './routes/health.js';

/**
 * Builds and configures the Fastify application.
 * Decoupled from process startup so it can be instantiated in tests.
 */
export async function buildApp(config: Config): Promise<ReturnType<typeof Fastify>> {
  const fastify = Fastify({
    logger: {
      level:     config.logLevel,
      transport: config.nodeEnv === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
      // All log entries include correlation-id for distributed tracing
      serializers: {
        req(req) {
          return {
            method:        req.method,
            url:           req.url,
            correlationId: (req as { headers: Record<string, string> }).headers['x-correlation-id'],
          };
        },
      },
    },
    genReqId: () => crypto.randomUUID(),
    disableRequestLogging: false,
  });

  // ── Platform infrastructure ─────────────────────────────────────────────────

  const db        = createDb(config.databaseUrl);
  const audit     = new AuditService(db);
  const rules     = new RulesEngine(db);
  const eventBus  = new IntegrationBusPublisher(config.natsUrl);

  // Decorate the Fastify instance so plugins and routes can access shared services
  fastify.decorate('db',       db);
  fastify.decorate('audit',    audit);
  fastify.decorate('rules',    rules);
  fastify.decorate('eventBus', eventBus);

  // ── Security plugins ────────────────────────────────────────────────────────

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

  await fastify.register(jwtPlugin, { secret: config.jwtSecret });
  await fastify.register(tenantContextPlugin);

  // ── Global error handler ────────────────────────────────────────────────────

  fastify.setErrorHandler((err, req, reply) => {
    const isDomain = 'code' in err && 'statusCode' in err;
    const status   = isDomain ? (err as DomainError).statusCode : (err.statusCode ?? 500);

    if (status >= 500) {
      req.log.error({ err }, 'Unhandled error');
    }

    void reply.code(status).send({
      type:          `https://srs.example.com/errors/${isDomain ? (err as DomainError).code : 'internal-error'}`,
      title:         status >= 500 ? 'Internal Server Error' : err.message,
      status,
      detail:        status < 500 ? err.message : 'An unexpected error occurred',
      instance:      req.url,
      correlationId: req.id,
      ...(isDomain && 'fields' in err
        ? { errors: (err as { fields?: unknown }).fields }
        : {}),
    });
  });

  // ── Routes ───────────────────────────────────────────────────────────────────

  await fastify.register(healthRoutes);

  // Domain routes are registered by phase-specific route modules:
  // await fastify.register(studentRoutes, { prefix: '/api/v1' });
  // ... added in Phase 4 onwards

  return fastify;
}

// Fastify module augmentation for decorated properties
declare module 'fastify' {
  interface FastifyInstance {
    db:       ReturnType<typeof createDb>;
    audit:    AuditService;
    rules:    RulesEngine;
    eventBus: IntegrationBusPublisher;
  }
  interface FastifyContextConfig {
    skipAuth?: boolean;
  }
}
