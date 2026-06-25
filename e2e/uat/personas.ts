/**
 * UAT personas — fetches real Keycloak tokens for each demo user.
 *
 * Unlike the mocked test helpers (e2e/helpers/auth.ts), which inject unsigned
 * JWTs, this module fetches RS256 tokens from the local Keycloak instance.
 * These are the only tokens the live API will accept.
 *
 * Prerequisites:
 *   - Keycloak running at http://localhost:8081
 *   - srs-admin client has directAccessGrantsEnabled=true
 *   - Demo persona passwords are set to DEMO_PERSONA_PASSWORD (default: demo-pass)
 *
 * The password can be overridden with the DEMO_PERSONA_PASSWORD env var.
 */

import type { Page } from '@playwright/test';

// ── App base URLs ─────────────────────────────────────────────────────────────

export const ADMIN  = 'http://localhost:5173';
export const PORTAL = 'http://localhost:5174';

const KEYCLOAK_TOKEN_URL = 'http://localhost:8081/realms/srs/protocol/openid-connect/token';
const KEYCLOAK_CLIENT_ID = 'srs-admin';
const DEMO_PASSWORD      = process.env['DEMO_PERSONA_PASSWORD'] ?? 'Demo-2026!';

// ── Token cache ───────────────────────────────────────────────────────────────
// Tokens are fetched once per test process and cached. Both the access token
// and refresh token are stored so AuthContext can refresh before expiry without
// hitting Keycloak again in the middle of the test run.

interface TokenPair { access: string; refresh: string }

const tokenCache = new Map<string, TokenPair>();

async function fetchTokens(username: string): Promise<TokenPair> {
  const cached = tokenCache.get(username);
  if (cached) return cached;

  const body = new URLSearchParams({
    grant_type: 'password',
    client_id:  KEYCLOAK_CLIENT_ID,
    username,
    password:   DEMO_PASSWORD,
  });

  const res = await fetch(KEYCLOAK_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to get Keycloak token for ${username}: ${res.status} ${err}`);
  }

  const data = await res.json() as { access_token: string; refresh_token: string };
  const pair: TokenPair = { access: data.access_token, refresh: data.refresh_token };
  tokenCache.set(username, pair);
  return pair;
}

// ── Persona definitions ───────────────────────────────────────────────────────

export interface Persona {
  name:     string;
  username: string;
  app:      'admin' | 'portal';
}

export const PERSONAS: Record<string, Persona> = {
  /** Registry administrator — AR-*, TI-01, RP-01 */
  registry: { name: 'registry', username: 'registry', app: 'admin' },

  /** Wellbeing advisor — WB-01, WB-02, WB-03 */
  wellbeing: { name: 'wellbeing', username: 'wellbeing', app: 'admin' },

  /** Exam board chair — EB-01 through EB-04 */
  chair: { name: 'chair', username: 'chair', app: 'admin' },

  /** Data Protection Officer — RE-06, RE-07, AU-01 */
  dpo: { name: 'dpo', username: 'dpo', app: 'admin' },

  /** Operations / tenant administrator — OP-01 through OP-09, RP-02 */
  ops: { name: 'ops', username: 'ops', app: 'admin' },
} as const;

export type PersonaKey = keyof typeof PERSONAS;

// ── Auth injection helpers ────────────────────────────────────────────────────

export async function injectPersona(page: Page, persona: Persona): Promise<void> {
  const { access, refresh } = await fetchTokens(persona.username);
  const storageKey = persona.app === 'admin' ? 'srs_admin_token'         : 'srs_portal_token';
  const refreshKey = persona.app === 'admin' ? 'srs_admin_refresh_token' : 'srs_portal_refresh_token';

  await page.addInitScript(
    ({ acc, ref, sk, rk }: { acc: string; ref: string; sk: string; rk: string }) => {
      localStorage.setItem(sk, acc);
      localStorage.setItem(rk, ref);
    },
    { acc: access, ref: refresh, sk: storageKey, rk: refreshKey },
  );
}

export function appBase(persona: Persona): string {
  return persona.app === 'admin' ? ADMIN : PORTAL;
}
