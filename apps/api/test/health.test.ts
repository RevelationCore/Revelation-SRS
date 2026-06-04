import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';

const TEST_CONFIG: Config = {
  port:             3001,
  logLevel:         'silent',
  nodeEnv:          'test',
  databaseUrl:      'postgres://srs:srs@localhost:5432/srs_test',
  natsUrl:          'nats://localhost:4222',
  temporalAddress:  'localhost:7233',
  jwtSecret:        'test-secret-for-unit-tests',
  keycloakJwksUrl:  undefined,
  corsOrigins:      ['http://localhost:5173'],
  otelEndpoint:     undefined,
  otelServiceName:  'srs-api-test',
};

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp(TEST_CONFIG);
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

describe('Unauthenticated request to a protected route', () => {
  it('returns 401 when no token is provided', async () => {
    // Register a protected test route
    app.get('/api/v1/__test-protected', async (_req, reply) => {
      await reply.send({ ok: true });
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/__test-protected' });
    expect(res.statusCode).toBe(401);
  });
});
