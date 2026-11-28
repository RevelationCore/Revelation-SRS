import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

/**
 * The engagement proxy (enterprise readiness plan, item 1.8): core
 * authenticates first, forwards only allow-listed headers, streams the body
 * through untouched, and answers 504 when the attendance module is slow.
 */

interface Seen { method: string; url: string; headers: IncomingHttpHeaders; body: Buffer }

let ctx: TestApp;
let upstream: Server;
let seen: Seen[] = [];
let delayMs = 0;

beforeAll(async () => {
  upstream = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method!, url: req.url!, headers: req.headers, body: Buffer.concat(chunks) });
      setTimeout(() => {
        res.writeHead(201, { 'content-type': 'application/json', 'set-cookie': 'leak=1', 'x-internal': 'secret', location: '/api/v1/engagement/events/1' });
        res.end(JSON.stringify({ ok: true, received: Buffer.concat(chunks).length }));
      }, delayMs);
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const { port } = upstream.address() as AddressInfo;
  ctx = await startTestApp({ attendance: { url: `http://127.0.0.1:${port}`, timeoutMs: 300 } });
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
  upstream?.close();
});

beforeEach(() => { seen = []; delayMs = 0; });

describe('engagement proxy', () => {
  it('refuses an unauthenticated request in core, without calling the module', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/engagement/events' });
    expect(res.statusCode).toBe(401);
    const bad = await ctx.app.inject({ method: 'GET', url: '/api/v1/engagement/events', headers: { authorization: 'Bearer not-a-token' } });
    expect(bad.statusCode).toBe(401);
    expect(seen).toHaveLength(0);
  });

  it('forwards allow-listed headers only, and the JSON body byte for byte', async () => {
    const jwt = await ctx.makeJwt();
    const body = '{"b":2,  "a":1}';
    const res = await ctx.app.inject({
      method: 'POST', url: '/api/v1/engagement/events?source=test',
      headers: {
        authorization: `Bearer ${jwt}`, 'content-type': 'application/json', cookie: 'session=abc',
        'x-forwarded-for': '1.2.3.4', 'x-correlation-id': 'corr-1', 'x-evil': 'yes',
      },
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ok: true, received: body.length });
    expect(res.headers['location']).toBe('/api/v1/engagement/events/1');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers['x-internal']).toBeUndefined();

    expect(seen).toHaveLength(1);
    const [req] = seen;
    expect(req!.url).toBe('/api/v1/engagement/events?source=test');
    expect(req!.body.toString()).toBe(body);
    expect(req!.headers['authorization']).toBe(`Bearer ${jwt}`);
    expect(req!.headers['x-correlation-id']).toBe('corr-1');
    for (const h of ['cookie', 'x-forwarded-for', 'x-evil']) expect(req!.headers[h]).toBeUndefined();
  });

  it('passes a multipart upload through intact', async () => {
    const jwt = await ctx.makeJwt();
    const boundary = '----srs-test-boundary';
    const file = Buffer.from([0x00, 0xff, 0x10, 0x80, 0x0d, 0x0a, 0x2d, 0x2d]);
    const multipart = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nregister\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      file,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await ctx.app.inject({
      method: 'POST', url: '/api/v1/engagement/imports',
      headers: { authorization: `Bearer ${jwt}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipart,
    });
    expect(res.statusCode).toBe(201);
    expect(seen[0]!.headers['content-type']).toBe(`multipart/form-data; boundary=${boundary}`);
    expect(seen[0]!.body.equals(multipart)).toBe(true);
  });

  it('answers 504 when the module is too slow', async () => {
    delayMs = 1_000;
    const res = await ctx.app.inject({
      method: 'GET', url: '/api/v1/engagement/events', headers: { authorization: `Bearer ${await ctx.makeJwt()}` },
    });
    expect(res.statusCode).toBe(504);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
  });

  it('refuses a body over the limit with 413', async () => {
    const res = await ctx.app.inject({
      method: 'POST', url: '/api/v1/engagement/events',
      headers: { authorization: `Bearer ${await ctx.makeJwt()}`, 'content-type': 'application/json', 'content-length': String(26 * 1024 * 1024) },
      payload: '{}',
    });
    expect(res.statusCode).toBe(413);
    expect(seen).toHaveLength(0);
  });
});

describe('engagement proxy with the module down', () => {
  it('answers 502', async () => {
    const down = await startTestApp({ attendance: { url: 'http://127.0.0.1:9', timeoutMs: 1_000 } });
    try {
      const res = await down.app.inject({
        method: 'GET', url: '/api/v1/engagement/events', headers: { authorization: `Bearer ${await down.makeJwt()}` },
      });
      expect(res.statusCode).toBe(502);
    } finally {
      await down.teardown();
    }
  }, 120_000);
});
