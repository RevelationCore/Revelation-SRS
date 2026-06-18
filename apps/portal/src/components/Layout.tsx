import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { getDisplayName } from '@revelation-srs/ui';
import { DemoBanner } from './DemoBanner.js';

const NAV_ITEMS = [
  { to: '/dashboard',     label: 'portal.nav.dashboard'     },
  { to: '/profile',       label: 'portal.nav.profile'       },
  { to: '/modules',       label: 'portal.nav.modules'       },
  { to: '/results',       label: 'portal.nav.results'       },
  { to: '/timetable',     label: 'portal.nav.timetable'     },
  { to: '/exams',         label: 'portal.nav.exams'         },
  { to: '/adjustments',   label: 'portal.nav.adjustments'   },
  { to: '/disability',    label: 'portal.nav.disability'    },
  { to: '/circumstances', label: 'portal.nav.circumstances' },
  { to: '/notifications', label: 'portal.nav.notifications' },
] as const;

export function Layout() {
  const { logout, user } = useAuth();
  const navigate         = useNavigate();
  const { t }            = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);

  const displayName = user ? getDisplayName(user) : null;

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top navigation */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-5xl px-4">
          <div className="flex h-14 items-center justify-between">
            {/* Logo */}
            <NavLink to="/dashboard" className="text-sm font-bold text-indigo-700 tracking-tight">
              Revelation SRS
            </NavLink>

            {/* Desktop nav */}
            <nav
              aria-label="Main"
              className="hidden md:flex items-center gap-1"
            >
              {NAV_ITEMS.map(({ to, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `rounded px-3 py-1.5 text-sm transition-colors ${
                      isActive
                        ? 'bg-indigo-50 text-indigo-700 font-medium'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }`
                  }
                >
                  {t(label)}
                </NavLink>
              ))}
            </nav>

            {/* User menu */}
            <div className="flex items-center gap-3">
              {displayName && (
                <span className="hidden sm:block text-sm text-gray-500">
                  {displayName}
                </span>
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="text-sm text-gray-500 hover:text-gray-900"
              >
                {t('nav.signOut')}
              </button>
              {/* Mobile menu toggle */}
              <button
                type="button"
                aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={menuOpen}
                aria-controls="mobile-nav"
                onClick={() => setMenuOpen(o => !o)}
                className="md:hidden rounded p-1.5 text-gray-500 hover:bg-gray-100"
              >
                {menuOpen
                  ? <span aria-hidden="true" className="block h-5 w-5 text-center leading-5 font-bold">✕</span>
                  : <span aria-hidden="true" className="block h-5 w-5 space-y-1">
                      <span className="block h-0.5 w-5 bg-current" />
                      <span className="block h-0.5 w-5 bg-current" />
                      <span className="block h-0.5 w-5 bg-current" />
                    </span>
                }
              </button>
            </div>
          </div>

          {/* Mobile nav drawer */}
          {menuOpen && (
            <nav
              id="mobile-nav"
              aria-label="Mobile navigation"
              className="md:hidden border-t border-gray-100 py-2"
            >
              {NAV_ITEMS.map(({ to, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) =>
                    `block rounded px-3 py-2 text-sm ${
                      isActive
                        ? 'bg-indigo-50 text-indigo-700 font-medium'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`
                  }
                >
                  {t(label)}
                </NavLink>
              ))}
            </nav>
          )}
        </div>
      </header>
      <DemoBanner />

      {/* Page content */}
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
