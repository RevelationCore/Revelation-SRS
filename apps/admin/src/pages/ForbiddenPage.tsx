import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export function ForbiddenPage() {
  const { t } = useTranslation();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <p className="text-5xl font-bold text-gray-300">403</p>
      <h1 className="mt-4 text-xl font-semibold text-gray-800">{t('auth.unauthorized')}</h1>
      <p className="mt-2 text-sm text-gray-500">
        You do not have the required role to view this page.
      </p>
      <Link to="/dashboard" className="mt-6 text-sm text-indigo-600 hover:underline">
        {t('nav.home')}
      </Link>
    </main>
  );
}
