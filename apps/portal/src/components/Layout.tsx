import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { getDisplayName } from '@revelation-srs/ui';
import { DemoBanner } from './DemoBanner.js';

const NAV_ITEMS = [
  { to: '/dashboard',     label: 'portal.nav.dashboard'     },
  { to: '/profile',       label: 'portal.nav.profile'       },
  { to: '/enrolments',    label: 'portal.nav.enrolments'    },
  { to: '/modules',       label: 'portal.nav.modules'       },
  { to: '/results',       label: 'portal.nav.results'       },
  { to: '/timetable',     label: 'portal.nav.timetable'     },
  { to: '/exams',         label: 'portal.nav.exams'         },
  { to: '/adjustments',   label: 'portal.nav.adjustments'   },
  { to: '/disability',    label: 'portal.nav.disability'    },
  { to: '/circumstances', label: 'portal.nav.circumstances' },
  { to: '/notifications', label: 'portal.nav.notifications' },
] as const;

function navLinkClass({ isActive }: { isActive: boolean }) {
  return `flex items-center px-3 py-2 text-sm rounded-md transition-colors ${
    isActive
      ? 'bg-indigo-50 text-indigo-700 font-medium'
      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
  }`;
}

export function Layout() {
  const { logout, user } = useAuth();
  const navigate         = useNavigate();
  const { t }            = useTranslation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const displayName = user ? getDisplayName(user) : null;

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const navItems = (
    <>
      {NAV_ITEMS.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          className={navLinkClass}
          onClick={() => setMobileOpen(false)}
        >
          {t(label)}
        </NavLink>
      ))}
    </>
  );

  return (
    <div className="flex min-h-screen bg-gray-50">

      {/* ── Desktop sidebar ──────────────────────────────────── */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 z-20 w-52 flex-col bg-white border-r border-gray-200">
        {/* Brand */}
        <div className="flex h-14 items-center px-4 border-b border-gray-100 flex-shrink-0">
          <NavLink to="/dashboard" className="text-sm font-bold text-indigo-700 tracking-tight leading-tight">
            Revelation<br />
            <span className="text-xs font-semibold text-indigo-400 tracking-widest">Student Portal</span>
          </NavLink>
        </div>

        {/* Nav links */}
        <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 py-4 space-y-0.5">
          {navItems}
        </nav>

        {/* User footer */}
        <div className="flex-shrink-0 border-t border-gray-100 px-4 py-4">
          {displayName && (
            <p className="text-xs font-medium text-gray-700 truncate mb-1" title={displayName}>
              {displayName}
            </p>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
          >
            {t('nav.signOut')}
          </button>
        </div>
      </aside>

      {/* ── Mobile overlay sidebar ───────────────────────────── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 md:hidden"
          onClick={() => setMobileOpen(false)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/30" />

          {/* Drawer */}
          <aside
            className="absolute inset-y-0 left-0 w-64 bg-white flex flex-col shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex h-14 items-center justify-between px-4 border-b border-gray-100">
              <span className="text-sm font-bold text-indigo-700">Revelation SRS</span>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setMobileOpen(false)}
                className="rounded p-1 text-gray-500 hover:bg-gray-100"
              >
                <span aria-hidden="true" className="block text-lg leading-none font-bold">✕</span>
              </button>
            </div>

            <nav aria-label="Mobile navigation" className="flex-1 overflow-y-auto px-2 py-4 space-y-0.5">
              {navItems}
            </nav>

            <div className="border-t border-gray-100 px-4 py-4">
              {displayName && (
                <p className="text-xs font-medium text-gray-700 truncate mb-1">{displayName}</p>
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="text-xs text-gray-400 hover:text-gray-700"
              >
                {t('nav.signOut')}
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* ── Content area ─────────────────────────────────────── */}
      <div className="flex flex-1 flex-col md:ml-52 min-w-0">

        {/* Mobile top bar */}
        <header className="md:hidden flex h-12 items-center justify-between border-b border-gray-200 bg-white px-4 flex-shrink-0">
          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(true)}
            className="rounded p-1.5 text-gray-500 hover:bg-gray-100"
          >
            <span aria-hidden="true" className="block space-y-1">
              <span className="block h-0.5 w-5 bg-current" />
              <span className="block h-0.5 w-5 bg-current" />
              <span className="block h-0.5 w-5 bg-current" />
            </span>
          </button>
          <span className="text-sm font-bold text-indigo-700">Revelation SRS</span>
          <div className="w-8" /> {/* spacer to centre brand */}
        </header>

        <DemoBanner />

        <main className="flex-1 px-6 py-8 max-w-4xl w-full">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
