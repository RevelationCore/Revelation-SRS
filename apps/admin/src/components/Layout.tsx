import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { getDisplayName } from '@revelation-srs/ui';
import { DemoBanner } from './DemoBanner.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import type { Permission } from '@revelation-srs/domain';

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
    <p className="px-3 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-gray-600 select-none">
      {children}
    </p>
  );
}

function SectionNavLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `block px-3 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider transition-colors ${
          isActive ? 'text-indigo-600' : 'text-gray-600 hover:text-gray-700'
        }`
      }
    >
      {children}
    </NavLink>
  );
}

function Divider() {
  return <div className="my-2 border-t border-gray-100" />;
}

// ── Sidebar nav ───────────────────────────────────────────────────────────────

function Sidebar({ onLogout, displayName, roles }: { onLogout: () => void; displayName: string | null; roles: string[] }) {
  const can = (...permissions: Permission[]) => userHasAnyPermission(roles, permissions);
  const canViewStudents = can('student:read:all');
  const canViewTasks = can('workflow-task:complete');
  const canViewExamBoards = can('exam-board:read');
  const canViewEngagement = can(
    'engagement:event:read',
    'engagement:timeline:read',
    'engagement:policy:read',
    'engagement:alert:read',
  );
  const canViewRegulatory = can('regulatory:read');
  const canViewEnrolmentReporting = can('enrolment:read:all');
  const canViewAdministration = can(
    'config:read',
    'globalisation:read',
    'rule:read',
    'workflow:read',
    'feature-flag:read',
    'integration:read',
    'audit-log:read',
  );
  const canViewOperations = can('environment:read', 'integration:read');
  return (
    <aside className="fixed inset-y-0 left-0 z-20 flex w-56 flex-col bg-white border-r border-gray-200">
      {/* Brand */}
      <div className="flex h-14 items-center px-4 border-b border-gray-100 flex-shrink-0">
        <Link to="/" className="text-sm font-bold text-indigo-700 tracking-tight leading-tight">
          Revelation<br />
          <span className="text-xs font-semibold text-indigo-600 tracking-widest">SRS</span>
        </Link>
      </div>

      {/* Scrollable nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <NavItem to="/dashboard" label="Dashboard" end />
        {canViewStudents && <NavItem to="/students" label="Students" />}
        {canViewTasks && <NavItem to="/tasks" label="Tasks" end />}
        {canViewExamBoards && <NavItem to="/exam-boards" label="Exam boards" />}
        {canViewEngagement && <NavItem to="/engagement" label="Engagement" />}

        {canViewRegulatory && <>
          <Divider />
          <SectionNavLink to="/regulatory">Regulatory</SectionNavLink>
          <SubItem to="/regulatory/hesa" label="HESA" />
          <SubItem to="/regulatory/ucas" label="UCAS" />
          <SubItem to="/regulatory/slc"  label="SLC" />
          <SubItem to="/regulatory/ukvi" label="UKVI" />
          <SubItem to="/regulatory/ofs"  label="OfS" />
        </>}

        {(canViewEnrolmentReporting || canViewRegulatory) && <>
          <Divider />
          <SectionNavLink to="/reporting">Reporting</SectionNavLink>
          {canViewEnrolmentReporting && <SubItem to="/reporting/enrolments" label="Enrolments" />}
          {canViewRegulatory && <SubItem to="/reporting/regulatory-status" label="Regulatory status" />}
          {canViewRegulatory && <SubItem to="/reporting/foi" label="FOI / SAR" />}
        </>}

        {canViewAdministration && <>
          <Divider />
          <SectionNavLink to="/tenant-admin">Administration</SectionNavLink>
          {can('config:read') && <SubItem to="/tenant-admin/config" label="Configuration" />}
          {can('config:read') && <SubItem to="/tenant-admin/value-sets" label="Value sets" />}
          {can('globalisation:read') && <SubItem to="/tenant-admin/globalisation" label="Globalisation" />}
          {can('rule:read') && <SubItem to="/tenant-admin/rules" label="Academic rules" />}
          {can('workflow:read') && <SubItem to="/tenant-admin/workflows" label="Workflows" />}
          {can('feature-flag:read') && <SubItem to="/tenant-admin/flags" label="Feature flags" />}
          {can('integration:read') && <SubItem to="/tenant-admin/integrations" label="Integrations" />}
          {can('audit-log:read') && <SubItem to="/tenant-admin/audit" label="Audit log" />}
        </>}

        {canViewOperations && <>
          <Divider />
          <SectionNavLink to="/operations">Operations</SectionNavLink>
          {can('environment:read') && <SubItem to="/operations/environment" label="Environment" />}
          {can('integration:read') && <SubItem to="/operations/integrations" label="Integrations" />}
        </>}
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
          className="text-xs text-gray-600 hover:text-gray-700 transition-colors"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}

// ── Layout ────────────────────────────────────────────────────────────────────

export function Layout({ children }: { children: React.ReactNode }) {
  const { logout, user, roles, sessionExpired } = useAuth();
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
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar onLogout={handleLogout} displayName={displayName} roles={roles} />

      {/* Content area — offset by sidebar width */}
      <div className="flex flex-col flex-1 ml-56 min-w-0 overflow-hidden">
        <DemoBanner />
        <main className="flex-1 min-h-0 overflow-y-auto px-8 py-8 max-w-6xl w-full">
          {children}
        </main>
      </div>
    </div>
  );
}
