import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.js';
import { oidcConfig, startLogin } from '../auth/oidc.js';

export function LoginPage() {
  const { login }  = useAuth();
  const navigate   = useNavigate();
  const [starting, setStarting] = useState(false);
  const [error, setError]       = useState('');

  // ── Keycloak OIDC path ────────────────────────────────────────────────────

  async function handleKeycloakLogin() {
    if (!oidcConfig) return;
    setStarting(true);
    setError('');
    try {
      await startLogin(oidcConfig);
      // Browser redirects; execution does not continue here.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start login');
      setStarting(false);
    }
  }

  // ── JWT-paste fallback (no Keycloak configured) ───────────────────────────

  const [token, setToken] = useState('');

  function handlePasteSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) { setError('Paste a valid Bearer token.'); return; }
    if (trimmed.split('.').length !== 3) {
      setError('Token does not look like a valid JWT.');
      return;
    }
    login(trimmed);
    navigate('/students');
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm">

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Revelation SRS</h1>
          <p className="mt-1 text-sm text-gray-500">Administration Console</p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-8">
          {oidcConfig ? (
            // ── Keycloak sign-in ────────────────────────────────────────────
            <div className="space-y-4">
              <button
                onClick={() => void handleKeycloakLogin()}
                disabled={starting}
                className="w-full flex items-center justify-center gap-3 py-2.5 px-4 bg-indigo-600 text-white text-sm font-medium rounded hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
              >
                {starting ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <KeycloakIcon />
                )}
                {starting ? 'Redirecting…' : 'Sign in with Keycloak'}
              </button>

              <p className="text-xs text-center text-gray-400">
                Default dev credentials: <strong>admin / admin</strong>
              </p>

              {error && <p className="text-sm text-red-600 text-center">{error}</p>}
            </div>
          ) : (
            // ── JWT-paste fallback ──────────────────────────────────────────
            <form onSubmit={handlePasteSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Bearer Token
                </label>
                <textarea
                  rows={5}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                  placeholder="Paste your JWT here…"
                  value={token}
                  onChange={(e) => { setToken(e.target.value); setError(''); }}
                />
                <p className="mt-1 text-xs text-gray-400">
                  Set <code>VITE_KEYCLOAK_URL</code> in <code>.env</code> to enable
                  Keycloak sign-in.
                </p>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                className="w-full py-2 px-4 bg-indigo-600 text-white text-sm font-medium rounded hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                Sign in
              </button>
            </form>
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
