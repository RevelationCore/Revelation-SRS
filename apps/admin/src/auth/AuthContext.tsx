import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { clearToken, getStoredToken, storeToken } from '../api/client.js';
import { logout as oidcLogout, oidcConfig } from './oidc.js';

interface AuthState {
  token:   string | null;
  isReady: boolean;
}

interface AuthActions {
  login:  (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState & AuthActions>({
  token:   null,
  isReady: false,
  login:   () => undefined,
  logout:  () => undefined,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken]     = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    setToken(getStoredToken());
    setIsReady(true);
  }, []);

  const login = useCallback((t: string) => {
    storeToken(t);
    setToken(t);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setToken(null);
    if (oidcConfig) {
      oidcLogout(oidcConfig);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ token, isReady, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
