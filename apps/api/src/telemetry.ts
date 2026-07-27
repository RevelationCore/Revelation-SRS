/**
 * OpenTelemetry SDK bootstrap — must be imported before any other module in main.ts.
 *
 * Instruments: Fastify HTTP, pg/Drizzle (PostgreSQL), NATS client, and any
 * Node.js built-in (http, dns, etc.) via auto-instrumentations-node.
 *
 * Traces are exported via OTLP to Grafana Tempo (or any OTLP-compatible backend).
 * If OTEL_EXPORTER_OTLP_ENDPOINT is not set the SDK starts in no-op mode so
 * the application functions normally without an observability backend.
 */

import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION, SEMRESATTRS_DEPLOYMENT_ENVIRONMENT } from '@opentelemetry/semantic-conventions';

const serviceName    = process.env['OTEL_SERVICE_NAME']    ?? 'srs-api';
const serviceVersion = process.env['SRS_RELEASE_VERSION']  ?? '0.0.0';
const environment    = process.env['NODE_ENV']              ?? 'development';
const otlpEndpoint   = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];

const resource = new Resource({
  [SEMRESATTRS_SERVICE_NAME]:           serviceName,
  [SEMRESATTRS_SERVICE_VERSION]:        serviceVersion,
  [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: environment,
});

const sdk = new NodeSDK({
  resource,
  ...(otlpEndpoint
    ? {
        spanProcessor: new SimpleSpanProcessor(
          new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` }),
        ),
      }
    : {}),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fastify':    { enabled: true },
      '@opentelemetry/instrumentation-pg':         { enabled: true },
      '@opentelemetry/instrumentation-net':        { enabled: true },
      '@opentelemetry/instrumentation-dns':        { enabled: true },
      '@opentelemetry/instrumentation-http':       { enabled: true },
      '@opentelemetry/instrumentation-fs':         { enabled: false },   // noisy; disable
    }),
  ],
});

sdk.start();

process.on('SIGTERM', () => {
  sdk.shutdown().catch((err) => console.error('OTel SDK shutdown error', err));
});
