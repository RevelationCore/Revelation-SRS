import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth, startLogin } from '../auth/AuthContext.js';
import type { TokenSet } from '@revelation-srs/ui';

const DEV_AUTH = import.meta.env.VITE_DEV_AUTH === 'true';

export function LoginPage() {
  const { login, config } = useAuth();
  const navigate          = useNavigate();
  const { t }             = useTranslation();
  const [starting, setStarting] = useState(false);
  const [error, setError]       = useState('');

  // ── Keycloak OIDC path ───────────────────────────────────────────────────

  async function handleKeycloakLogin() {
    if (!config) return;
    setStarting(true);
    setError('');
    try {
      await startLogin(config);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start login');
      setStarting(false);
    }
  }

  // ── Dev JWT-paste fallback (VITE_DEV_AUTH=true only) ─────────────────────

  const [rawToken, setRawToken] = useState('');

  function handlePasteSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = rawToken.trim();
    if (!trimmed) { setError('Paste a valid Bearer token.'); return; }
    if (trimmed.split('.').length !== 3) {
      setError('Token does not look like a valid JWT.');
      return;
    }
    // Build a synthetic TokenSet — no refresh token available in dev mode
    const ts: TokenSet = { accessToken: trimmed, refreshToken: '', expiresIn: 3600 };
    login(ts);
    navigate('/dashboard');
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900">Revelation SRS</h1>
          <p className="mt-1 text-sm text-gray-500">Administration Console</p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-8">
          {config ? (
            <div className="space-y-4">
              <button
                onClick={() => void handleKeycloakLogin()}
                disabled={starting}
                className="w-full flex items-center justify-center gap-3 rounded py-2.5 px-4 bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
              >
                {starting
                  ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  : <KeycloakIcon />
                }
                {starting ? t('auth.signingIn') : t('auth.signInWithKeycloak')}
              </button>
              {error && <p className="text-sm text-red-600 text-center">{error}</p>}
            </div>
          ) : DEV_AUTH ? (
            <form onSubmit={handlePasteSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('auth.devTokenLabel')}
                </label>
                <textarea
                  rows={5}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                  placeholder={t('auth.devTokenPlaceholder')}
                  value={rawToken}
                  onChange={(e) => { setRawToken(e.target.value); setError(''); }}
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                className="w-full rounded py-2 px-4 bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {t('actions.submit')}
              </button>
            </form>
          ) : (
            <p className="text-sm text-center text-gray-500">
              Keycloak is not configured. Set <code className="font-mono">VITE_KEYCLOAK_URL</code> to enable sign-in.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function KeycloakIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1
               14.5v-3H7l5-7v3h4l-5 7z" />
    </svg>
  );
}
