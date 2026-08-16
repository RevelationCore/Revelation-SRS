import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth, startLogin } from '../auth/AuthContext.js';
import type { TokenSet } from '@revelation-srs/ui';

const DEMO_USERS = [
  {
    username:    'registry',
    name:        'Registry Administrator',
    description: 'Full access to student records, enrolments, module registrations, corrections and appeals.',
    stories:     ['Students', 'Enrolments', 'Corrections'],
  },
  {
    username:    'chair',
    name:        'Exam Board Chair',
    description: 'Chairs exam board meetings, reviews candidate profiles, ratifies progression and award decisions.',
    stories:     ['Exam boards', 'Ratification', 'Progression'],
  },
  {
    username:    'wellbeing',
    name:        'Wellbeing Advisor',
    description: 'Manages wellbeing referrals, extenuating circumstances claims, and disability support cases.',
    stories:     ['Wellbeing', 'EC claims', 'Disability'],
  },
  {
    username:    'dpo',
    name:        'Data Protection Officer',
    description: 'Accesses the audit trail, processes FOI and Subject Access Requests, monitors regulatory compliance.',
    stories:     ['Audit log', 'FOI / SAR', 'Regulatory'],
  },
  {
    username:    'examiner',
    name:        'External Examiner',
    description: 'Reviews submitted assessment marks and exam board papers. Read-only access to assessment data.',
    stories:     ['Assessment', 'Exam boards'],
  },
  {
    username:    'ops',
    name:        'Platform Operator',
    description: 'Manages system configuration, integration connectors, feature flags, and value sets.',
    stories:     ['Config', 'Integrations', 'Operations'],
  },
] as const;

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
    <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4 py-12">

      {/* Sign-in card */}
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-neutral-900">Revelation SRS</h1>
          <p className="mt-1 text-sm text-neutral-500">Administration Console</p>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-white p-8">
          {config ? (
            <div className="space-y-4">
              <button
                onClick={() => void handleKeycloakLogin()}
                disabled={starting}
                className="w-full flex items-center justify-center gap-3 rounded py-2.5 px-4 bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60"
              >
                {starting
                  ? <span className="h-4 w-4 motion-safe:animate-spin rounded-full border-2 border-white border-t-transparent" />
                  : <KeycloakIcon />
                }
                {starting ? t('auth.signingIn') : t('auth.signInWithKeycloak')}
              </button>
              {error && <p className="text-sm text-danger-600 text-center">{error}</p>}
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
                className="w-full rounded py-2 px-4 bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
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
      </div>

      {/* Demo accounts panel */}
      <div className="mt-8 w-full max-w-4xl rounded-lg border border-amber-200 bg-amber-50 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-5">
          <h2 className="text-sm font-semibold text-amber-900">Demo accounts</h2>
          <span className="text-xs text-amber-700">
            Password for all:{' '}
            <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono font-semibold text-amber-900 select-all">
              Demo-2026!
            </code>
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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

function KeycloakIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1
               14.5v-3H7l5-7v3h4l-5 7z" />
    </svg>
  );
}
