import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

import { fetchWithTimeout } from '@revelation-srs/service-client';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { decodeJwt } from 'jose';
import type postgres from 'postgres';

import { assertSecureBffConfig, type BffConfig } from './config.js';
import { clearCookie, LOGIN_COOKIE, loginCookie, readCookie, SESSION_COOKIE, sessionCookie } from './cookies.js';
import { open, seal } from './crypto.js';
import { OidcClient, sessionClaims, type TokenSet } from './oidc.js';
import { SessionStore } from './session-store.js';

/**
 * The backend-for-frontend (ADR-026). The browser holds only an HTTP-only
 * session cookie; this service holds the tokens, refreshes them one at a
 * time, and proxies /bff/srs/* and /bff/wellbeing/* with the access token.
 */
export interface BffDeps { sql: postgres.Sql; oidc?: OidcClient }

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length']);
const NEVER_FORWARD = new Set(['cookie', 'authorization', 'origin', 'referer', 'x-srs-request']);

export async function buildBff(cfg: BffConfig, deps: BffDeps): Promise<FastifyInstance> {
  assertSecureBffConfig(cfg);
  const app = Fastify({ logger: { level: cfg.logLevel, redact: ['req.headers.cookie', 'req.headers.authorization'] }, bodyLimit: 25 * 1024 * 1024, trustProxy: 'uniquelocal' });
  const oidc = deps.oidc ?? new OidcClient(cfg);
  const store = new SessionStore(deps.sql, cfg, oidc);
  app.decorate('sessionStore', store);

  // Every body arrives as a buffer: the proxy forwards it unchanged (and can replay it once after a 401).
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  // CSRF (item 11): non-safe requests need our own Origin and X-SRS-Request: 1.
  // SameSite=Strict on the session cookie is the first layer.
  app.addHook('onRequest', async (req, reply) => {
    if (SAFE.has(req.method) || req.url === '/bff/auth/backchannel-logout') return;
    if (req.headers.origin !== cfg.appOrigin || req.headers['x-srs-request'] !== '1') {
      await reply.code(403).type('application/problem+json').send(problem(403, 'Cross-site request refused', req.url));
    }
  });

  app.get('/health', (_req, reply) => reply.send({ status: 'ok' }));
  app.get('/ready', async (_req, reply) => {
    try { await deps.sql`SELECT 1`; return { status: 'ready' }; } catch { return reply.code(503).send({ status: 'database unavailable' }); }
  });

  app.get('/bff/auth/login', async (req, reply) => {
    const returnTo = safeReturnTo((req.query as { returnTo?: string }).returnTo);
    const a = oidc.authorizationRequest();
    const sealed = seal(cfg.sessionKeys, JSON.stringify({ state: a.state, nonce: a.nonce, verifier: a.verifier, returnTo }));
    return reply.header('set-cookie', loginCookie(`${sealed.kid}.${sealed.value}`)).header('cache-control', 'no-store').redirect(a.url, 302);
  });

  app.get('/bff/auth/callback', async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    const raw = readCookie(req.headers.cookie, LOGIN_COOKIE);
    reply.header('set-cookie', clearCookie(LOGIN_COOKIE)).header('cache-control', 'no-store');
    let txn: { state: string; nonce: string; verifier: string; returnTo: string } | undefined;
    try {
      const dot = raw?.indexOf('.') ?? -1;
      txn = raw && dot > 0 ? JSON.parse(open(cfg.sessionKeys, raw.slice(0, dot), raw.slice(dot + 1))) as typeof txn : undefined;
    } catch { txn = undefined; }
    if (!txn || !q.state || q.state !== txn.state || !q.code) {
      return reply.code(400).type('application/problem+json').send(problem(400, q.error ? `Sign-in was not completed: ${q.error}` : 'Sign-in could not be verified; start again', req.url));
    }
    let tokens: TokenSet;
    let claims;
    try {
      tokens = await oidc.exchangeCode(q.code, txn.verifier);
      if (!tokens.idToken) throw new Error('no ID token');
      claims = await oidc.verifyIdToken(tokens.idToken, txn.nonce);
    } catch (err) {
      req.log.warn({ err: (err as Error).message }, 'Sign-in callback refused');
      return reply.code(400).type('application/problem+json').send(problem(400, 'Sign-in could not be verified; start again', req.url));
    }
    const cookie = await store.create(tokens, String(claims.sub), typeof claims['sid'] === 'string' ? claims['sid'] : null);
    return reply.header('set-cookie', [clearCookie(LOGIN_COOKIE), sessionCookie(cookie)]).redirect(txn.returnTo, 302);
  });

  app.get('/bff/session', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    const session = await store.get(readCookie(req.headers.cookie, SESSION_COOKIE));
    if (!session) return { authenticated: false };
    // Never the token: only the claims the SPA needs.
    return { authenticated: true, ...sessionClaims(session.tokens.accessToken), expiresAt: session.idleExpiresAt.toISOString() };
  });

  app.post('/bff/auth/logout', async (req, reply) => {
    const cookie = readCookie(req.headers.cookie, SESSION_COOKIE);
    const session = cookie ? await store.delete(cookie) : null;
    if (session?.tokens.refreshToken) await oidc.revoke(session.tokens.refreshToken);
    return reply.header('set-cookie', clearCookie(SESSION_COOKIE)).header('cache-control', 'no-store')
      .send({ endSessionUrl: oidc.endSessionUrl(session?.tokens.idToken ?? null) });
  });

  // Reached on the cluster network only; the SPA's nginx does not proxy it.
  app.post('/bff/auth/backchannel-logout', async (req, reply) => {
    const form = new URLSearchParams(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '');
    const token = form.get('logout_token');
    if (!token) return reply.code(400).send(problem(400, 'logout_token is required', req.url));
    try {
      const { sid, sub } = await oidc.verifyLogoutToken(token);
      const ended = await store.deleteBySid(sid, sub);
      req.log.info({ event: 'bff.backchannel.logout', ended }, 'Back-channel logout');
      return reply.code(200).header('cache-control', 'no-store').send();
    } catch (err) {
      req.log.warn({ err: (err as Error).message }, 'Back-channel logout token refused');
      return reply.code(400).send(problem(400, 'Invalid logout token', req.url));
    }
  });

  // Development and test only (item 14): a session from a development token, so
  // the "paste a token" sign-in and the end-to-end helpers need no browser storage.
  if (cfg.devSessions) {
    if (cfg.nodeEnv !== 'development' && cfg.nodeEnv !== 'test') throw new Error('BFF_DEV_SESSIONS is for development and test only (ADR-026)');
    app.post('/bff/dev/session', async (req, reply) => {
      const { token } = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '{}') as { token?: string };
      if (!token) return reply.code(400).send(problem(400, 'token is required', req.url));
      const c = decodeJwt(token);
      const cookie = await store.create({ accessToken: token, refreshToken: null, idToken: null, expiresAt: (c.exp ?? Math.floor(Date.now() / 1000) + 3600) * 1000 }, String(c.sub ?? 'dev'), null); // clock:allow
      return reply.header('set-cookie', sessionCookie(cookie)).send({ authenticated: true });
    });
  }

  for (const [name, base] of Object.entries(cfg.upstreams)) {
    const prefix = `/bff/${name}`;
    const handler = (req: FastifyRequest, reply: FastifyReply) => proxy(req, reply, prefix, base);
    app.all(`${prefix}/*`, handler);
  }

  async function proxy(req: FastifyRequest, reply: FastifyReply, prefix: string, base: string): Promise<FastifyReply> {
    const cookie = readCookie(req.headers.cookie, SESSION_COOKIE);
    let session = cookie ? await store.withFreshToken(cookie) : null;
    if (!cookie || !session) return reply.code(401).type('application/problem+json').send(problem(401, 'Sign in again', req.url));

    const target = `${base}${req.url.slice(prefix.length)}`;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined || HOP_BY_HOP.has(k) || NEVER_FORWARD.has(k)) continue;
      headers[k] = Array.isArray(v) ? v.join(', ') : v;
    }
    headers['x-request-id'] ??= req.id;
    const body = Buffer.isBuffer(req.body) && req.body.length > 0 ? req.body : undefined;
    const stream = String(req.headers.accept ?? '').includes('text/event-stream');
    // P-09: 30 s by default; the event stream relies on its own heartbeat instead.
    const timeout = stream ? 2_147_483_647 : cfg.proxyTimeoutMs;
    const send = (token: string) => fetchWithTimeout(target, {
      method: req.method, headers: { ...headers, authorization: `Bearer ${token}` }, ...(body ? { body } : {}), redirect: 'manual',
    }, timeout);

    let res: Response;
    try {
      res = await send(session.tokens.accessToken);
      if (res.status === 401) {
        session = await store.withFreshToken(cookie, 60, true);
        if (!session) return reply.code(401).type('application/problem+json').send(problem(401, 'Sign in again', req.url));
        await res.body?.cancel();
        res = await send(session.tokens.accessToken);
      }
    } catch (err) {
      req.log.warn({ err: (err as Error).message, target: prefix }, 'Upstream unavailable');
      return reply.code(502).type('application/problem+json').send(problem(502, 'The service is unavailable; try again', req.url));
    }
    reply.code(res.status);
    res.headers.forEach((value, key) => {
      if (!HOP_BY_HOP.has(key) && key !== 'set-cookie' && key !== 'content-encoding') void reply.header(key, value);
    });
    if (!res.body) return reply.send();
    return reply.send(Readable.fromWeb(res.body as WebReadableStream));
  }

  return app;
}

/** Only a relative path on this origin (no scheme, no //host). */
function safeReturnTo(value: string | undefined): string {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/';
}

function problem(status: number, detail: string, instance: string) {
  return { type: 'about:blank', title: detail, status, detail, instance };
}

declare module 'fastify' {
  interface FastifyInstance { sessionStore: SessionStore }
}
