import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard, UserCircle, GraduationCap, BookOpen, FileText, Calendar,
  PenSquare, Accessibility, HeartPulse, AlertTriangle, Bell, Menu, X, LogOut,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { useAuth } from '../auth/AuthContext.js';
import { getDisplayName } from '@revelation-srs/ui';
import { DemoBanner } from './DemoBanner.js';

const NAV_ITEMS: Array<{ to: string; label: string; icon: ComponentType<{ className?: string }> }> = [
  { to: '/dashboard',     label: 'portal.nav.dashboard',     icon: LayoutDashboard },
  { to: '/profile',       label: 'portal.nav.profile',       icon: UserCircle },
  { to: '/enrolments',    label: 'portal.nav.enrolments',    icon: GraduationCap },
  { to: '/modules',       label: 'portal.nav.modules',       icon: BookOpen },
  { to: '/results',       label: 'portal.nav.results',       icon: FileText },
  { to: '/timetable',     label: 'portal.nav.timetable',     icon: Calendar },
  { to: '/exams',         label: 'portal.nav.exams',         icon: PenSquare },
  { to: '/adjustments',   label: 'portal.nav.adjustments',   icon: Accessibility },
  { to: '/disability',    label: 'portal.nav.disability',    icon: HeartPulse },
  { to: '/circumstances', label: 'portal.nav.circumstances', icon: AlertTriangle },
  { to: '/notifications', label: 'portal.nav.notifications', icon: Bell },
];

function navLinkClass({ isActive }: { isActive: boolean }) {
  return `flex items-center gap-2.5 px-3 py-2 text-sm rounded-md transition-colors ${
    isActive
      ? 'bg-primary-50 text-primary-700 font-medium'
      : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
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
      {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={navLinkClass}
          onClick={() => setMobileOpen(false)}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {t(label)}
        </NavLink>
      ))}
    </>
  );

  return (
    <div className="flex min-h-screen bg-neutral-50">

      {/* ── Desktop sidebar ──────────────────────────────────── */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 z-20 w-52 flex-col bg-white border-r border-neutral-200">
        {/* Brand */}
        <div className="flex h-14 items-center px-4 border-b border-neutral-100 flex-shrink-0">
          <NavLink to="/dashboard" className="text-sm font-bold text-primary-700 tracking-tight leading-tight">
            Revelation<br />
            <span className="text-xs font-semibold text-primary-500 tracking-widest">Student Portal</span>
          </NavLink>
        </div>

        {/* Nav links */}
        <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 py-4 space-y-0.5">
          {navItems}
        </nav>

        {/* User footer */}
        <div className="flex-shrink-0 border-t border-neutral-100 px-4 py-4">
          {displayName && (
            <p className="text-xs font-medium text-neutral-700 truncate mb-1" title={displayName}>
              {displayName}
            </p>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-900 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
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
            className="absolute inset-y-0 left-0 w-64 bg-white flex flex-col shadow-popover"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex h-14 items-center justify-between px-4 border-b border-neutral-100">
              <span className="text-sm font-bold text-primary-700">Revelation SRS</span>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setMobileOpen(false)}
                className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <nav aria-label="Mobile navigation" className="flex-1 overflow-y-auto px-2 py-4 space-y-0.5">
              {navItems}
            </nav>

            <div className="border-t border-neutral-100 px-4 py-4">
              {displayName && (
                <p className="text-xs font-medium text-neutral-700 truncate mb-1">{displayName}</p>
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-900"
              >
                <LogOut className="h-3.5 w-3.5" />
                {t('nav.signOut')}
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* ── Content area ─────────────────────────────────────── */}
      <div className="flex flex-1 flex-col md:ml-52 min-w-0">

        {/* Mobile top bar */}
        <header className="md:hidden flex h-12 items-center justify-between border-b border-neutral-200 bg-white px-4 flex-shrink-0">
          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(true)}
            className="rounded p-1.5 text-neutral-500 hover:bg-neutral-100"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <span className="text-sm font-bold text-primary-700">Revelation SRS</span>
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
