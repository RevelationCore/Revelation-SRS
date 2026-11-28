import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_METRICS_PORT, httpServerMetrics, loadTelemetryConfig, resolveMetricsPort, startTelemetry, type Telemetry } from '../src/index.js';

/** ADR-035 items 1 to 3 (BL-420): one bootstrap, Prometheus on its own port, HTTP metrics with a bounded route. */
const port = 19000 + Math.floor(Math.random() * 1000);
let telemetry: Telemetry;

beforeAll(() => { telemetry = startTelemetry({ serviceName: 'srs-telemetry-test', metricsPort: port, otlpEndpoint: '' }); });
afterAll(async () => { await telemetry.shutdown(); });

async function scrape(): Promise<string> {
  // The exporter collects on scrape; give the histogram a moment to be registered.
  const res = await fetch(`http://127.0.0.1:${port}/metrics`);
  expect(res.status).toBe(200);
  return res.text();
}

describe('startTelemetry', () => {
  it('serves Prometheus metrics on the dedicated port, with runtime metrics', async () => {
    expect(telemetry.metricsPort).toBe(port);
    const body = await scrape();
    expect(body).toMatch(/nodejs_eventloop|v8js_/);
  });

  it('labels target_info with the service, never the command line or the host', async () => {
    const info = (await scrape()).split('\n').find((l) => l.startsWith('target_info{')) ?? '';
    expect(info).toContain('service_name="srs-telemetry-test"');
    expect(info).not.toMatch(/process_command|host_name|process_owner/);
  });

  it('takes the port from METRICS_PORT, defaults to 9464, and refuses a non-port', () => {
    expect(resolveMetricsPort(undefined, {})).toBe(DEFAULT_METRICS_PORT);
    expect(resolveMetricsPort(undefined, { METRICS_PORT: '9500' })).toBe(9500);
    expect(resolveMetricsPort(undefined, { METRICS_PORT: '0' })).toBe(0);
    expect(() => resolveMetricsPort(undefined, { METRICS_PORT: 'abc' })).toThrow(/METRICS_PORT/);
  });

  it('reads the OTLP endpoint, refusing anything but an http(s) URL', () => {
    expect(loadTelemetryConfig({})).toEqual({ metricsPort: DEFAULT_METRICS_PORT, otlpEndpoint: undefined });
    expect(loadTelemetryConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://srs-tempo:4318/' }).otlpEndpoint).toBe('http://srs-tempo:4318');
    expect(() => loadTelemetryConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: 'srs-tempo:4318' })).toThrow(/http\(s\) URL/);
    expect(() => loadTelemetryConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: 'not a url' })).toThrow(/http\(s\) URL/);
  });
});

describe('httpServerMetrics', () => {
  it('records the route template, never the raw path; unmatched routes as unmatched; hidden routes not at all', async () => {
    const app = Fastify();
    httpServerMetrics(app);
    app.get('/students/:personId', () => ({ ok: true }));
    app.get('/health', { schema: { hide: true } }, () => ({ ok: true }));
    await app.ready();
    await app.inject({ method: 'GET', url: '/students/0b6a1d2e-1111-4222-8333-444455556666' });
    await app.inject({ method: 'GET', url: '/students/another-id' });
    await app.inject({ method: 'GET', url: '/no/such/path' });
    await app.inject({ method: 'GET', url: '/health' });
    await app.close();

    const body = await scrape();
    const lines = body.split('\n').filter((l) => l.startsWith('http_server_request_duration_count'));
    expect(lines.some((l) => l.includes('http_route="/students/:personId"') && l.includes('http_response_status_code="200"') && / 2$/.test(l))).toBe(true);
    expect(lines.some((l) => l.includes('http_route="unmatched"') && l.includes('http_response_status_code="404"'))).toBe(true);
    expect(body).not.toContain('0b6a1d2e-1111-4222-8333-444455556666');
    expect(body).not.toContain('another-id');
    expect(lines.some((l) => l.includes('/health'))).toBe(false);
    expect(body).toMatch(/http_server_request_duration_bucket\{[^}]*le="0.005"/);
  });
});
