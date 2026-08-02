import { Link } from 'react-router-dom';
import type { ComponentType } from 'react';
import { Server, Plug } from 'lucide-react';
import type { Permission } from '@revelation-srs/domain';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { PageHeader } from '@revelation-srs/ui';

const SECTIONS: Array<{
  to: string; name: string; description: string; icon: ComponentType<{ className?: string }>; permission: Permission;
}> = [
  {
    to:          '/operations/environment',
    name:        'Environment runtime',
    description: 'Current release version, migration state, active workflow definitions, and feature flag status',
    icon:        Server,
    permission:  'environment:read',
  },
  {
    to:          '/operations/integrations',
    name:        'Integration operations',
    description: 'Connector health summaries, failed exchange log, retry/replay controls, and VLE connector residual status',
    icon:        Plug,
    permission:  'integration:read',
  },
];

export function OperationsPage() {
  const { roles } = useAuth();
  const sections = SECTIONS.filter(({ permission }) => userHasAnyPermission(roles, [permission]));
  return (
    <div>
      <PageHeader title="Operations" description="System health, environment state, and integration operational controls." />
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
