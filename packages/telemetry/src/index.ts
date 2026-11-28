/**
 * One OpenTelemetry bootstrap for every Node service (ADR-035 items 1 to 3).
 *
 * - Traces: OTLP over HTTP to OTEL_EXPORTER_OTLP_ENDPOINT, through a
 *   BatchSpanProcessor. With no endpoint, no spans leave the process.
 * - Metrics: a Prometheus exporter on a dedicated port (9464, `/metrics`),
 *   never a port an Ingress routes to.
 * - Runtime metrics (event loop, GC, heap), and HTTP server metrics recorded by
 *   httpServerMetrics with a bounded route label. The HTTP instrumentation's
 *   own server histogram is dropped: it has no route.
 * - No database statement hooks: a statement must never carry personal data
 *   into a span.
 *
 * Call startTelemetry first in a service's entry point, before other imports
 * do their work. Only this package may create an SDK or a metrics exporter
 * (the ESLint rule in BL-424 enforces it).
 */
import { metrics, type Histogram } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { AggregationType } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import type { FastifyInstance, FastifyRequest } from 'fastify';

export const DEFAULT_METRICS_PORT = 9464;

export interface TelemetryOptions {
  /** The service name on every span and metric, for example 'srs-api'. */
  serviceName: string;
  /** Defaults to METRICS_PORT, then 9464. 0 turns the metrics endpoint off. */
  metricsPort?: number;
  /** Defaults to OTEL_EXPORTER_OTLP_ENDPOINT. */
  otlpEndpoint?: string;
  serviceVersion?: string;
}

export interface Telemetry {
  /** The port /metrics is served on, or null when off. */
  metricsPort: number | null;
  shutdown(): Promise<void>;
}

/** The port to serve /metrics on: the option, then METRICS_PORT, then 9464. */
export function resolveMetricsPort(option?: number, env: NodeJS.ProcessEnv = process.env): number {
  if (option !== undefined) return option;
  const fromEnv = env['METRICS_PORT'];
  if (fromEnv === undefined || fromEnv === '') return DEFAULT_METRICS_PORT;
  const port = Number(fromEnv);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`METRICS_PORT must be a port number, not '${fromEnv}'`);
  return port;
}

/** What each service's config carries for telemetry (P-06): validated at startup, like the rest. */
export interface TelemetryConfig {
  metricsPort: number;
  otlpEndpoint: string | undefined;
}

/** Reads METRICS_PORT and OTEL_EXPORTER_OTLP_ENDPOINT, refusing values that are not a port or an http(s) URL. */
export function loadTelemetryConfig(env: NodeJS.ProcessEnv = process.env): TelemetryConfig {
  const raw = env['OTEL_EXPORTER_OTLP_ENDPOINT'];
  let otlpEndpoint: string | undefined;
  if (raw !== undefined && raw !== '') {
    let url: URL;
    try { url = new URL(raw); } catch { throw new Error(`OTEL_EXPORTER_OTLP_ENDPOINT must be an http(s) URL, not '${raw}'`); }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`OTEL_EXPORTER_OTLP_ENDPOINT must be an http(s) URL, not '${raw}'`);
    otlpEndpoint = raw.replace(/\/$/, '');
  }
  return { metricsPort: resolveMetricsPort(undefined, env), otlpEndpoint };
}

export function startTelemetry(options: TelemetryOptions): Telemetry {
  const fromEnv = options.metricsPort === undefined || options.otlpEndpoint === undefined ? loadTelemetryConfig() : undefined;
  const metricsPort = options.metricsPort ?? fromEnv?.metricsPort ?? DEFAULT_METRICS_PORT;
  const otlpEndpoint = options.otlpEndpoint ?? fromEnv?.otlpEndpoint;
  // Fixed in code, not OTEL_SERVICE_NAME: one development .env serves every process,
  // and the metrics catalogue's emittedBy names these services.
  const serviceName = options.serviceName;
  const exporter = metricsPort > 0
    ? new PrometheusExporter({ host: '0.0.0.0', port: metricsPort, endpoint: '/metrics' }, (err) => {
      // A port already taken (two services on one development host) must not stop the service.
      if (err) console.warn(`${serviceName}: metrics endpoint not started on port ${metricsPort}: ${err.message}`);
    })
    : undefined;

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: options.serviceVersion ?? process.env['SRS_RELEASE_VERSION'] ?? '0.0.0',
      'deployment.environment.name': process.env['SRS_ENVIRONMENT_CODE'] ?? process.env['NODE_ENV'] ?? 'development',
    }),
    // No detectors: the process detector puts the full command line (which can
    // carry a secret) and the host on target_info. Prometheus adds pod and
    // namespace labels itself.
    resourceDetectors: [],
    // Explicit, even when empty: left unset, NodeSDK falls back to its own OTLP
    // exporters on localhost:4318 and logs a connection error for every batch.
    spanProcessors: otlpEndpoint ? [new BatchSpanProcessor(new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` }))] : [],
    logRecordProcessors: [],
    ...(exporter ? { metricReaders: [exporter] } : {}),
    views: [{
      // httpServerMetrics records this instrument with a route; the HTTP instrumentation's copy has none.
      meterName: '@opentelemetry/instrumentation-http',
      instrumentName: 'http.server.request.duration',
      aggregation: { type: AggregationType.DROP },
    }],
    instrumentations: [
      getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } }),
      new RuntimeNodeInstrumentation(),
    ],
  });
  sdk.start();

  let stopped = false;
  const shutdown = async () => {
    if (stopped) return;
    stopped = true;
    await sdk.shutdown();
  };
  process.once('SIGTERM', () => { shutdown().catch((err: unknown) => { console.error('OpenTelemetry shutdown failed', err); }); });
  return { metricsPort: exporter ? metricsPort : null, shutdown };
}

/** The OpenTelemetry semantic-convention buckets for HTTP durations, in seconds. */
export const HTTP_DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10];

let serverDuration: Histogram | undefined;
const started = new WeakMap<FastifyRequest, bigint>();

/**
 * Records http.server.request.duration for every request (ADR-035 item 3), with
 * http_request_method, http_route (the route template, never the raw path,
 * or 'unmatched') and http_response_status_code. Routes registered with
 * schema.hide (health, readiness) are not recorded. Register it before the
 * routes. Exported as http_server_request_duration_{bucket,count,sum}.
 */
export function httpServerMetrics(app: FastifyInstance): void {
  serverDuration ??= metrics.getMeter('@revelation-srs/telemetry').createHistogram('http.server.request.duration', {
    unit: 's', description: 'Duration of HTTP server requests', advice: { explicitBucketBoundaries: HTTP_DURATION_BUCKETS },
  });
  const histogram = serverDuration;
  app.addHook('onRequest', (request, _reply, done) => {
    started.set(request, process.hrtime.bigint());
    done();
  });
  app.addHook('onResponse', (request, reply, done) => {
    const start = started.get(request);
    const schema = request.routeOptions.schema as { hide?: boolean } | undefined;
    if (start !== undefined && schema?.hide !== true) {
      histogram.record(Number(process.hrtime.bigint() - start) / 1e9, {
        http_request_method: request.method,
        http_route: request.routeOptions.url ?? 'unmatched',
        http_response_status_code: reply.statusCode,
      });
    }
    done();
  });
}
