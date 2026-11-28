import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';

const TEST_CONFIG: Config = {
  port:             3001,
  logLevel:         'silent',
  nodeEnv:          'test',
  documentScanner:  { mode: 'noop', clamdPort: 3310, timeoutMs: 30_000, maxConcurrency: 4 },
  databaseUrl:      'postgres://srs:srs@localhost:5432/srs_test',
  natsUrl:          'nats://localhost:4222',
  temporalAddress:  'localhost:7233',
  jwtSecret:        'test-secret-for-unit-tests',
  keycloakJwksUrl:  undefined,
  corsOrigins:      ['http://localhost:5173'],
};

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp(TEST_CONFIG);
  app.get('/api/v1/__test-protected', async (_req, reply) => {
    await reply.send({ ok: true });
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string; uptime: number }>();
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
  });

  it('does not require authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).not.toBe(401);
  });
});

describe('GET /ready', () => {
  it('returns a checks object', async () => {
    const res = await app.inject({ method: 'GET', url: '/ready' });
    const body = res.json<{ status: string; checks: Record<string, unknown> }>();
    expect(body).toHaveProperty('checks');
    expect(body).toHaveProperty('status');
  });

  it('does not require authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).not.toBe(401);
  });
});

describe('GET /metrics', () => {
  // ADR-035: metrics are served on the dedicated port 9464 (packages/telemetry),
  // never on the main port an Ingress routes to.
  it('is not served on the main port', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).not.toBe(200);
    expect(res.body).not.toContain('# TYPE');
  });
});

describe('Unauthenticated request to a protected route', () => {
  it('returns 401 when no token is provided', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/__test-protected' });
    expect(res.statusCode).toBe(401);
  });
});
