// OTel must be bootstrapped before any other import.
import './telemetry.js';

import pino from 'pino';

import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { WellbeingEventConsumer } from './consumers/consumer.js';
import { createWellbeingDb } from './db/client.js';

const config  = loadConfig();
const log     = pino({ level: config.logLevel });
const fastify = await buildApp(config);
const db      = createWellbeingDb(config.databaseUrl);
const consumer = new WellbeingEventConsumer(config.natsUrl, db, log);

const shutdown = async (signal: string): Promise<void> => {
  fastify.log.info({ signal }, 'Shutting down wellbeing service');
  await consumer.close();
  await fastify.close();
  process.exit(0);
};

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT',  () => { void shutdown('SIGINT'); });

try {
  await fastify.listen({ port: config.port, host: '0.0.0.0' });
  fastify.log.info({ port: config.port }, 'Wellbeing service listening');

  // Start event consumer after HTTP server is ready.
  // NATS connection errors are logged but do not prevent the HTTP server
  // from serving health/readiness probes.
  consumer.connect().then(() => consumer.start()).catch((err: unknown) => {
    fastify.log.error({ err }, 'Failed to start NATS consumer — running without event ingestion');
  });
} catch (err) {
  fastify.log.error(err, 'Failed to start wellbeing service');
  process.exit(1);
}
