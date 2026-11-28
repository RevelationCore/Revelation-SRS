/**
 * ADR-026 guards for the backend-for-frontend: cookie attributes, CSRF,
 * one refresh across two instances, logout and back-channel logout, no
 * token ever returned to the browser, and the development-only route.
 */
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildBff } from '../src/app.js';
import { loadConfig, type BffConfig } from '../src/config.js';

import { startFakeKeycloak, type FakeKeycloak } from './fake-keycloak.js';

const ORIGIN = 'http://app.test';
const CLIENT = { clientId: 'srs-admin', clientSecret: 'test-secret' };

let pg: StartedPostgreSqlContainer;
let sql: postgres.Sql;
let kc: FakeKeycloak;
let upstream: Server;
let upstreamUrl: string;
const upstreamCalls: Array<{ method: string; url: string; authorization: string | undefined; cookie: string | undefined; body: string }> = [];
let failNext401 = 0;

function config(overrides: Partial<BffConfig> = {}): BffConfig {
  return {
    ...loadConfig({ NODE_ENV: 'test' }),
    logLevel: 'silent', appOrigin: ORIGIN, ...CLIENT, oidcIssuer: kc.issuer, oidcInternalUrl: kc.issuer,
    upstreams: { srs: upstreamUrl, wellbeing: upstreamUrl }, ...overrides,
  };
}

beforeAll(async () => {
  pg = await new PostgreSqlContainer('postgres:16-alpine').start();
  sql = postgres(pg.getConnectionUri(), { max: 10 });
  await sql.unsafe(await readFile(join(dirname(fileURLToPath(import.meta.url)), '../migrations/0001_bff_sessions.sql'), 'utf8'));
  kc = await startFakeKeycloak(CLIENT);
  upstream = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', () => {
      upstreamCalls.push({ method: req.method ?? '', url: req.url ?? '', authorization: req.headers.authorization, cookie: req.headers.cookie, body });
      if (failNext401 > 0) { failNext401--; res.writeHead(401); res.end(); return; }
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'upstream=1' });
      res.end(JSON.stringify({ ok: true, url: req.url }));
    });
  });
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()));
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
}, 180_000);

afterAll(async () => {
  await kc?.close();
  await new Promise<void>((r) => upstream?.close(() => r()));
  await sql?.end();
  await pg?.stop();
});

/** Signs in through the real flow: login → fake Keycloak → callback. Returns the session cookie. */
async function signIn(app: FastifyInstance, returnTo = '/students', expectedLocation = returnTo): Promise<{ cookie: string; setCookies: string[] }> {
  const login = await app.inject({ method: 'GET', url: `/bff/auth/login?returnTo=${encodeURIComponent(returnTo)}` });
  expect(login.statusCode).toBe(302);
  const loginCookie = String(login.headers['set-cookie']).split(';')[0]!;
  const auth = await fetch(String(login.headers.location), { redirect: 'manual' });
  const callback = new URL(auth.headers.get('location')!);
  const cb = await app.inject({ method: 'GET', url: `${callback.pathname}${callback.search}`, headers: { cookie: loginCookie } });
  expect(cb.statusCode, cb.body).toBe(302);
  expect(cb.headers.location).toBe(expectedLocation);
  const setCookies = ([] as string[]).concat(cb.headers['set-cookie'] as string | string[]);
  const session = setCookies.find((c) => c.startsWith('__Host-srs_session='))!;
  return { cookie: session.split(';')[0]!, setCookies };
}

const write = { origin: ORIGIN, 'x-srs-request': '1' };

describe('sign-in and cookies (ADR-026 items 3 and 4)', () => {
  it('sets a host-only, HttpOnly, Secure, SameSite=Strict session cookie and a short Lax login cookie', async () => {
    const app = await buildBff(config(), { sql });
    const login = await app.inject({ method: 'GET', url: '/bff/auth/login?returnTo=/x' });
    const lc = String(login.headers['set-cookie']);
    expect(lc).toMatch(/^__Host-srs_login=/);
    expect(lc).toContain('HttpOnly'); expect(lc).toContain('Secure'); expect(lc).toContain('SameSite=Lax'); expect(lc).toContain('Max-Age=600');
    expect(String(login.headers.location)).toContain('code_challenge_method=S256');
    expect(String(login.headers.location)).not.toContain('offline_access');

    const { setCookies } = await signIn(app);
    const sc = setCookies.find((c) => c.startsWith('__Host-srs_session='))!;
    for (const attr of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) expect(sc).toContain(attr);
    expect(sc).not.toMatch(/Domain=/i);
    expect(setCookies.some((c) => c.startsWith('__Host-srs_login=;') && c.includes('Max-Age=0'))).toBe(true);
    await app.close();
  });

  it('refuses a callback whose state does not match, and keeps returnTo on this origin', async () => {
    const app = await buildBff(config(), { sql });
    const login = await app.inject({ method: 'GET', url: '/bff/auth/login' });
    const cb = await app.inject({ method: 'GET', url: '/bff/auth/callback?code=x&state=forged', headers: { cookie: String(login.headers['set-cookie']).split(';')[0]! } });
    expect(cb.statusCode).toBe(400);
    const { cookie } = await signIn(app, '//evil.example/steal', '/');
    expect(cookie).toBeTruthy();
    await app.close();
  }, 30_000);

  it('/bff/session returns who is signed in, and never a token', async () => {
    const app = await buildBff(config(), { sql });
    const { cookie } = await signIn(app);
    const res = await app.inject({ method: 'GET', url: '/bff/session', headers: { cookie } });
    const body = res.json<Record<string, unknown>>();
    expect(body).toMatchObject({ authenticated: true, sub: 'user-1', tenantId: 'tenant-1', roles: ['registry-administrator'], displayName: 'Sam Registrar' });
    expect(res.body).not.toMatch(/eyJ[\w-]+\.[\w-]+\.[\w-]+/); // no JWT anywhere
    const [row] = await sql<Array<{ tokens: string }>>`SELECT tokens FROM bff.session ORDER BY created_at DESC LIMIT 1`;
    expect(row!.tokens).not.toContain('eyJ'); // encrypted at rest
    expect((await app.inject({ method: 'GET', url: '/bff/session' })).json()).toEqual({ authenticated: false });
    await app.close();
  });
});

describe('CSRF (ADR-026 item 11)', () => {
  it('refuses non-safe requests without our Origin and the X-SRS-Request header', async () => {
    const app = await buildBff(config(), { sql });
    const { cookie } = await signIn(app);
    const post = (headers: Record<string, string>) => app.inject({ method: 'POST', url: '/bff/srs/api/v1/things', headers: { cookie, 'content-type': 'application/json', ...headers }, payload: '{"a":1}' });
    expect((await post({})).statusCode).toBe(403);
    expect((await post({ origin: 'https://evil.example', 'x-srs-request': '1' })).statusCode).toBe(403);
    expect((await post({ origin: ORIGIN })).statusCode).toBe(403);
    const ok = await post(write);
    expect(ok.statusCode, ok.body).toBe(200);
    await app.close();
  });
});

describe('the proxy (ADR-026 item 8)', () => {
  it('forwards with the access token, never the cookie, and drops upstream cookies', async () => {
    const app = await buildBff(config(), { sql });
    const { cookie } = await signIn(app);
    upstreamCalls.length = 0;
    const res = await app.inject({ method: 'POST', url: '/bff/wellbeing/api/v1/cases?x=1', headers: { cookie, ...write, 'content-type': 'application/json' }, payload: '{"b":2}' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    const call = upstreamCalls[0]!;
    expect(call).toMatchObject({ method: 'POST', url: '/api/v1/cases?x=1', body: '{"b":2}' });
    expect(call.authorization).toMatch(/^Bearer eyJ/);
    expect(call.cookie).toBeUndefined();
    expect((await app.inject({ method: 'GET', url: '/bff/srs/api/v1/x' })).statusCode).toBe(401);
    await app.close();
  });

  it('forwards only allow-listed public paths without a session, and with no token', async () => {
    const app = await buildBff(config(), { sql });
    upstreamCalls.length = 0;
    const res = await app.inject({ method: 'GET', url: '/bff/srs/api/v1/demo/status' });
    expect(res.statusCode).toBe(200);
    expect(upstreamCalls[0]).toMatchObject({ url: '/api/v1/demo/status', authorization: undefined });
    expect((await app.inject({ method: 'GET', url: '/bff/wellbeing/api/v1/demo/status' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/bff/srs/api/v1/demo/status/../students' })).statusCode).toBe(401);
    await app.close();
  });

  it('after an upstream 401, refreshes once and retries once', async () => {
    const app = await buildBff(config(), { sql });
    const { cookie } = await signIn(app);
    const before = kc.refreshes;
    failNext401 = 1;
    const res = await app.inject({ method: 'GET', url: '/bff/srs/api/v1/x', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(kc.refreshes - before).toBe(1);
    await app.close();
  });
});

describe('refresh (ADR-026 item 6)', () => {
  it('two instances refreshing one session at once make one refresh, and no refresh token is replayed', async () => {
    kc.accessLifetime = 30; // inside the 60 s window: every request wants a refresh
    const a = await buildBff(config(), { sql });
    const b = await buildBff(config(), { sql });
    try {
      const { cookie } = await signIn(a);
      const refreshesBefore = kc.refreshes;
      const refusedBefore = kc.refused;
      kc.accessLifetime = 300;
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? a : b).inject({ method: 'GET', url: '/bff/srs/api/v1/x', headers: { cookie } })));
      expect(results.map((r) => r.statusCode)).toEqual(Array(8).fill(200));
      expect(kc.refreshes - refreshesBefore).toBe(1);
      expect(kc.refused - refusedBefore).toBe(0);
    } finally {
      kc.accessLifetime = 300;
      await a.close(); await b.close();
    }
  });
});

describe('logout (ADR-026 item 9)', () => {
  it('deletes the session, revokes the refresh token and returns the end-session URL', async () => {
    const app = await buildBff(config(), { sql });
    const { cookie } = await signIn(app);
    const res = await app.inject({ method: 'POST', url: '/bff/auth/logout', headers: { cookie, ...write } });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ endSessionUrl: string }>().endSessionUrl).toContain('id_token_hint=');
    expect(String(res.headers['set-cookie'])).toMatch(/__Host-srs_session=;.*Max-Age=0/);
    expect(kc.revoked.length).toBeGreaterThan(0);
    expect((await app.inject({ method: 'GET', url: '/bff/srs/api/v1/x', headers: { cookie } })).statusCode).toBe(401);
    await app.close();
  });

  it('back-channel logout ends every session with the Keycloak sid', async () => {
    const app = await buildBff(config(), { sql });
    const one = await signIn(app);
    const two = await signIn(app);
    const sid = (await sql<Array<{ sid: string }>>`SELECT sid FROM bff.session ORDER BY created_at DESC LIMIT 1`)[0]!.sid;
    const forged = await app.inject({ method: 'POST', url: '/bff/auth/backchannel-logout', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'logout_token=not.a.token' });
    expect(forged.statusCode).toBe(400);
    const token = await kc.logoutToken({ sid }, CLIENT.clientId);
    const res = await app.inject({ method: 'POST', url: '/bff/auth/backchannel-logout', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: `logout_token=${token}` });
    expect(res.statusCode).toBe(200);
    for (const s of [one, two]) expect((await app.inject({ method: 'GET', url: '/bff/session', headers: { cookie: s.cookie } })).json()).toEqual({ authenticated: false });
    await app.close();
  });
});

describe('development sessions (ADR-026 item 14)', () => {
  it('are created from a development token in test, and refused outside development and test', async () => {
    const app = await buildBff(config({ devSessions: true }), { sql });
    const token = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'dev-user', roles: ['student'], exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url')}.sig`;
    const res = await app.inject({ method: 'POST', url: '/bff/dev/session', headers: { ...write, 'content-type': 'application/json' }, payload: JSON.stringify({ token }) });
    expect(res.statusCode).toBe(200);
    const cookie = String(res.headers['set-cookie']).split(';')[0]!;
    expect((await app.inject({ method: 'GET', url: '/bff/session', headers: { cookie } })).json()).toMatchObject({ authenticated: true, sub: 'dev-user' });
    await app.close();

    await expect(buildBff(config({ nodeEnv: 'production', devSessions: true }), { sql })).rejects.toThrow(/BFF_DEV_SESSIONS is for development and test only/);
    const off = await buildBff(config(), { sql });
    expect((await off.inject({ method: 'POST', url: '/bff/dev/session', headers: write, payload: '{}' })).statusCode).toBe(404);
    await off.close();
  });

  it('refuses insecure production configuration', async () => {
    await expect(buildBff(config({ nodeEnv: 'production' }), { sql })).rejects.toThrow(/Refusing to start srs-bff/);
  });
});
