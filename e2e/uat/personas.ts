/**
 * UAT personas: each demo user signs in for real (BL-375).
 *
 * Unlike the mocked test helpers (e2e/helpers/auth.ts), which hand the BFF an
 * unsigned token, each persona goes through the same browser sign-in as
 * staff and students (ADR-026): the app's BFF sends the browser to
 * Keycloak, the persona's username and password go into the Keycloak login
 * form, and the BFF's callback sets its session cookie. No client allows
 * the password grant, and the BFF's development session endpoint is not
 * used, so the suite exercises the deployed sign-in path.
 *
 * Prerequisites:
 *   - Keycloak running at http://localhost:8081 with the srs realm
 *     (infra/compose/keycloak/srs-realm.json);
 *   - the admin and portal BFFs and dev servers running (pnpm dev);
 *   - demo persona passwords set to DEMO_PERSONA_PASSWORD (default: Demo-2026!).
 */

import type { Cookie, Page } from '@playwright/test';

// ── App base URLs ─────────────────────────────────────────────────────────────

export const ADMIN  = 'http://localhost:5173';
export const PORTAL = 'http://localhost:5174';

const DEMO_PASSWORD  = process.env['DEMO_PERSONA_PASSWORD'] ?? 'Demo-2026!';
// The BFF's session cookie (apps/bff/src/cookies.ts).
const SESSION_COOKIE = '__Host-srs_session';

// ── Session cache ─────────────────────────────────────────────────────────────
// Each persona signs in once per test process; later tests reuse its BFF
// session cookie, so Keycloak is not asked again for every story.

const sessions = new Map<string, Cookie>();

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

/** Sign the persona in through its app's BFF and Keycloak, or reuse its session. */
export async function injectPersona(page: Page, persona: Persona): Promise<void> {
  const base = appBase(persona);
  const key  = `${persona.app}:${persona.username}`;
  const cached = sessions.get(key);
  if (cached) {
    await page.context().addCookies([cached]);
    return;
  }

  await page.goto(`${base}/bff/auth/login?returnTo=${encodeURIComponent('/')}`);
  await page.locator('#username').fill(persona.username);
  await page.locator('#password').fill(DEMO_PASSWORD);
  await page.locator('#kc-login').click();
  await page.waitForURL((url) => url.origin === base && !url.pathname.startsWith('/bff/'), { timeout: 30_000 })
    .catch(async () => {
      const error = await page.locator('#input-error, .kc-feedback-text, .pf-v5-c-alert__title').first().textContent().catch(() => null);
      throw new Error(`Sign-in failed for persona ${persona.username}: ${error?.trim() || `stopped at ${page.url()}`}`);
    });

  const session = (await page.context().cookies(base)).find((c) => c.name === SESSION_COOKIE);
  if (!session) throw new Error(`Sign-in for persona ${persona.username} set no BFF session cookie`);
  sessions.set(key, session);
}

export function appBase(persona: Persona): string {
  return persona.app === 'admin' ? ADMIN : PORTAL;
}
