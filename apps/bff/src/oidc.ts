import { createHash } from 'node:crypto';

import { fetchWithTimeout } from '@revelation-srs/service-client';
import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from 'jose';

import type { BffConfig } from './config.js';
import { randomId } from './crypto.js';

/**
 * The BFF as a confidential OIDC client of Keycloak (ADR-026). The browser
 * is sent to the public issuer; the BFF reaches the token, keys and
 * revocation endpoints at the internal URL.
 */
export interface TokenSet { accessToken: string; refreshToken: string | null; idToken: string | null; expiresAt: number }

export class OidcError extends Error {
  constructor(message: string, public readonly status?: number, public readonly error?: string) { super(message); this.name = 'OidcError'; }
}

export class OidcClient {
  readonly #jwks;
  constructor(private readonly cfg: BffConfig) {
    this.#jwks = createRemoteJWKSet(new URL(`${cfg.oidcInternalUrl}/protocol/openid-connect/certs`), { timeoutDuration: 5_000 });
  }

  get redirectUri(): string { return `${this.cfg.appOrigin}/bff/auth/callback`; }

  /** The authorization request: code flow, PKCE S256, state and nonce; never offline_access. */
  authorizationRequest(): { url: string; state: string; nonce: string; verifier: string } {
    const state = randomId(), nonce = randomId(), verifier = randomId(48);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const q = new URLSearchParams({
      response_type: 'code', client_id: this.cfg.clientId, redirect_uri: this.redirectUri, scope: 'openid profile email',
      state, nonce, code_challenge: challenge, code_challenge_method: 'S256',
    });
    return { url: `${this.cfg.oidcIssuer}/protocol/openid-connect/auth?${q.toString()}`, state, nonce, verifier };
  }

  async exchangeCode(code: string, verifier: string): Promise<TokenSet> {
    return this.#token({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri, code_verifier: verifier });
  }

  async refresh(refreshToken: string): Promise<TokenSet> {
    return this.#token({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  /** Best effort: the session is ended locally whatever Keycloak answers. */
  async revoke(refreshToken: string): Promise<void> {
    await fetchWithTimeout(`${this.cfg.oidcInternalUrl}/protocol/openid-connect/revoke`, {
      method: 'POST', headers: this.#headers(), body: new URLSearchParams({ token: refreshToken, token_type_hint: 'refresh_token' }).toString(),
    }, 5_000).catch(() => undefined);
  }

  endSessionUrl(idToken: string | null): string {
    const q = new URLSearchParams({ client_id: this.cfg.clientId, post_logout_redirect_uri: `${this.cfg.appOrigin}/` });
    if (idToken) q.set('id_token_hint', idToken);
    return `${this.cfg.oidcIssuer}/protocol/openid-connect/logout?${q.toString()}`;
  }

  async verifyIdToken(idToken: string, nonce: string): Promise<JWTPayload> {
    const { payload } = await jwtVerify(idToken, this.#jwks, { issuer: this.cfg.oidcIssuer, audience: this.cfg.clientId, algorithms: ['RS256'] });
    if (payload['nonce'] !== nonce) throw new OidcError('ID token nonce does not match');
    return payload;
  }

  /** OIDC Back-Channel Logout 1.0 §2.6: a signed logout token naming a sid, with the logout event and no nonce. */
  async verifyLogoutToken(token: string): Promise<{ sid: string | undefined; sub: string | undefined }> {
    const { payload } = await jwtVerify(token, this.#jwks, { issuer: this.cfg.oidcIssuer, audience: this.cfg.clientId, algorithms: ['RS256'] });
    const events = payload['events'] as Record<string, unknown> | undefined;
    if (!events || !('http://schemas.openid.net/event/backchannel-logout' in events)) throw new OidcError('Not a logout token');
    if ('nonce' in payload) throw new OidcError('A logout token carries no nonce');
    const sid = typeof payload['sid'] === 'string' ? payload['sid'] : undefined;
    if (!sid && !payload.sub) throw new OidcError('A logout token names a sid or a sub');
    return { sid, sub: payload.sub };
  }

  #headers(): Record<string, string> {
    const basic = Buffer.from(`${encodeURIComponent(this.cfg.clientId)}:${encodeURIComponent(this.cfg.clientSecret)}`).toString('base64');
    return { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${basic}` };
  }

  async #token(form: Record<string, string>): Promise<TokenSet> {
    let res: Response;
    try {
      res = await fetchWithTimeout(`${this.cfg.oidcInternalUrl}/protocol/openid-connect/token`, {
        method: 'POST', headers: this.#headers(), body: new URLSearchParams(form).toString(),
      }, 10_000);
    } catch (err) {
      throw new OidcError(`Token endpoint unreachable: ${(err as Error).name}`);
    }
    const body = await res.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; id_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !body.access_token) throw new OidcError(`Token request refused: ${res.status}`, res.status, body.error);
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? null,
      idToken: body.id_token ?? null,
      expiresAt: Date.now() + (body.expires_in ?? 300) * 1000, // clock:allow — token expiry bookkeeping
    };
  }
}

/** The claims the SPA may see (never the token itself). */
export function sessionClaims(accessToken: string): Record<string, unknown> {
  const c = decodeJwt(accessToken);
  const roles = (c['realm_roles'] as string[] | undefined) ?? ((c['realm_access'] as { roles?: string[] } | undefined)?.roles) ?? (c['roles'] as string[] | undefined) ?? [];
  return {
    sub: c.sub ?? null,
    srsPersonId: str(c['srs_person_id']),
    tenantId: str(c['tenant_id']),
    roles,
    displayName: str(c['name']) ?? str(c['preferred_username']),
    email: str(c['email']),
  };
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
