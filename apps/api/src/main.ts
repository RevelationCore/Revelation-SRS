import { loadConfig } from './config.js';
import { buildApp } from './app.js';

const config = loadConfig();
const app    = await buildApp(config);

// Connect event bus (non-blocking on startup failure in dev to allow health check to pass)
try {
  await app.eventBus.connect();
  app.log.info('NATS JetStream connected');
} catch (err) {
  app.log.warn({ err }, 'NATS connection failed — event publishing unavailable until resolved');
}

const address = await app.listen({ port: config.port, host: '0.0.0.0' });
app.log.info({ address }, 'SRS API listening');

// Graceful shutdown
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    app.log.info({ signal }, 'Shutdown signal received');
    await app.close();
    await app.eventBus.close();
    process.exit(0);
  });
}
