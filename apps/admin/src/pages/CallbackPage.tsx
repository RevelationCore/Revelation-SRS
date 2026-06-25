import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, handleCallback } from '../auth/AuthContext.js';
import { Spinner, Problem, isStudentOnly, getTokenRoles } from '@revelation-srs/ui';

const PORTAL_URL = (import.meta.env.VITE_PORTAL_URL as string | undefined) ?? 'http://localhost:5174';

export function CallbackPage() {
  const { login, config } = useAuth();
  const navigate          = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const handled           = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    if (!config) {
      setError('OIDC is not configured.');
      return;
    }

    const params   = new URLSearchParams(window.location.search);
    const code     = params.get('code');
    const state    = params.get('state');
    const errParam = params.get('error');

    if (errParam) {
      sessionStorage.removeItem('srs_pkce_verifier');
      sessionStorage.removeItem('srs_pkce_state');
      setError(`Sign-in error: ${params.get('error_description') ?? errParam}`);
      return;
    }
    if (!code || !state) {
      setError('Missing code or state in callback URL.');
      return;
    }

    handleCallback(config, code, state)
      .then((tokens) => {
        // Students who land in admin are redirected to the portal
        if (isStudentOnly(getTokenRoles(tokens.accessToken))) {
          window.location.href = PORTAL_URL;
          return;
        }
        login(tokens);
        navigate('/dashboard', { replace: true });
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Authentication failed.');
      });
  }, [config, login, navigate]);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-4">
          <Problem title="Sign-in failed" detail={error} />
          <a href="/login" className="mt-4 block text-center text-sm text-indigo-600 hover:underline">
            Back to sign in
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="flex items-center gap-3 text-sm text-gray-600">
        <Spinner size="sm" />
        <span>Completing sign in…</span>
      </div>
    </main>
  );
}
