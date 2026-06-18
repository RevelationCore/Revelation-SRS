import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, handleCallback } from '../auth/AuthContext.js';
import { Spinner, Problem, isStaffUser, getTokenRoles } from '@revelation-srs/ui';

const ADMIN_URL = (import.meta.env.VITE_ADMIN_URL as string | undefined) ?? 'http://localhost:5173';

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
      setError(params.get('error_description') ?? errParam);
      return;
    }
    if (!code || !state) {
      setError('Missing authorisation code or state parameter.');
      return;
    }

    handleCallback(config, code, state)
      .then((tokens) => {
        // Staff who land in the portal are redirected to admin
        if (isStaffUser(getTokenRoles(tokens.accessToken))) {
          window.location.href = ADMIN_URL;
          return;
        }
        login(tokens);
        navigate('/dashboard', { replace: true });
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Authentication failed.');
      });
  }, [config, login, navigate]);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-4">
          <Problem title="Sign-in failed" detail={error} />
          <a href="/login" className="block text-center text-sm text-indigo-600 hover:underline">
            Return to sign-in
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <Spinner size="lg" label="Completing sign-in…" />
    </main>
  );
}
