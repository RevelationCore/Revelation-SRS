import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { getDisplayName } from '@revelation-srs/ui';
import { DemoBanner } from './DemoBanner.js';

export function Layout({ children }: { children: React.ReactNode }) {
  const { logout, user, sessionExpired } = useAuth();
  const navigate = useNavigate();
  const { t }    = useTranslation();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const displayName = user ? getDisplayName(user) : null;

  if (sessionExpired) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 text-center">
        <p className="text-5xl font-bold text-gray-300">⏱</p>
        <h1 className="mt-4 text-xl font-semibold text-gray-800">{t('auth.sessionExpired')}</h1>
        <a
          href="/login"
          className="mt-6 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          {t('auth.signInWithKeycloak')}
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="border-b border-gray-200 bg-white px-6 py-3 flex items-center gap-6">
        <Link to="/" className="text-sm font-semibold text-indigo-700 tracking-tight">
          Revelation SRS
        </Link>
        <NavLink
          to="/dashboard"
          className={({ isActive }) =>
            `text-sm ${isActive ? 'text-indigo-600 font-medium' : 'text-gray-600 hover:text-gray-900'}`
          }
        >
          Dashboard
        </NavLink>
        <NavLink
          to="/students"
          className={({ isActive }) =>
            `text-sm ${isActive ? 'text-indigo-600 font-medium' : 'text-gray-600 hover:text-gray-900'}`
          }
        >
          Students
        </NavLink>
        <NavLink
          to="/tasks"
          className={({ isActive }) =>
            `text-sm ${isActive ? 'text-indigo-600 font-medium' : 'text-gray-600 hover:text-gray-900'}`
          }
        >
          Tasks
        </NavLink>
        <NavLink
          to="/exam-boards"
          className={({ isActive }) =>
            `text-sm ${isActive ? 'text-indigo-600 font-medium' : 'text-gray-600 hover:text-gray-900'}`
          }
        >
          Exam boards
        </NavLink>
        <NavLink
          to="/regulatory"
          className={({ isActive }) =>
            `text-sm ${isActive ? 'text-indigo-600 font-medium' : 'text-gray-600 hover:text-gray-900'}`
          }
        >
          Regulatory
        </NavLink>
        <NavLink
          to="/tenant-admin"
          className={({ isActive }) =>
            `text-sm ${isActive ? 'text-indigo-600 font-medium' : 'text-gray-600 hover:text-gray-900'}`
          }
        >
          Admin
        </NavLink>
        <NavLink
          to="/reporting"
          className={({ isActive }) =>
            `text-sm ${isActive ? 'text-indigo-600 font-medium' : 'text-gray-600 hover:text-gray-900'}`
          }
        >
          Reporting
        </NavLink>
        <NavLink
          to="/operations"
          className={({ isActive }) =>
            `text-sm ${isActive ? 'text-indigo-600 font-medium' : 'text-gray-600 hover:text-gray-900'}`
          }
        >
          Operations
        </NavLink>

        <div className="ml-auto flex items-center gap-4">
          {displayName && (
            <span className="text-sm text-gray-500" aria-label="Signed in as">
              {displayName}
            </span>
          )}
          <button
            onClick={handleLogout}
            className="text-sm text-gray-500 hover:text-gray-800"
          >
            {t('nav.signOut')}
          </button>
        </div>
      </nav>
      <DemoBanner />
      <main className="mx-auto max-w-6xl px-6 py-8">
        {children}
      </main>
    </div>
  );
}
