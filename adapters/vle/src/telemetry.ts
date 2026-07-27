/**
 * OpenTelemetry SDK bootstrap for the VLE connector adapter.
 * Import before all other modules in main.ts.
 */

import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION, SEMRESATTRS_DEPLOYMENT_ENVIRONMENT } from '@opentelemetry/semantic-conventions';

const serviceName    = process.env['OTEL_SERVICE_NAME']    ?? 'srs-vle-adapter';
const serviceVersion = process.env['SRS_RELEASE_VERSION']  ?? '0.0.0';
const environment    = process.env['NODE_ENV']              ?? 'development';
const otlpEndpoint   = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];

const sdk = new NodeSDK({
  resource: new Resource({
    [SEMRESATTRS_SERVICE_NAME]:           serviceName,
    [SEMRESATTRS_SERVICE_VERSION]:        serviceVersion,
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: environment,
  }),
  ...(otlpEndpoint
    ? {
        spanProcessor: new SimpleSpanProcessor(
          new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` }),
        ),
      }
    : {}),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fastify': { enabled: true },
      '@opentelemetry/instrumentation-http':    { enabled: true },
      '@opentelemetry/instrumentation-pg':      {
        enabled: true,
        requestHook: (span, { query }) => {
          span.setAttribute('db.statement', query.text.slice(0, 200));
        },
      },
      '@opentelemetry/instrumentation-fs':      { enabled: false },
    }),
  ],
});

sdk.start();

process.on('SIGTERM', () => {
  sdk.shutdown().catch((err) => console.error('OTel SDK shutdown error', err));
});
