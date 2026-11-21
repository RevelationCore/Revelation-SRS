import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import { assertSecureAuthConfig, jwtPlugin, jwtPluginOptions, tenantContextPlugin } from '@revelation-srs/auth';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import type { Config } from './config.js';
import { registerProblemHandlers } from './http/problem.js';
import { createWellbeingDb } from './db/client.js';
import type { WellbeingDb } from './db/client.js';
import { EdrmsSimulator } from './edrms/edrms-adapter.js';
import type { SrsAdjustmentClient } from './srs/srs-adjustment-client.js';
import { createSrsHandoffClients, isStubClient, loadSrsHandoffConfig } from './srs/handoff-config.js';
import type { SrsEcClient } from './srs/srs-ec-client.js';
import { adjustmentCaseRoutes } from './routes/adjustment-cases.js';
import { adminRetentionRoutes } from './routes/admin-retention.js';
import { disabilityCaseRoutes } from './routes/disability-cases.js';
import { earlyWarningAlertRoutes } from './routes/early-warning-alerts.js';
import { ecClaimRoutes } from './routes/ec-claims.js';
import { healthRoutes } from './routes/health.js';
import { mentalHealthCaseRoutes } from './routes/mental-health-cases.js';
import { sarRoutes } from './routes/sar.js';

export interface AppOptions {
  srsAdjustmentClient?: SrsAdjustmentClient;
  srsEcClient?:         SrsEcClient;
}

// Fields redacted from all structured log output to prevent special-category
// data leaking into log aggregation pipelines.
const REDACTED_PATHS = [
  'body.content',
  'body.notes',
  'body.goals',
  'body.externalReferralDetails',
  'body.presentingConcernCode',
  '*.content',
  '*.notes',
  '*.goals',
];

export async function buildApp(config: Config, appOpts: AppOptions = {}): Promise<FastifyInstance> {
  assertSecureAuthConfig('srs-wellbeing', config.nodeEnv, config);

  const fastify = Fastify({
    logger: config.nodeEnv === 'development'
      ? {
          level:     config.logLevel,
          redact:    { paths: REDACTED_PATHS, censor: '[REDACTED]' },
          transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } },
        }
      : {
          level:  config.logLevel,
          redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
        },
    trustProxy: true,
  });

  // Security headers
  await fastify.register(helmet, { global: true });

  // CORS
  await fastify.register(cors, {
    origin:      config.corsOrigins,
    credentials: true,
  });

  // Evidence uploads (multipart/form-data) — capped well above the
  // per-document byte limit the storage adapter itself enforces, so the
  // adapter's DocumentTooLargeError (not a raw multipart abort) is what
  // the caller actually sees.
  await fastify.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

  // Every error leaves as problem+json (item 1.7).
  registerProblemHandlers(fastify);

  // OpenAPI, generated from the route schemas (openapi/v1.json).
  await fastify.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title:       'Revelation SRS Wellbeing API',
        description: 'Wellbeing module: disability support, adjustments, EC claims, mental health and early warning',
        version:     '1.0.0',
        license:     { name: 'AGPL-3.0', url: 'https://www.gnu.org/licenses/agpl-3.0.html' },
      },
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
      security: [{ bearerAuth: [] }],
    },
  });

  // JWT authentication (RS256 in prod, HS256 in dev/test)
  await fastify.register(jwtPlugin, jwtPluginOptions(config, 'srs-wellbeing'));

  // Extracts tenantId from JWT and makes it available as request.tenantId
  await fastify.register(tenantContextPlugin);

  // Database
  const db = createWellbeingDb(config.databaseUrl, { statementTimeoutMs: 30_000, idleInTransactionTimeoutMs: 60_000 });
  fastify.decorate('wellbeingDb', db);
  fastify.decorate('config',      config);

  // Routes
  await fastify.register(healthRoutes);
  await fastify.register(disabilityCaseRoutes, { edrms: new EdrmsSimulator() });
  // ADR-029: real clients unless the caller injects others; never a stub
  // outside development and test, however it arrives.
  const fromConfig = (!appOpts.srsAdjustmentClient || !appOpts.srsEcClient)
    ? createSrsHandoffClients(config.nodeEnv, config.srsHandoff ?? loadSrsHandoffConfig(config.nodeEnv))
    : null;
  const srsClient      = appOpts.srsAdjustmentClient ?? fromConfig!.adjustment;
  const srsEcClient    = appOpts.srsEcClient         ?? fromConfig!.ec;
  if (!['development', 'test'].includes(config.nodeEnv) && (isStubClient(srsClient) || isStubClient(srsEcClient))) {
    throw new Error('Refusing to start srs-wellbeing with stub SRS clients outside development and test (ADR-029)');
  }
  await fastify.register(adjustmentCaseRoutes, { srsClient });
  await fastify.register(ecClaimRoutes, { srsEcClient });
  await fastify.register(mentalHealthCaseRoutes);
  await fastify.register(earlyWarningAlertRoutes);
  await fastify.register(sarRoutes);
  await fastify.register(adminRetentionRoutes);

  return fastify;
}

declare module 'fastify' {
  interface FastifyInstance {
    wellbeingDb: WellbeingDb;
    config:      Config;
  }
}
