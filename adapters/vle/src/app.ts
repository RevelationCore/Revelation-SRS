import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
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

declare module 'fastify' {
  interface FastifyInstance {
    vleDb:               VleDb;
    config:              Config;
    registrationLoader:  RegistrationLoader;
    healthReporter:      HealthReporter;
    vleClient:           VleClient;
  }
}

export interface BuildAppOptions {
  /** Override the SRS registry HTTP client — used in tests to inject a stub. */
  registryClient?: SrsRegistryClient;
  /** Override the VLE HTTP client — used in tests to point at the stub VLE. */
  vleClient?: VleClient;
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

  await fastify.register(helmet, { global: true });
  await fastify.register(cors, { origin: false });

  const db = createVleDb(config.databaseUrl);
  fastify.decorate('vleDb', db);
  fastify.decorate('config', config);

  const registryClient =
    opts.registryClient ??
    new HttpSrsRegistryClient(config.srsApiUrl, config.serviceAccountToken);

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

  // Load registration from SRS on startup.
  fastify.addHook('onReady', async () => {
    await registrationLoader.load();
  });

  await fastify.register(healthRoutes);

  return fastify;
}
