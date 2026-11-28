import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { trustProxySetting } from '../src/config.js';

import { startTestApp, type TestApp } from './helpers/test-app.js';

/**
 * BL-168: behind the ingress the API must see the caller's address, or every
 * per-IP limit (the public verification limit among them) is one budget
 * shared by everyone. The ingress pod, on a private address, is the socket
 * peer; it records the real client in X-Forwarded-For.
 */

const INGRESS = '10.42.0.7';
const LIMIT = Number(process.env['PUBLIC_VERIFY_RATE_LIMIT'] ?? 30);

async function remaining(app: TestApp['app'], peer: string, xff?: string): Promise<number> {
  const res = await app.inject({
    method: 'GET', url: '/public/v1/verify/no-such-tenant/ABCD-1234', remoteAddress: peer,
    ...(xff !== undefined ? { headers: { 'x-forwarded-for': xff } } : {}),
  });
  expect(res.statusCode).not.toBe(429);
  return Number(res.headers['x-ratelimit-remaining']);
}

describe('TRUST_PROXY setting', () => {
  it('is off by default and takes proxy addresses, CIDRs or named ranges', () => {
    expect(trustProxySetting(undefined)).toBe(false);
    expect(trustProxySetting('')).toBe(false);
    expect(trustProxySetting('false')).toBe(false);
    expect(trustProxySetting('uniquelocal')).toBe('uniquelocal');
    expect(trustProxySetting(' 10.42.0.0/16, 127.0.0.1 ')).toBe('10.42.0.0/16, 127.0.0.1');
  });

  it('refuses true, and a hop count that Fastify would silently ignore', () => {
    expect(() => trustProxySetting('true')).toThrow(/any client choose its IP/);
    expect(() => trustProxySetting('1')).toThrow(/hop count, which Fastify ignores/);
  });
});

describe('behind the ingress (TRUST_PROXY=uniquelocal)', () => {
  let ctx: TestApp;
  beforeAll(async () => { ctx = await startTestApp({ trustProxy: 'uniquelocal' }); }, 120_000);
  afterAll(async () => { await ctx?.teardown(); });

  it('gives each caller its own budget', async () => {
    expect(await remaining(ctx.app, INGRESS, '203.0.113.1')).toBe(LIMIT - 1);
    expect(await remaining(ctx.app, INGRESS, '203.0.113.1')).toBe(LIMIT - 2);
    expect(await remaining(ctx.app, INGRESS, '203.0.113.2')).toBe(LIMIT - 1);
  });

  it('ignores addresses a client adds itself in front of the ingress', async () => {
    // Walking back from the ingress, the first untrusted address is the caller.
    expect(await remaining(ctx.app, INGRESS, '198.51.100.9, 203.0.113.3')).toBe(LIMIT - 1);
    expect(await remaining(ctx.app, INGRESS, '198.51.100.10, 203.0.113.3')).toBe(LIMIT - 2);
  });

  it('ignores X-Forwarded-For from a peer that is not a trusted proxy', async () => {
    expect(await remaining(ctx.app, '192.0.2.50', '203.0.113.4')).toBe(LIMIT - 1);
    expect(await remaining(ctx.app, '192.0.2.50', '203.0.113.5')).toBe(LIMIT - 2);
  });
});

describe('with no proxy trusted (the default)', () => {
  let ctx: TestApp;
  beforeAll(async () => { ctx = await startTestApp(); }, 120_000);
  afterAll(async () => { await ctx?.teardown(); });

  it('ignores X-Forwarded-For, so a client cannot pick its own budget', async () => {
    expect(await remaining(ctx.app, INGRESS, '203.0.113.1')).toBe(LIMIT - 1);
    expect(await remaining(ctx.app, INGRESS, '203.0.113.2')).toBe(LIMIT - 2);
  });
});
