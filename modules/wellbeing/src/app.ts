import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import { jwtPlugin, tenantContextPlugin } from '@revelation-srs/auth';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import type { Config } from './config.js';
import { createWellbeingDb } from './db/client.js';
import type { WellbeingDb } from './db/client.js';
import { EdrmsSimulator } from './edrms/edrms-adapter.js';
import type { SrsAdjustmentClient } from './srs/srs-adjustment-client.js';
import { SrsAdjustmentStubClient } from './srs/srs-adjustment-client.js';
import type { SrsEcClient } from './srs/srs-ec-client.js';
import { SrsEcStubClient } from './srs/srs-ec-client.js';
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

  // JWT authentication (RS256 in prod, HS256 in dev/test)
  const jwtOpts = config.keycloakJwksUrl
    ? { jwksUrl: config.keycloakJwksUrl }
    : { secret:  config.jwtSecret };
  await fastify.register(jwtPlugin, jwtOpts);

  // Extracts tenantId from JWT and makes it available as request.tenantId
  await fastify.register(tenantContextPlugin);

  // Database
  const db = createWellbeingDb(config.databaseUrl);
  fastify.decorate('wellbeingDb', db);
  fastify.decorate('config',      config);

  // Routes
  await fastify.register(healthRoutes);
  await fastify.register(disabilityCaseRoutes, { edrms: new EdrmsSimulator() });
  const srsClient      = appOpts.srsAdjustmentClient ?? new SrsAdjustmentStubClient();
  const srsEcClient    = appOpts.srsEcClient         ?? new SrsEcStubClient();
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
