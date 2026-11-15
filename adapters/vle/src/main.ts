// OTel must be bootstrapped before any other import.
import './telemetry.js';

import { pino } from 'pino';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { VleEventConsumer } from './consumers/vle-event-consumer.js';
import { ReconciliationService } from './reliability/reconciliation-service.js';
import { HttpSrsAcknowledgementClient } from './srs-client/acknowledgement-client.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app    = await buildApp(config);

  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`VLE connector listening on port ${config.port}`);
  app.log.info(`Endpoint safety class: ${config.endpointSafetyClass}`);
  app.log.info(`VLE endpoint: ${config.vleEndpointUrl} (platform: ${config.vlePlatform})`);

  // The consumer and reconciler take a pino logger (special-category data is
  // never logged; handlers log identifiers only).
  const log = pino({ level: config.logLevel });
  const srsAckClient = new HttpSrsAcknowledgementClient(config.srsApiUrl, config.serviceAccountToken);

  let consumer: VleEventConsumer | null = null;
  if (config.consumerEnabled) {
    consumer = new VleEventConsumer(config.natsUrl, app.vleDb, config.tenantId, log, {
      vleClient:      app.vleClient,
      srsAckClient,
      platformDriver: app.platformDriver,
      maxAttempts:    config.retryMaxAttempts,
    });
    await consumer.connect();
    await consumer.start();
  } else {
    app.log.warn('VLE_CONSUMER_ENABLED=false — not consuming SRS events');
  }

  // Re-acknowledge applied-but-unacknowledged adjustments, and re-assert
  // students' VLE accommodations so assessments added since are covered.
  const reconciliation = new ReconciliationService(
    app.vleDb, config.tenantId, app.vleClient, srsAckClient, undefined, log, app.platformDriver,
  );
  let running = false;
  const timer = config.reconcileIntervalMs > 0
    ? setInterval(() => {
        if (running) return;
        running = true;
        void (async () => {
          try {
            await reconciliation.reconcileAdjustments();
            await reconciliation.reconcileAdjustmentCoverage();
          } catch (err) {
            app.log.error({ err }, 'Adjustment reconciliation failed');
          } finally {
            running = false;
          }
        })();
      }, config.reconcileIntervalMs)
    : null;

  const shutdown = async (): Promise<void> => {
    if (timer) clearInterval(timer);
    await consumer?.close();
    await app.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
