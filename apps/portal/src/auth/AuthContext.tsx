import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  startLogin,
  handleCallback,
  refreshFromStorage,
  logout,
  type OidcConfig,
  type TokenSet,
  type JwtPayload,
  parseJwt,
  isTokenExpired,
  secondsUntilExpiry,
  getTokenRoles,
} from '@revelation-srs/ui';

export { startLogin, handleCallback };

interface AuthContextValue {
  token:          string | null;
  user:           JwtPayload | null;
  roles:          string[];
  /** SRS database person UUID, populated from the srs_person_id JWT claim. */
  personId:       string | null;
  isReady:        boolean;
  sessionExpired: boolean;
  login:          (tokens: TokenSet) => void;
  logout:         () => void;
  config:         OidcConfig | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const ACCESS_KEY  = 'srs_portal_token';
const REFRESH_KEY = 'srs_portal_refresh_token';
const STORAGE_KEYS = { access: ACCESS_KEY, refresh: REFRESH_KEY };

const oidcConfig: OidcConfig | null = import.meta.env.VITE_KEYCLOAK_URL
  ? {
      keycloakUrl: import.meta.env.VITE_KEYCLOAK_URL as string,
      realm:       (import.meta.env.VITE_KEYCLOAK_REALM       ?? 'revelation') as string,
      clientId:    (import.meta.env.VITE_KEYCLOAK_CLIENT_ID   ?? 'srs-portal') as string,
      redirectUri: `${window.location.origin}/callback`,
    }
  : null;

function parseClaims(token: string): { user: JwtPayload | null; roles: string[]; personId: string | null } {
  try {
    const user = parseJwt(token);
    return { user, roles: getTokenRoles(token), personId: user.srs_person_id ?? null };
  } catch {
    return { user: null, roles: [], personId: null };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token,          setToken]          = useState<string | null>(null);
  const [user,           setUser]           = useState<JwtPayload | null>(null);
  const [roles,          setRoles]          = useState<string[]>([]);
  const [personId,       setPersonId]       = useState<string | null>(null);
  const [isReady,        setIsReady]        = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimer() {
    if (refreshTimerRef.current !== null) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }

  const applyTokens = useCallback((access: string, refresh: string) => {
    localStorage.setItem(ACCESS_KEY,  access);
    localStorage.setItem(REFRESH_KEY, refresh);
    const { user: u, roles: r, personId: pid } = parseClaims(access);
    setToken(access);
    setUser(u);
    setRoles(r);
    setPersonId(pid);
    setSessionExpired(false);
  }, []);

  const scheduleRefresh = useCallback((access: string) => {
    if (!oidcConfig) return;
    const secs  = secondsUntilExpiry(access);
    // Up to 10 s of jitter, so tabs sharing one session rarely refresh at
    // the same moment; refreshFromStorage serialises them when they do.
    const delay = Math.max((secs - 60 - Math.random() * 10) * 1000, 0);
    clearTimer();
    refreshTimerRef.current = setTimeout(() => {
      refreshFromStorage(oidcConfig, STORAGE_KEYS)
        .then((ts) => { applyTokens(ts.accessToken, ts.refreshToken); scheduleRefresh(ts.accessToken); })
        .catch(expire);
    }, delay);
  }, [applyTokens]); // eslint-disable-line react-hooks/exhaustive-deps

  function expire() {
    clearTimer();
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    setToken(null);
    setUser(null);
    setRoles([]);
    setPersonId(null);
    setSessionExpired(true);
  }

  // Restore session on mount
  useEffect(() => {
    const access  = localStorage.getItem(ACCESS_KEY);
    const refresh = localStorage.getItem(REFRESH_KEY);

    if (!access) { setIsReady(true); return; }

    if (isTokenExpired(access)) {
      if (refresh && oidcConfig) {
        refreshFromStorage(oidcConfig, STORAGE_KEYS)
          .then((ts) => { applyTokens(ts.accessToken, ts.refreshToken); scheduleRefresh(ts.accessToken); setIsReady(true); })
          .catch(() => { expire(); setIsReady(true); });
      } else {
        expire();
        setIsReady(true);
      }
      return;
    }

    const { user: u, roles: r, personId: pid } = parseClaims(access);
    setToken(access);
    setUser(u);
    setRoles(r);
    setPersonId(pid);
    setIsReady(true);
    scheduleRefresh(access);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => clearTimer(), []);

  const login = useCallback((ts: TokenSet) => {
    applyTokens(ts.accessToken, ts.refreshToken);
    scheduleRefresh(ts.accessToken);
    setIsReady(true);
  }, [applyTokens, scheduleRefresh]);

  const handleLogout = useCallback(() => {
    clearTimer();
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    setToken(null);
    setUser(null);
    setRoles([]);
    setPersonId(null);
    setSessionExpired(false);
    if (oidcConfig) logout(oidcConfig);
    else window.location.href = '/login';
  }, []);

  return (
    <AuthContext.Provider value={{ token, user, roles, personId, isReady, sessionExpired, login, logout: handleLogout, config: oidcConfig }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
