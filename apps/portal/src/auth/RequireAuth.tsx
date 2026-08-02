import { Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from './AuthContext.js';
import { Spinner } from '@revelation-srs/ui';
import type { ReactNode } from 'react';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { token, isReady, sessionExpired } = useAuth();
  const location = useLocation();
  const { t }    = useTranslation();

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" label="Checking authentication…" />
      </div>
    );
  }

  if (sessionExpired) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4 text-center">
        <p className="text-5xl font-bold text-neutral-500" aria-hidden="true">⏱</p>
        <h1 className="mt-4 text-xl font-semibold text-neutral-800">{t('auth.sessionExpired')}</h1>
        <p className="mt-2 text-sm text-neutral-500">{t('auth.sessionExpiredDetail')}</p>
        <a
          href="/login"
          className="mt-6 rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-500"
        >
          {t('auth.signInWithKeycloak')}
        </a>
      </main>
    );
  }

  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
