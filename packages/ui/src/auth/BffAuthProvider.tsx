import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import type { JwtPayload } from './jwt.js';
import { devSignIn, fetchSession, onSignedOutElsewhere, signIn, signOut, type BffSession } from './session.js';

/**
 * Authentication state from the BFF session (ADR-026): the browser never
 * sees a token. `user` keeps the claim names screens already use.
 */
export interface BffAuthValue {
  authenticated:  boolean;
  user:           JwtPayload | null;
  roles:          string[];
  /** SRS person UUID (srs_person_id), for self-service screens. */
  personId:       string | null;
  isReady:        boolean;
  /** True when a session this tab had has ended (expired, or signed out in another tab). */
  sessionExpired: boolean;
  /** Sign in at the BFF, coming back to returnTo. */
  signIn:         (returnTo?: string) => void;
  /** Development and test only: a session from a pasted development token. */
  devLogin:       (token: string) => Promise<boolean>;
  logout:         () => void;
  /** Re-read the session (after a development sign-in, say). */
  reload:         () => Promise<void>;
}

const Ctx = createContext<BffAuthValue | null>(null);

function toUser(s: BffSession): JwtPayload | null {
  if (!s.authenticated || !s.sub) return null;
  return {
    sub: s.sub,
    ...(s.displayName ? { name: s.displayName, preferred_username: s.displayName } : {}),
    ...(s.email ? { email: s.email } : {}),
    ...(s.tenantId ? { tenant_id: s.tenantId } : {}),
    ...(s.srsPersonId ? { srs_person_id: s.srsPersonId } : {}),
    realm_access: { roles: s.roles ?? [] },
    exp: s.expiresAt ? Math.floor(new Date(s.expiresAt).getTime() / 1000) : 0,
    iat: 0,
  };
}

export function BffAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<BffSession>({ authenticated: false });
  const [isReady, setIsReady] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  const reload = useCallback(async () => {
    const s = await fetchSession().catch((): BffSession => ({ authenticated: false }));
    setSession((prev) => {
      if (prev.authenticated && !s.authenticated) setSessionExpired(true);
      if (s.authenticated) setSessionExpired(false);
      return s;
    });
    setIsReady(true);
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  // Another tab signed out: this tab's session has gone too (ADR-026 item 10).
  useEffect(() => onSignedOutElsewhere(() => {
    setSession({ authenticated: false });
    setSessionExpired(true);
  }), []);

  const devLogin = useCallback(async (token: string) => {
    const ok = await devSignIn(token);
    if (ok) await reload();
    return ok;
  }, [reload]);

  const value: BffAuthValue = {
    authenticated: session.authenticated,
    user: toUser(session),
    roles: session.roles ?? [],
    personId: session.srsPersonId ?? null,
    isReady,
    sessionExpired,
    signIn,
    devLogin,
    logout: () => { void signOut(); },
    reload,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBffAuth(): BffAuthValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
