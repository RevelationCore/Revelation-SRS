/**
 * refreshFromStorage (ADR-026, BL-159): with refresh-token rotation, tabs
 * sharing one session must never refresh concurrently, because Keycloak
 * treats a reused refresh token as theft and revokes its replacement too
 * (measured against Keycloak 26.0.7: the reuse gets "Maximum allowed refresh
 * token reuse exceeded" and the newer token then gets "Session doesn't have
 * required client").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { refreshFromStorage, type OidcConfig, type RefreshLocks } from '../src/auth/oidc.js';

const cfg: OidcConfig = { keycloakUrl: 'http://kc', realm: 'srs', clientId: 'srs-admin', redirectUri: 'http://app/callback' };
const keys = { access: 'test_access', refresh: 'test_refresh' };

function jwt(expInSeconds: number, n: number): string {
  const body = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expInSeconds, n })).toString('base64url');
  return `h.${body}.s`;
}

/** A Keycloak token endpoint with rotation and reuse revocation. */
function fakeKeycloak() {
  let issued = 0;
  let current = 'rt-0';
  let revoked = false;
  const requests: string[] = [];
  const fetchFn = vi.fn(async (_url: string, init: { body: string }) => {
    const presented = new URLSearchParams(init.body).get('refresh_token') ?? '';
    requests.push(presented);
    await new Promise((r) => setTimeout(r, 5));
    if (revoked || presented !== current) {
      revoked = true; // reuse ends the session, including the newest token
      return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    }
    issued++;
    current = `rt-${issued}`;
    return new Response(JSON.stringify({ access_token: jwt(300, issued), refresh_token: current, expires_in: 300 }), { status: 200 });
  });
  return { fetchFn, requests, get revoked() { return revoked; } };
}

/** An in-process stand-in for navigator.locks: one holder per name at a time. */
function fakeLocks(): RefreshLocks {
  const tails = new Map<string, Promise<unknown>>();
  return {
    request<T>(name: string, callback: () => Promise<T>): Promise<T> {
      const prev = tails.get(name) ?? Promise.resolve();
      const next = prev.then(callback, callback);
      tails.set(name, next.catch(() => undefined));
      return next;
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(keys.access, jwt(30, 0)); // 30 s left: both tabs want to refresh
  localStorage.setItem(keys.refresh, 'rt-0');
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('refreshFromStorage', () => {
  it('lets only one of two tabs refresh; the other uses the new tokens', async () => {
    const kc = fakeKeycloak();
    vi.stubGlobal('fetch', kc.fetchFn);
    const locks = fakeLocks();

    const [tabA, tabB] = await Promise.all([
      refreshFromStorage(cfg, keys, { locks }),
      refreshFromStorage(cfg, keys, { locks }),
    ]);

    expect(kc.requests).toEqual(['rt-0']);
    expect(kc.revoked).toBe(false);
    expect(tabA.refreshToken).toBe('rt-1');
    expect({ access: tabB.accessToken, refresh: tabB.refreshToken }).toEqual({ access: tabA.accessToken, refresh: tabA.refreshToken });
    expect(localStorage.getItem(keys.refresh)).toBe('rt-1');
  });

  it('without the lock, the race reuses a token and Keycloak ends the session', async () => {
    const kc = fakeKeycloak();
    vi.stubGlobal('fetch', kc.fetchFn);

    const outcomes = await Promise.allSettled([
      refreshFromStorage(cfg, keys, { locks: undefined }),
      refreshFromStorage(cfg, keys, { locks: undefined }),
    ]);

    expect(kc.requests).toEqual(['rt-0', 'rt-0']);
    expect(outcomes.map((o) => o.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(kc.revoked).toBe(true);
  });

  it('refreshes an expired session on load, and fails when nothing is stored', async () => {
    const kc = fakeKeycloak();
    vi.stubGlobal('fetch', kc.fetchFn);
    localStorage.setItem(keys.access, jwt(-10, 0));
    await expect(refreshFromStorage(cfg, keys, { locks: fakeLocks() })).resolves.toMatchObject({ refreshToken: 'rt-1' });

    localStorage.removeItem(keys.refresh);
    await expect(refreshFromStorage(cfg, keys, { locks: fakeLocks() })).rejects.toThrow(/No refresh token/);
  });
});
