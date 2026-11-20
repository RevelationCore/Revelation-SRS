/** PKCE Authorization Code Flow helpers — no external OIDC library required. */

import { isTokenExpired, secondsUntilExpiry } from './jwt.js';

export interface OidcConfig {
  keycloakUrl: string;
  realm:       string;
  clientId:    string;
  redirectUri: string;
}

export interface TokenSet {
  accessToken:  string;
  refreshToken: string;
  expiresIn:    number;
}

// ── PKCE helpers ──────────────────────────────────────────────────────────────

function base64urlEncode(bytes: Uint8Array): string {
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]!);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateRandom(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return base64urlEncode(buf);
}

async function sha256(plain: string): Promise<string> {
  const data   = new TextEncoder().encode(plain);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64urlEncode(new Uint8Array(digest));
}

const VERIFIER_KEY = 'srs_pkce_verifier';
const STATE_KEY    = 'srs_pkce_state';

export async function startLogin(cfg: OidcConfig): Promise<void> {
  const verifier  = generateRandom();
  const challenge = await sha256(verifier);
  const state     = generateRandom();

  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY,    state);

  const params = new URLSearchParams({
    response_type:         'code',
    client_id:             cfg.clientId,
    redirect_uri:          cfg.redirectUri,
    // No offline_access: a browser app's refresh token ends with the
    // Keycloak session (ADR-026).
    scope:                 'openid profile email',
    code_challenge:        challenge,
    code_challenge_method: 'S256',
    state,
    prompt:                'login',
  });

  window.location.href =
    `${cfg.keycloakUrl}/realms/${cfg.realm}/protocol/openid-connect/auth?${params.toString()}`;
}

export async function handleCallback(
  cfg:   OidcConfig,
  code:  string,
  state: string,
): Promise<TokenSet> {
  const storedState    = sessionStorage.getItem(STATE_KEY);
  const storedVerifier = sessionStorage.getItem(VERIFIER_KEY);

  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);

  if (!storedState || !storedVerifier) {
    throw new Error('No PKCE session found — please start the login flow again.');
  }
  if (state !== storedState) {
    throw new Error('State mismatch — possible CSRF attempt.');
  }

  return exchangeCode(cfg, {
    grant_type:    'authorization_code',
    client_id:     cfg.clientId,
    redirect_uri:  cfg.redirectUri,
    code,
    code_verifier: storedVerifier,
  });
}

export async function refreshTokens(cfg: OidcConfig, refreshToken: string): Promise<TokenSet> {
  return exchangeCode(cfg, {
    grant_type:    'refresh_token',
    client_id:     cfg.clientId,
    refresh_token: refreshToken,
  });
}

export interface TokenStorageKeys {
  access:  string;
  refresh: string;
}

/** The part of the Web Locks API this module needs (navigator.locks). */
export interface RefreshLocks {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

/**
 * Refreshes with the refresh token in storage, one tab at a time.
 *
 * The realm rotates refresh tokens (ADR-026), and Keycloak treats a used
 * refresh token as theft: presenting one again also revokes its
 * replacement, ending the session for every tab. Each open tab refreshes on
 * its own timer from the same stored tokens, so tabs must never refresh
 * concurrently. A Web Lock serialises them; the winner stores the new pair
 * before releasing it, and a tab that then gets the lock finds a fresh
 * access token and uses it instead of refreshing again.
 *
 * Browsers without Web Locks (none current) refresh unserialised.
 */
export async function refreshFromStorage(
  cfg:  OidcConfig,
  keys: TokenStorageKeys,
  opts: { locks?: RefreshLocks | undefined; freshForSeconds?: number } = {},
): Promise<TokenSet> {
  const locks = 'locks' in opts ? opts.locks : (globalThis.navigator as { locks?: RefreshLocks } | undefined)?.locks;
  // A tab refreshes when its token has at most 60 s left, so a token with
  // more than this left was just issued to another tab.
  const freshFor = opts.freshForSeconds ?? 90;

  const run = async (): Promise<TokenSet> => {
    const access  = localStorage.getItem(keys.access);
    const refresh = localStorage.getItem(keys.refresh);
    if (!refresh) throw new Error('No refresh token stored');
    if (access && !isTokenExpired(access) && secondsUntilExpiry(access) > freshFor) {
      return { accessToken: access, refreshToken: refresh, expiresIn: secondsUntilExpiry(access) };
    }
    const ts = await refreshTokens(cfg, refresh);
    localStorage.setItem(keys.access,  ts.accessToken);
    localStorage.setItem(keys.refresh, ts.refreshToken);
    return ts;
  };

  return locks ? locks.request(`srs-token-refresh:${keys.refresh}`, run) : run();
}

export function logout(cfg: OidcConfig): void {
  const params = new URLSearchParams({
    client_id:                cfg.clientId,
    post_logout_redirect_uri: `${window.location.origin}/login`,
  });
  window.location.href =
    `${cfg.keycloakUrl}/realms/${cfg.realm}/protocol/openid-connect/logout?${params.toString()}`;
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function exchangeCode(
  cfg:    OidcConfig,
  params: Record<string, string>,
): Promise<TokenSet> {
  const res = await fetch(
    `${cfg.keycloakUrl}/realms/${cfg.realm}/protocol/openid-connect/token`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams(params).toString(),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    access_token:  string;
    refresh_token: string;
    expires_in:    number;
  };

  return {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token,
    expiresIn:    data.expires_in,
  };
}
