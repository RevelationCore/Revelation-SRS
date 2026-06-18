import { Link } from 'react-router-dom';

const SECTIONS = [
  {
    to:          '/reporting/enrolments',
    name:        'Enrolment volumes',
    description: 'Active, intermitted, withdrawn, and graduated enrolment counts by status and year of entry',
    icon:        '📊',
  },
  {
    to:          '/reporting/regulatory-status',
    name:        'Regulatory submission status',
    description: 'Overview of HESA, SLC, UCAS, UKVI, and OfS submission state for the current year',
    icon:        '📋',
  },
  {
    to:          '/reporting/foi',
    name:        'Freedom of Information',
    description: 'FOI / SAR request register, extract trigger, and status tracking',
    icon:        '🔓',
  },
];

export function ReportingPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-2">Reporting</h1>
      <p className="text-sm text-gray-500 mb-6">
        Operational reports and data extracts. Data is read live from the SRS API.
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
