import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { getDisplayName } from '@revelation-srs/ui';
import { DemoBanner } from './DemoBanner.js';

// ── Nav primitives ────────────────────────────────────────────────────────────

function NavItem({ to, label, end }: { to: string; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center px-3 py-1.5 text-sm rounded-md transition-colors ${
          isActive
            ? 'bg-indigo-50 text-indigo-700 font-medium'
            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
        }`
      }
    >
      {label}
    </NavLink>
  );
}

function SubItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center pl-5 pr-3 py-1.5 text-sm rounded-md transition-colors ${
          isActive
            ? 'bg-indigo-50 text-indigo-700 font-medium'
            : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
        }`
      }
    >
      {label}
    </NavLink>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-gray-400 select-none">
      {children}
    </p>
  );
}

function Divider() {
  return <div className="my-2 border-t border-gray-100" />;
}

// ── Sidebar nav ───────────────────────────────────────────────────────────────

function Sidebar({ onLogout, displayName }: { onLogout: () => void; displayName: string | null }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-20 flex w-56 flex-col bg-white border-r border-gray-200">
      {/* Brand */}
      <div className="flex h-14 items-center px-4 border-b border-gray-100 flex-shrink-0">
        <Link to="/" className="text-sm font-bold text-indigo-700 tracking-tight leading-tight">
          Revelation<br />
          <span className="text-xs font-semibold text-indigo-400 tracking-widest">SRS</span>
        </Link>
      </div>

      {/* Scrollable nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <NavItem to="/dashboard" label="Dashboard" end />
        <NavItem to="/students"  label="Students" />
        <NavItem to="/tasks"     label="Tasks" end />
        <NavItem to="/exam-boards" label="Exam boards" />

        <Divider />
        <SectionLabel>Regulatory</SectionLabel>
        <SubItem to="/regulatory/hesa" label="HESA" />
        <SubItem to="/regulatory/ucas" label="UCAS" />
        <SubItem to="/regulatory/slc"  label="SLC" />
        <SubItem to="/regulatory/ukvi" label="UKVI" />
        <SubItem to="/regulatory/ofs"  label="OfS" />

        <Divider />
        <SectionLabel>Reporting</SectionLabel>
        <SubItem to="/reporting/enrolments"        label="Enrolments" />
        <SubItem to="/reporting/regulatory-status" label="Regulatory status" />
        <SubItem to="/reporting/foi"               label="FOI / SAR" />

        <Divider />
        <SectionLabel>Administration</SectionLabel>
        <SubItem to="/tenant-admin/config"        label="Configuration" />
        <SubItem to="/tenant-admin/value-sets"    label="Value sets" />
        <SubItem to="/tenant-admin/globalisation" label="Globalisation" />
        <SubItem to="/tenant-admin/rules"         label="Academic rules" />
        <SubItem to="/tenant-admin/workflows"     label="Workflows" />
        <SubItem to="/tenant-admin/flags"         label="Feature flags" />
        <SubItem to="/tenant-admin/integrations"  label="Integrations" />
        <SubItem to="/tenant-admin/audit"         label="Audit log" />

        <Divider />
        <SectionLabel>Operations</SectionLabel>
        <SubItem to="/operations/environment"  label="Environment" />
        <SubItem to="/operations/integrations" label="Integrations" />
      </nav>

      {/* User footer */}
      <div className="flex-shrink-0 border-t border-gray-100 px-4 py-4">
        {displayName && (
          <p className="text-xs font-medium text-gray-700 truncate mb-1" title={displayName}>
            {displayName}
          </p>
        )}
        <button
          onClick={onLogout}
          className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}

// ── Layout ────────────────────────────────────────────────────────────────────

export function Layout({ children }: { children: React.ReactNode }) {
  const { logout, user, sessionExpired } = useAuth();
  const navigate    = useNavigate();
  const { t }       = useTranslation();
  const displayName = user ? getDisplayName(user) : null;

  function handleLogout() {
    logout();
    navigate('/login');
  }

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
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar onLogout={handleLogout} displayName={displayName} />

      {/* Content area — offset by sidebar width */}
      <div className="flex flex-1 flex-col ml-56 min-w-0">
        <DemoBanner />
        <main className="flex-1 px-8 py-8 max-w-6xl w-full">
          {children}
        </main>
      </div>
    </div>
  );
}
