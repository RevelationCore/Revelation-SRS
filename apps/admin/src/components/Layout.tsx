import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard, Users, ListChecks, GraduationCap, Activity, Landmark,
  BarChart3, Settings, Server, Clock, LogOut, ShieldCheck,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { useAuth } from '../auth/AuthContext.js';
import { getDisplayName } from '@revelation-srs/ui';
import { DemoBanner } from './DemoBanner.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import type { Permission } from '@revelation-srs/domain';

// ── Nav primitives ────────────────────────────────────────────────────────────

function NavItem({ to, label, end, icon: Icon }: { to: string; label: string; end?: boolean; icon?: ComponentType<{ className?: string }> }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
          isActive
            ? 'bg-primary-50 text-primary-700 font-medium'
            : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
        }`
      }
    >
      {Icon && <Icon className="h-4 w-4 shrink-0" />}
      {label}
    </NavLink>
  );
}

function SubItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center pl-8 pr-3 py-1.5 text-sm rounded-md transition-colors ${
          isActive
            ? 'bg-primary-50 text-primary-700 font-medium'
            : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900'
        }`
      }
    >
      {label}
    </NavLink>
  );
}

function SectionNavLink({ to, icon: Icon, children }: { to: string; icon?: ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-3 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider transition-colors ${
          isActive ? 'text-primary-600' : 'text-neutral-600 hover:text-neutral-700'
        }`
      }
    >
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
      {children}
    </NavLink>
  );
}

function Divider() {
  return <div className="my-2 border-t border-neutral-100" />;
}

function SectionLabel({ icon: Icon, children }: { icon?: ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2.5 px-3 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-neutral-600 select-none">
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
      {children}
    </p>
  );
}

// ── Sidebar nav ───────────────────────────────────────────────────────────────

function Sidebar({ onLogout, displayName, roles }: { onLogout: () => void; displayName: string | null; roles: string[] }) {
  const can = (...permissions: Permission[]) => userHasAnyPermission(roles, permissions);
  const canViewStudents = can('student:read:all');
  const canViewTasks = can('workflow-task:complete');
  const canViewModuleSelectionProposals = can('module-selection:decide', 'module-selection:read:all');
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
  const canViewModeration = can('mark:write');
  const canViewRegulatoryCollections = can('regulatory:write');
  const canViewIdentityResolution = can('identity:manage');
  const canViewRightsRequests = can('identity:manage', 'retention:enforce');
  const canViewAuditReview = can('audit-log:read');
  const canViewGovernance = canViewModeration || canViewRegulatoryCollections
    || canViewIdentityResolution || canViewRightsRequests || canViewAuditReview;
  return (
    <aside className="fixed inset-y-0 left-0 z-20 flex w-56 flex-col bg-white border-r border-neutral-200">
      {/* Brand */}
      <div className="flex h-14 items-center px-4 border-b border-neutral-100 flex-shrink-0">
        <Link to="/" className="text-sm font-bold text-primary-700 tracking-tight leading-tight">
          Revelation<br />
          <span className="text-xs font-semibold text-primary-600 tracking-widest">SRS</span>
        </Link>
      </div>

      {/* Scrollable nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <NavItem to="/dashboard" label="Dashboard" end icon={LayoutDashboard} />
        {canViewStudents && <NavItem to="/students" label="Students" icon={Users} />}
        {canViewTasks && <NavItem to="/tasks" label="Tasks" end icon={ListChecks} />}
        {canViewModuleSelectionProposals && <NavItem to="/module-selection-proposals" label="Module selection" end icon={ListChecks} />}
        {canViewExamBoards && <NavItem to="/exam-boards" label="Exam boards" icon={GraduationCap} />}
        {canViewEngagement && <NavItem to="/engagement" label="Engagement" icon={Activity} />}

        {canViewRegulatory && <>
          <Divider />
          <SectionNavLink to="/regulatory" icon={Landmark}>Regulatory</SectionNavLink>
          <SubItem to="/regulatory/hesa" label="HESA" />
          <SubItem to="/regulatory/ucas" label="UCAS" />
          <SubItem to="/regulatory/slc"  label="SLC" />
          <SubItem to="/regulatory/ukvi" label="UKVI" />
          <SubItem to="/regulatory/ofs"  label="OfS" />
        </>}

        {canViewGovernance && <>
          <Divider />
          <SectionLabel icon={ShieldCheck}>Governance</SectionLabel>
          {canViewModeration && <SubItem to="/governance/moderation" label="Moderation" />}
          {canViewRegulatoryCollections && <SubItem to="/governance/regulatory-collections" label="Regulatory collections" />}
          {canViewIdentityResolution && <SubItem to="/governance/identity-resolution" label="Identity resolution" />}
          {canViewRightsRequests && <SubItem to="/governance/rights-requests" label="Rights requests" />}
          {canViewAuditReview && <SubItem to="/governance/audit-review" label="Audit review" />}
        </>}

        {(canViewEnrolmentReporting || canViewRegulatory) && <>
          <Divider />
          <SectionNavLink to="/reporting" icon={BarChart3}>Reporting</SectionNavLink>
          {canViewEnrolmentReporting && <SubItem to="/reporting/enrolments" label="Enrolments" />}
          {canViewRegulatory && <SubItem to="/reporting/regulatory-status" label="Regulatory status" />}
          {canViewRegulatory && <SubItem to="/reporting/foi" label="FOI / SAR" />}
        </>}

        {canViewAdministration && <>
          <Divider />
          <SectionNavLink to="/tenant-admin" icon={Settings}>Administration</SectionNavLink>
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
          <SectionNavLink to="/operations" icon={Server}>Operations</SectionNavLink>
          {can('environment:read') && <SubItem to="/operations/environment" label="Environment" />}
          {can('integration:read') && <SubItem to="/operations/integrations" label="Integrations" />}
        </>}
      </nav>

      {/* User footer */}
      <div className="flex-shrink-0 border-t border-neutral-100 px-4 py-4">
        {displayName && (
          <p className="text-xs font-medium text-neutral-700 truncate mb-1" title={displayName}>
            {displayName}
          </p>
        )}
        <button
          onClick={onLogout}
          className="flex items-center gap-1.5 text-xs text-neutral-600 hover:text-neutral-900 transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" />
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
      <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4 text-center">
        <Clock className="h-12 w-12 text-neutral-300" aria-hidden="true" />
        <h1 className="mt-4 text-xl font-semibold text-neutral-800">{t('auth.sessionExpired')}</h1>
        <a
          href="/login"
          className="mt-6 rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-500"
        >
          {t('auth.signInWithKeycloak')}
        </a>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-neutral-50">
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
