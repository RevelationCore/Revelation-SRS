import { httpServerMetrics } from '@revelation-srs/telemetry';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { ServiceTokenSource } from '@revelation-srs/service-client';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import type { Config } from './config.js';
import { createVleDb } from './db/client.js';
import type { VleDb } from './db/client.js';
import {
  HttpSrsRegistryClient,
  type SrsRegistryClient,
} from './registry/client.js';
import { HealthReporter } from './registry/health-reporter.js';
import { RegistrationLoader } from './registry/loader.js';
import { healthRoutes } from './routes/health.js';
import { HttpVleClient, type VleClient } from './vle-client/client.js';
import { createPlatformDriver, type VlePlatformDriver } from './vle-platforms/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    vleDb:               VleDb;
    config:              Config;
    registrationLoader:  RegistrationLoader;
    healthReporter:      HealthReporter;
    vleClient:           VleClient;
    platformDriver:      VlePlatformDriver;
  }
}

export interface BuildAppOptions {
  /** Override the SRS registry HTTP client — used in tests to inject a stub. */
  registryClient?: SrsRegistryClient;
  /** Override the VLE HTTP client — used in tests to point at the stub VLE. */
  vleClient?: VleClient;
  /** Override the platform driver for adjustments — used in tests. */
  platformDriver?: VlePlatformDriver;
  /** Tokens for calls to core (ADR-032); required unless registryClient is given. */
  srsTokens?: ServiceTokenSource;
}

export async function buildApp(
  config: Config,
  opts: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: config.nodeEnv === 'development'
      ? {
          level:     config.logLevel,
          transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } },
        }
      : {
          level: config.logLevel,
        },
    trustProxy: true,
  });
  // ADR-035: request durations by route template, served on the metrics port.
  httpServerMetrics(fastify);

  await fastify.register(helmet, { global: true });
  await fastify.register(cors, { origin: false });

  const db = createVleDb(config.databaseUrl, { statementTimeoutMs: 30_000, idleInTransactionTimeoutMs: 60_000 });
  fastify.decorate('vleDb', db);
  fastify.decorate('config', config);

  const registryClient =
    opts.registryClient ??
    (() => {
      if (!opts.srsTokens) throw new Error('buildApp needs a registryClient or srsTokens to reach core (ADR-032)');
      return new HttpSrsRegistryClient(config.srsApiUrl, opts.srsTokens, config.tenantId);
    })();

  const registrationLoader = new RegistrationLoader(
    registryClient,
    config.endpointSafetyClass,
    config.integrationRegistrationId,
  );

  const healthReporter = new HealthReporter(registryClient, config.integrationRegistrationId);

  fastify.decorate('registrationLoader', registrationLoader);
  fastify.decorate('healthReporter',     healthReporter);

  const effectiveVleClient = opts.vleClient ?? new HttpVleClient(config.vleEndpointUrl);
  fastify.decorate('vleClient', effectiveVleClient);
  fastify.decorate(
    'platformDriver',
    opts.platformDriver ?? createPlatformDriver(config.vlePlatform, config.vleEndpointUrl, config.vleApiToken, { moodleStrategy: config.moodleStrategy }),
  );

  // Load registration from SRS on startup.
  fastify.addHook('onReady', async () => {
    await registrationLoader.load();
  });

  await fastify.register(healthRoutes);

  return fastify;
}
