import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.js';
import { handleCallback, oidcConfig } from '../auth/oidc.js';
import { Spinner } from '../components/Spinner.js';

export function CallbackPage() {
  const { login }             = useAuth();
  const navigate              = useNavigate();
  const [error, setError]     = useState('');

  useEffect(() => {
    if (!oidcConfig) {
      setError('OIDC is not configured.');
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const code   = params.get('code');
    const state  = params.get('state');
    const errParam = params.get('error');

    if (errParam) {
      setError(`Keycloak error: ${params.get('error_description') ?? errParam}`);
      return;
    }

    if (!code || !state) {
      setError('Missing code or state in callback URL.');
      return;
    }

    handleCallback(oidcConfig, code, state)
      .then((accessToken) => {
        login(accessToken);
        navigate('/students', { replace: true });
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Authentication failed');
      });
  }, [login, navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center space-y-4">
          <p className="text-red-600 text-sm">{error}</p>
          <a href="/login" className="text-indigo-600 text-sm hover:underline">
            Back to sign in
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="flex items-center gap-3 text-gray-600 text-sm">
        <Spinner size="sm" />
        <span>Completing sign in…</span>
      </div>
    </div>
  );
}
