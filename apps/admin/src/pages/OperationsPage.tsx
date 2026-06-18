import { Link } from 'react-router-dom';

const SECTIONS = [
  {
    to:          '/operations/environment',
    name:        'Environment runtime',
    description: 'Current release version, migration state, active workflow definitions, and feature flag status',
    icon:        '🖥',
  },
  {
    to:          '/operations/integrations',
    name:        'Integration operations',
    description: 'Connector health summaries, failed exchange log, retry/replay controls, and VLE connector residual status',
    icon:        '🔌',
  },
];

export function OperationsPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-2">Operations</h1>
      <p className="text-sm text-gray-500 mb-6">
        System health, environment state, and integration operational controls.
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
