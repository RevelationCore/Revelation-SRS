import { readFileSync, statSync } from 'node:fs';

import { createClientAssertion, fetchWithTimeout, wellbeingServiceClientId } from '@revelation-srs/auth';

/**
 * Access tokens for the wellbeing service's hand-offs to core (ADR-029).
 *
 * Each tenant has its own Keycloak client, srs-wellbeing-svc-<tenantId>,
 * which puts that tenant in the token; the service never asserts a tenant
 * itself. Tokens are cached per tenant in memory and refreshed before they
 * expire; concurrent requests for one tenant share a single fetch. Tokens,
 * assertions and keys are never logged.
 */

export type ClientAuth =
  | { method: 'client_secret_basic'; secret: string }
  // keyId overrides the assertion's kid; by default it is the id Keycloak
  // gives the registered certificate's key (keycloakKeyId).
  | { method: 'private_key_jwt'; keyFile: string; keyId?: string | undefined };

export interface ServiceTokenProviderOptions {
  /** The realm's /protocol/openid-connect/token endpoint. */
  tokenUrl: string;
  auth:     ClientAuth;
  /** Token endpoint call limit (default 5 s). */
  timeoutMs?: number;
  now?:     () => number;
}

interface CachedToken { accessToken: string; expiresAt: number; refreshAt: number }

/** A token endpoint or credential failure: transient, so the outbox retries it. */
export class ServiceTokenError extends Error {
  constructor(message: string) { super(message); this.name = 'ServiceTokenError'; }
}

/** What the hand-off clients need from a token provider. */
export interface ServiceTokenSource {
  getToken(tenantId: string): Promise<string>;
  invalidate(tenantId: string): void;
}

export class ServiceTokenProvider implements ServiceTokenSource {
  readonly #cache = new Map<string, CachedToken>();
  readonly #inFlight = new Map<string, Promise<string>>();
  #key: { pem: string; mtimeMs: number } | null = null;

  constructor(private readonly opts: ServiceTokenProviderOptions) {}

  /** An access token for the tenant's own client, from cache when it is still fresh. */
  async getToken(tenantId: string): Promise<string> {
    const now = this.#now();
    const cached = this.#cache.get(tenantId);
    if (cached && now < cached.refreshAt) return cached.accessToken;
    const pending = this.#inFlight.get(tenantId);
    if (pending) return pending;
    const fetching = this.#fetch(tenantId).finally(() => this.#inFlight.delete(tenantId));
    this.#inFlight.set(tenantId, fetching);
    return fetching;
  }

  /** Drop the tenant's cached token, after core answered 401. */
  invalidate(tenantId: string): void {
    this.#cache.delete(tenantId);
  }

  #now(): number {
    return this.opts.now ? this.opts.now() : Date.now(); // clock:allow — token expiry bookkeeping
  }

  /** The realm issuer, the audience of a client assertion. */
  get #issuer(): string {
    return this.opts.tokenUrl.replace(/\/protocol\/openid-connect\/token\/?$/, '');
  }

  /** The private key, re-read when the file changes so a rotation needs no restart. */
  #privateKey(keyFile: string): string {
    const { mtimeMs } = statSync(keyFile);
    if (!this.#key || this.#key.mtimeMs !== mtimeMs) this.#key = { pem: readFileSync(keyFile, 'utf8'), mtimeMs };
    return this.#key.pem;
  }

  async #fetch(tenantId: string): Promise<string> {
    const clientId = wellbeingServiceClientId(tenantId);
    const form = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId });
    const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
    const auth = this.opts.auth;
    if (auth.method === 'client_secret_basic') {
      headers['authorization'] = `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(auth.secret)}`).toString('base64')}`;
    } else {
      form.set('client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
      form.set('client_assertion', await createClientAssertion({ clientId, audience: this.#issuer, privateKeyPem: this.#privateKey(auth.keyFile), keyId: auth.keyId }));
    }

    let res: Response;
    try {
      res = await fetchWithTimeout(this.opts.tokenUrl, { method: 'POST', headers, body: form.toString() }, this.opts.timeoutMs ?? 5_000);
    } catch (err) {
      throw new ServiceTokenError(`Token endpoint unreachable for ${clientId}: ${(err as Error).name}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const error = (() => { try { return (JSON.parse(body) as { error?: string }).error; } catch { return undefined; } })();
      throw new ServiceTokenError(`Token request for ${clientId} refused: ${res.status}${error ? ` ${error}` : ''}`);
    }
    const data = await res.json() as { access_token?: string; expires_in?: number };
    if (!data.access_token) throw new ServiceTokenError(`Token response for ${clientId} had no access_token`);

    // Refresh with 60 s or 20 % of the lifetime left, whichever comes first.
    const lifetime = (data.expires_in ?? 300) * 1000;
    const now = this.#now();
    this.#cache.set(tenantId, { accessToken: data.access_token, expiresAt: now + lifetime, refreshAt: now + lifetime - Math.max(60_000, lifetime * 0.2) });
    return data.access_token;
  }
}

/** Calls core with the tenant's token; after a 401, drops it and retries once (ADR-029). */
export async function callCoreAsService(tokens: ServiceTokenSource, tenantId: string, url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const token = await tokens.getToken(tenantId);
    const res = await fetchWithTimeout(url, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` } }, 10_000);
    if (res.status !== 401 || attempt > 0) return res;
    tokens.invalidate(tenantId);
  }
}
