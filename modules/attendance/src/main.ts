// OTel must be bootstrapped before any other import.
import './telemetry.js';

import pino from 'pino';

import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { AttendanceEventConsumer } from './consumers/consumer.js';
import { createAttendanceDb } from './db/client.js';

const config  = loadConfig();
const log     = pino({ level: config.logLevel });
const fastify = await buildApp(config);
const db      = createAttendanceDb(config.databaseUrl);
const consumer = new AttendanceEventConsumer(config.natsUrl, db, log);

const shutdown = async (signal: string): Promise<void> => {
  fastify.log.info({ signal }, 'Shutting down attendance service');
  await consumer.close();
  await fastify.close();
  process.exit(0);
};

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT',  () => { void shutdown('SIGINT'); });

try {
  await fastify.listen({ port: config.port, host: '0.0.0.0' });
  fastify.log.info({ port: config.port }, 'Attendance service listening');

  // Start event consumer after HTTP server is ready.
  // NATS connection errors are logged but do not prevent the HTTP server
  // from serving health/readiness probes.
  consumer.connect().then(() => consumer.start()).catch((err: unknown) => {
    fastify.log.error({ err }, 'Failed to start NATS consumer — running without event ingestion');
  });
} catch (err) {
  fastify.log.error(err, 'Failed to start attendance service');
  process.exit(1);
}
