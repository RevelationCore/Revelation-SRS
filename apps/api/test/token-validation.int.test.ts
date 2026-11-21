import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHmac } from 'node:crypto';

import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

/**
 * Strict token validation (enterprise readiness plan, item 1.5). With a JWKS
 * configured the API accepts only RS256 tokens from the pinned issuer for
 * its own audience, within a small clock tolerance; anything else is a 401.
 */

const ISSUER = 'http://keycloak.test/realms/srs';
const KID = 'test-key';

let ctx: TestApp;
let jwks: Server;
let privateKey: KeyLike;
let otherKey: KeyLike;

const now = () => Math.floor(Date.now() / 1000);

function sign(claims: Record<string, unknown>, opts: { key?: KeyLike; kid?: string } = {}) {
  return new SignJWT({
    tenant_id: ctx.tenantId, realm_roles: ['registry-administrator'], ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: opts.kid ?? KID })
    .setSubject('rs256-user')
    .setIssuer((claims['iss'] as string | undefined) ?? ISSUER)
    .setAudience((claims['aud'] as string | string[] | undefined) ?? 'srs-api')
    .setIssuedAt((claims['iat'] as number | undefined) ?? now())
    .setExpirationTime((claims['exp'] as number | undefined) ?? now() + 300)
    .sign(opts.key ?? privateKey);
}

async function status(token: string): Promise<number> {
  const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/value-sets', headers: { authorization: `Bearer ${token}` } });
  return res.statusCode;
}

beforeAll(async () => {
  // The served key set holds only the public half of privateKey.
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair('RS256')).privateKey;
  const publicKey = pair.publicKey;
  const served = { keys: [{ ...(await exportJWK(publicKey)), kid: KID, alg: 'RS256', use: 'sig' }] };
  jwks = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(served)); });
  await new Promise<void>((resolve) => jwks.listen(0, '127.0.0.1', resolve));
  const { port } = jwks.address() as AddressInfo;

  ctx = await startTestApp({
    auth: { keycloakJwksUrl: `http://127.0.0.1:${port}/realms/srs/protocol/openid-connect/certs`, keycloakIssuer: ISSUER },
  });
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
  jwks?.close();
});

describe('token validation with Keycloak keys', () => {
  it('accepts an RS256 token from the pinned issuer for this audience', async () => {
    expect(await status(await sign({}))).toBe(200);
    expect(await status(await sign({ aud: ['account', 'srs-api'] }))).toBe(200);
  });

  it('refuses another issuer', async () => {
    expect(await status(await sign({ iss: 'http://evil.test/realms/srs' }))).toBe(401);
  });

  it('refuses another audience, or a token for a different service', async () => {
    expect(await status(await sign({ aud: 'account' }))).toBe(401);
    expect(await status(await sign({ aud: 'srs-wellbeing' }))).toBe(401);
  });

  it('refuses a key the JWKS does not hold', async () => {
    expect(await status(await sign({}, { key: otherKey }))).toBe(401);
  });

  it('refuses any algorithm but RS256: HS256 with the old secret, and none', async () => {
    const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      sub: 'x', tenant_id: ctx.tenantId, realm_roles: ['registry-administrator'],
      iss: ISSUER, aud: 'srs-api', iat: now(), exp: now() + 300,
    })).toString('base64url');
    const hs = `${header}.${payload}.${createHmac('sha256', 'test-secret-for-phase4-int-tests').update(`${header}.${payload}`).digest('base64url')}`;
    expect(await status(hs)).toBe(401);
    const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${payload}.`;
    expect(await status(none)).toBe(401);
  });

  it('allows 30 seconds of clock skew, and no more', async () => {
    expect(await status(await sign({ exp: now() - 10 }))).toBe(200);
    expect(await status(await sign({ exp: now() - 120 }))).toBe(401);
  });
});
