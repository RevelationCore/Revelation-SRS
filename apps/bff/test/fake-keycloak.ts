import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from 'jose';

/**
 * A minimal Keycloak for the BFF tests: authorize redirects with a code,
 * the token endpoint issues RS256 tokens and rotates refresh tokens (a
 * reused one is refused, as with revokeRefreshToken), revoke is recorded,
 * and logout tokens can be minted.
 */
export interface FakeKeycloak {
  issuer: string;
  refreshes: number;
  refused: number;
  revoked: string[];
  accessLifetime: number;
  logoutToken(claims: { sid?: string; sub?: string }, clientId: string): Promise<string>;
  close(): Promise<void>;
}

export async function startFakeKeycloak(opts: { clientId: string; clientSecret: string; sub?: string }): Promise<FakeKeycloak> {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const codes = new Map<string, { nonce: string; redirectUri: string; challenge: string }>();
  const live = new Set<string>();
  const used = new Set<string>();
  const sid = randomUUID();
  let issuer = '';

  const state: FakeKeycloak = {
    issuer: '', refreshes: 0, refused: 0, revoked: [], accessLifetime: 300,
    logoutToken: (claims, clientId) => sign(privateKey, { iss: issuer, aud: clientId, iat: now(), jti: randomUUID(), events: { 'http://schemas.openid.net/event/backchannel-logout': {} }, ...claims }, 120),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };

  const tokens = async (nonce?: string) => {
    const refresh = randomUUID();
    live.add(refresh);
    return {
      access_token: await sign(privateKey, { iss: issuer, sub: opts.sub ?? 'user-1', azp: opts.clientId, sid, realm_roles: ['registry-administrator'], tenant_id: 'tenant-1', name: 'Sam Registrar', email: 'sam@example.ac.uk' }, state.accessLifetime),
      refresh_token: refresh,
      id_token: await sign(privateKey, { iss: issuer, aud: opts.clientId, sub: opts.sub ?? 'user-1', sid, ...(nonce ? { nonce } : {}) }, 300),
      expires_in: state.accessLifetime,
      token_type: 'Bearer',
    };
  };

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://x');
      const path = url.pathname.replace('/realms/srs/protocol/openid-connect', '');
      const json = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (path === '/certs') return json(200, { keys: [jwk] });
      if (path === '/auth') {
        const p = url.searchParams;
        if (p.get('client_id') !== opts.clientId || p.get('code_challenge_method') !== 'S256' || (p.get('scope') ?? '').includes('offline_access')) return json(400, { error: 'invalid_request' });
        const code = randomUUID();
        codes.set(code, { nonce: p.get('nonce') ?? '', redirectUri: p.get('redirect_uri') ?? '', challenge: p.get('code_challenge') ?? '' });
        res.writeHead(302, { location: `${p.get('redirect_uri')}?code=${code}&state=${p.get('state')}` });
        return res.end();
      }
      const basic = Buffer.from(String(req.headers.authorization ?? '').replace(/^Basic /, ''), 'base64').toString();
      if (basic !== `${opts.clientId}:${opts.clientSecret}`) return json(401, { error: 'invalid_client' });
      const form = new URLSearchParams(await body(req));
      if (path === '/revoke') { state.revoked.push(form.get('token') ?? ''); res.writeHead(200); return res.end(); }
      if (path === '/token') {
        if (form.get('grant_type') === 'authorization_code') {
          const c = codes.get(form.get('code') ?? '');
          codes.delete(form.get('code') ?? '');
          const { createHash } = await import('node:crypto');
          if (!c || c.redirectUri !== form.get('redirect_uri') || createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') !== c.challenge) return json(400, { error: 'invalid_grant' });
          return json(200, await tokens(c.nonce));
        }
        if (form.get('grant_type') === 'refresh_token') {
          const rt = form.get('refresh_token') ?? '';
          // Rotation: a refresh token works once; reusing one is refused.
          if (!live.has(rt) || used.has(rt)) { state.refused++; return json(400, { error: 'invalid_grant' }); }
          used.add(rt); live.delete(rt); state.refreshes++;
          await new Promise((r) => setTimeout(r, 50)); // a slow token endpoint widens any race
          return json(200, await tokens());
        }
      }
      return json(404, { error: 'not found' });
    })();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}/realms/srs`;
  state.issuer = issuer;
  return state;
}

const now = () => Math.floor(Date.now() / 1000);
function sign(key: KeyLike, claims: Record<string, unknown>, lifetime: number): Promise<string> {
  return new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuedAt().setExpirationTime(now() + lifetime).sign(key);
}
function body(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => { let b = ''; req.on('data', (c: Buffer) => { b += c.toString(); }); req.on('end', () => resolve(b)); });
}
