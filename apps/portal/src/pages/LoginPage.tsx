import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth, startLogin } from '../auth/AuthContext.js';
import { Spinner, type TokenSet } from '@revelation-srs/ui';

const DEMO_USERS = [
  {
    username:    'alice.demo',
    name:        'Alice — Enrolled student',
    description: 'Full-time Year 1 BSc Computer Science student. All module registrations confirmed, marks submitted and ratified, progressed to Year 2.',
    stories:     ['S1 Applicant', 'S2 Enrolled', 'S3 Modules', 'S4 Marks', 'S5 Board'],
  },
  {
    username:    'bob.demo',
    name:        'Bob — Intermitting student',
    description: 'Taking an authorised break from studies. Extenuating circumstances claim upheld; one module result deferred. Resit scheduled.',
    stories:     ['S1 Applicant', 'S2 Intermitting', 'S3 Waitlisted', 'S4 EC claim', 'S5 Resit'],
  },
  {
    username:    'carol.demo',
    name:        'Carol — Graduated student',
    description: 'Successfully graduated. Disability declaration on record with DSA support and reasonable adjustment applied during assessment. Transcript available.',
    stories:     ['S1 Applicant', 'S2 Graduated', 'S3 Override', 'S4 Adjustment', 'S5 Profile'],
  },
] as const;

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
    <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4 py-12">

      {/* Sign-in card */}
      <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-8 shadow-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-neutral-900">Revelation SRS</h1>
          <p className="mt-1 text-sm text-neutral-500">Student Portal</p>
        </div>

        <h2 className="mb-6 text-center text-lg font-semibold text-neutral-800">
          {t('auth.signInHeading')}
        </h2>

        {config ? (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => void handleSignIn()}
              disabled={starting}
              className="w-full rounded-md bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-60"
            >
              {starting ? t('auth.signingIn') : t('auth.signInWithKeycloak')}
            </button>
            {error && <p className="text-sm text-center text-danger-600">{error}</p>}
          </div>
        ) : DEV_AUTH ? (
          <form onSubmit={handlePasteSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">
                {t('auth.devTokenLabel')}
              </label>
              <textarea
                rows={5}
                className="w-full rounded border border-neutral-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                placeholder={t('auth.devTokenPlaceholder')}
                value={rawToken}
                onChange={(e) => { setRawToken(e.target.value); setError(''); }}
              />
            </div>
            {error && <p className="text-sm text-danger-600">{error}</p>}
            <button
              type="submit"
              className="w-full rounded-md bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-600"
            >
              {t('actions.submit')}
            </button>
          </form>
        ) : (
          <p className="text-sm text-center text-neutral-500">
            Keycloak is not configured. Set <code className="font-mono">VITE_KEYCLOAK_URL</code> to enable sign-in.
          </p>
        )}
      </div>

      {/* Demo accounts panel */}
      <div className="mt-8 w-full max-w-3xl rounded-lg border border-amber-200 bg-amber-50 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-5">
          <h2 className="text-sm font-semibold text-amber-900">Demo accounts</h2>
          <span className="text-xs text-amber-700">
            Password for all:{' '}
            <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono font-semibold text-amber-900 select-all">
              Demo-2026!
            </code>
          </span>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {DEMO_USERS.map(u => (
            <div key={u.username} className="flex flex-col rounded-md border border-amber-100 bg-white p-4">
              <p className="font-mono text-sm font-semibold text-neutral-900 select-all">{u.username}</p>
              <p className="mt-1 text-xs font-medium text-primary-700">{u.name}</p>
              <p className="mt-1.5 text-xs text-neutral-500 flex-1">{u.description}</p>
              <div className="mt-3 flex flex-wrap gap-1">
                {u.stories.map(s => (
                  <span key={s} className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

    </main>
  );
}
