import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth, startLogin } from '../auth/AuthContext.js';
import { Spinner, type TokenSet } from '@revelation-srs/ui';

const DEV_AUTH = import.meta.env.VITE_DEV_AUTH === 'true';

export function LoginPage() {
  const { token, isReady, config, login } = useAuth();
  const navigate = useNavigate();
  const { t }    = useTranslation();
  const [starting, setStarting] = useState(false);
  const [error, setError]       = useState('');

  // Redirect if already authenticated
  if (isReady && token) {
    navigate('/dashboard', { replace: true });
    return null;
  }

  async function handleSignIn() {
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
    const ts: TokenSet = { accessToken: trimmed, refreshToken: '', expiresIn: 3600 };
    login(ts);
    navigate('/dashboard', { replace: true });
  }

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900">Revelation SRS</h1>
          <p className="mt-1 text-sm text-gray-500">Student Portal</p>
        </div>

        <h2 className="mb-6 text-center text-lg font-semibold text-gray-800">
          {t('auth.signInHeading')}
        </h2>

        {config ? (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => void handleSignIn()}
              disabled={starting}
              className="w-full rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-60"
            >
              {starting ? t('auth.signingIn') : t('auth.signInWithKeycloak')}
            </button>
            {error && <p className="text-sm text-center text-red-600">{error}</p>}
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
              className="w-full rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-600"
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
    </main>
  );
}
