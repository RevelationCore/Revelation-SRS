import { Link } from 'react-router-dom';

const SECTIONS = [
  {
    to:          '/tenant-admin/config',
    name:        'Tenant configuration',
    description: 'Institution name, academic year, locale, HESA/UCAS identifiers',
    icon:        '🏛',
  },
  {
    to:          '/tenant-admin/value-sets',
    name:        'Value sets',
    description: 'Manage codelist members used across data entry and reporting',
    icon:        '📋',
  },
  {
    to:          '/tenant-admin/globalisation',
    name:        'Globalisation',
    description: 'Locale, timezone, currency, and value-set label overrides',
    icon:        '🌐',
  },
  {
    to:          '/tenant-admin/rules',
    name:        'Academic rules',
    description: 'Progression, classification, assessment, and award eligibility rules',
    icon:        '📐',
  },
  {
    to:          '/tenant-admin/workflows',
    name:        'Workflow definitions',
    description: 'Workflow types, versions, and responsibility assignment rules',
    icon:        '⚙️',
  },
  {
    to:          '/tenant-admin/flags',
    name:        'Feature flags',
    description: 'Feature flag registry — assignments, governance, retirement',
    icon:        '🚩',
  },
  {
    to:          '/tenant-admin/integrations',
    name:        'Integrations',
    description: 'Integration contract catalogue, registrations, health, and replay',
    icon:        '🔌',
  },
  {
    to:          '/tenant-admin/audit',
    name:        'Audit log',
    description: 'Integration exchange history and system audit records',
    icon:        '🗂',
  },
];

export function TenantAdminPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-2">Tenant administration</h1>
      <p className="text-sm text-gray-500 mb-6">
        Configure the institution, manage system rules, and operate integrations.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map(({ to, name, description, icon }) => (
          <Link
            key={to}
            to={to}
            className="flex gap-4 items-start rounded-lg border border-gray-200 bg-white p-5 hover:border-indigo-300 hover:shadow-sm transition-shadow"
          >
            <span className="text-2xl leading-none mt-0.5">{icon}</span>
            <div>
              <h2 className="text-sm font-semibold text-indigo-700">{name}</h2>
              <p className="text-xs text-gray-500 mt-0.5">{description}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
