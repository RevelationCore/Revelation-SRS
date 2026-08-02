import { Link } from 'react-router-dom';
import { BarChart3, ClipboardList, Unlock } from 'lucide-react';
import { PageHeader } from '@revelation-srs/ui';

const SECTIONS = [
  {
    to:          '/reporting/enrolments',
    name:        'Enrolment volumes',
    description: 'Active, intermitted, withdrawn, and graduated enrolment counts by status and year of entry',
    icon:        BarChart3,
  },
  {
    to:          '/reporting/regulatory-status',
    name:        'Regulatory submission status',
    description: 'Overview of HESA, SLC, UCAS, UKVI, and OfS submission state for the current year',
    icon:        ClipboardList,
  },
  {
    to:          '/reporting/foi',
    name:        'Freedom of Information',
    description: 'FOI / SAR request register, extract trigger, and status tracking',
    icon:        Unlock,
  },
];

export function ReportingPage() {
  return (
    <div>
      <PageHeader title="Reporting" description="Operational reports and data extracts. Data is read live from the SRS API." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map(({ to, name, description, icon: Icon }) => (
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
