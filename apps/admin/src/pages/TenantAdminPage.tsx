import { Link } from 'react-router-dom';
import type { ComponentType } from 'react';
import { Landmark, Rows3, Globe, Ruler, Workflow, Flag, Plug, Archive } from 'lucide-react';
import type { Permission } from '@revelation-srs/domain';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { PageHeader } from '@revelation-srs/ui';

const SECTIONS: Array<{
  to: string; name: string; description: string; icon: ComponentType<{ className?: string }>; permission: Permission;
}> = [
  {
    to:          '/tenant-admin/config',
    name:        'Tenant configuration',
    description: 'Institution name, academic year, locale, HESA/UCAS identifiers',
    icon:        Landmark,
    permission:  'config:read',
  },
  {
    to:          '/tenant-admin/value-sets',
    name:        'Value sets',
    description: 'Manage codelist members used across data entry and reporting',
    icon:        Rows3,
    permission:  'config:read',
  },
  {
    to:          '/tenant-admin/globalisation',
    name:        'Globalisation',
    description: 'Locale, timezone, currency, and value-set label overrides',
    icon:        Globe,
    permission:  'globalisation:read',
  },
  {
    to:          '/tenant-admin/rules',
    name:        'Academic rules',
    description: 'Progression, classification, assessment, and award eligibility rules',
    icon:        Ruler,
    permission:  'rule:read',
  },
  {
    to:          '/tenant-admin/workflows',
    name:        'Workflow definitions',
    description: 'Workflow types, versions, and responsibility assignment rules',
    icon:        Workflow,
    permission:  'workflow:read',
  },
  {
    to:          '/tenant-admin/flags',
    name:        'Feature flags',
    description: 'Feature flag registry — assignments, governance, retirement',
    icon:        Flag,
    permission:  'feature-flag:read',
  },
  {
    to:          '/tenant-admin/integrations',
    name:        'Integrations',
    description: 'Integration contract catalogue, registrations, health, and replay',
    icon:        Plug,
    permission:  'integration:read',
  },
  {
    to:          '/tenant-admin/audit',
    name:        'Audit log',
    description: 'Integration exchange history and system audit records',
    icon:        Archive,
    permission:  'audit-log:read',
  },
];

export function TenantAdminPage() {
  const { roles } = useAuth();
  const sections = SECTIONS.filter(({ permission }) => userHasAnyPermission(roles, [permission]));
  return (
    <div>
      <PageHeader title="Tenant administration" description="Configure the institution, manage system rules, and operate integrations." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map(({ to, name, description, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex gap-4 items-start rounded-xl border border-neutral-200 bg-white p-5 shadow-card hover:border-primary-300 hover:shadow-card-hover transition-shadow"
          >
            <span className="rounded-md bg-primary-50 p-1.5 text-primary-600">
              <Icon className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-primary-700">{name}</h2>
              <p className="text-xs text-neutral-500 mt-0.5">{description}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
