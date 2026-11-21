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
  isReady:        boolean;
  sessionExpired: boolean;
  login:          (tokens: TokenSet) => void;
  logout:         () => void;
  config:         OidcConfig | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const ACCESS_KEY  = 'srs_admin_token';
const REFRESH_KEY = 'srs_admin_refresh_token';
const STORAGE_KEYS = { access: ACCESS_KEY, refresh: REFRESH_KEY };

const oidcConfig: OidcConfig | null = import.meta.env.VITE_KEYCLOAK_URL
  ? {
      keycloakUrl: import.meta.env.VITE_KEYCLOAK_URL as string,
      realm:       (import.meta.env.VITE_KEYCLOAK_REALM       ?? 'revelation') as string,
      clientId:    (import.meta.env.VITE_KEYCLOAK_CLIENT_ID   ?? 'srs-admin') as string,
      redirectUri: `${window.location.origin}/callback`,
    }
  : null;

function parseClaims(access: string): { user: JwtPayload | null; roles: string[] } {
  try {
    return { user: parseJwt(access), roles: getTokenRoles(access) };
  } catch {
    return { user: null, roles: [] };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token,          setToken]          = useState<string | null>(null);
  const [user,           setUser]           = useState<JwtPayload | null>(null);
  const [roles,          setRoles]          = useState<string[]>([]);
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
    const { user: u, roles: r } = parseClaims(access);
    setToken(access);
    setUser(u);
    setRoles(r);
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

    const { user: u, roles: r } = parseClaims(access);
    setToken(access);
    setUser(u);
    setRoles(r);
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
    setSessionExpired(false);
    if (oidcConfig) logout(oidcConfig);
    else window.location.href = '/login';
  }, []);

  return (
    <AuthContext.Provider value={{ token, user, roles, isReady, sessionExpired, login, logout: handleLogout, config: oidcConfig }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
