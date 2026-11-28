import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

/**
 * BL-010 (readiness 2.2, ADR-027): readiness depends on the database only.
 * A NATS outage took every API pod out of service, even though the API can
 * serve records without the broker. The test app's event bus is the
 * default disconnected NATS publisher, which is exactly a NATS outage.
 */

let ctx: TestApp;

beforeAll(async () => { ctx = await startTestApp(); }, 120_000);
afterAll(async () => { await ctx?.teardown(); });

describe('GET /ready', () => {
  it('is ready with the database up and NATS down, and still reports NATS', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string; checks: Record<string, { status: string; required?: boolean }> }>();
    expect(body.status).toBe('ok');
    expect(body.checks['database']).toMatchObject({ status: 'ok' });
    expect(body.checks['nats']).toMatchObject({ status: 'error', required: false });
  });
});
