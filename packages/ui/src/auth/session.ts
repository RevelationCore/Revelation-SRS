/**
 * Browser sessions through the backend-for-frontend (ADR-026). The browser
 * holds no OAuth token: an HTTP-only cookie identifies the session, and the
 * BFF on this origin holds the tokens. These helpers are the SPA's whole
 * view of authentication.
 */

/** What GET /bff/session returns. Never a token. */
export interface BffSession {
  authenticated: boolean;
  sub?:          string | null;
  srsPersonId?:  string | null;
  tenantId?:     string | null;
  roles?:        string[];
  displayName?:  string | null;
  email?:        string | null;
  expiresAt?:    string;
}

/** The custom header the BFF requires on non-safe requests (CSRF, ADR-026 item 11). */
export const BFF_HEADERS: Readonly<Record<string, string>> = { 'X-SRS-Request': '1' };

const CHANNEL = 'srs-auth';

export async function fetchSession(): Promise<BffSession> {
  const res = await fetch('/bff/session', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  if (!res.ok) return { authenticated: false };
  return res.json() as Promise<BffSession>;
}

/** Starts sign-in at the BFF, coming back to `returnTo` (a path on this origin). */
export function signIn(returnTo = `${window.location.pathname}${window.location.search}`): void {
  window.location.assign(`/bff/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
}

/** Ends the session, tells other tabs, then ends the Keycloak session. */
export async function signOut(): Promise<void> {
  let endSessionUrl: string | undefined;
  try {
    const res = await fetch('/bff/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { ...BFF_HEADERS } });
    if (res.ok) endSessionUrl = ((await res.json()) as { endSessionUrl?: string }).endSessionUrl;
  } finally {
    broadcastSignedOut();
  }
  window.location.assign(endSessionUrl ?? '/login');
}

/**
 * Development and test only: a session from a development token
 * (POST /bff/dev/session). The BFF refuses the route elsewhere.
 */
export async function devSignIn(token: string): Promise<boolean> {
  const res = await fetch('/bff/dev/session', {
    method: 'POST', credentials: 'same-origin', headers: { ...BFF_HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
  });
  return res.ok;
}

/** Tells other tabs this session has ended (no data in the message). */
export function broadcastSignedOut(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const ch = new BroadcastChannel(CHANNEL);
  ch.postMessage('signed-out');
  ch.close();
}

/** Calls `onSignedOut` when another tab signs out; returns an unsubscribe. */
export function onSignedOutElsewhere(onSignedOut: () => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  const ch = new BroadcastChannel(CHANNEL);
  ch.onmessage = (e: MessageEvent) => { if (e.data === 'signed-out') onSignedOut(); };
  return () => ch.close();
}
