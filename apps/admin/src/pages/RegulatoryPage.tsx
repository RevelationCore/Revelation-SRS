import { Link } from 'react-router-dom';

const BODIES = [
  {
    to:          '/regulatory/hesa',
    name:        'HESA',
    description: 'Higher Education Statistics Agency — annual student data returns',
  },
  {
    to:          '/regulatory/ucas',
    name:        'UCAS',
    description: 'Universities and Colleges Admissions Service — application confirmations',
  },
  {
    to:          '/regulatory/slc',
    name:        'SLC',
    description: 'Student Loans Company — enrolment and completion confirmations',
  },
  {
    to:          '/regulatory/ukvi',
    name:        'UKVI',
    description: 'UK Visas and Immigration — CAS requests and attendance compliance',
  },
  {
    to:          '/regulatory/ofs',
    name:        'OfS',
    description: "Office for Students — B3 extracts and participation metrics",
  },
];

export function RegulatoryPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-6">Regulatory returns</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {BODIES.map(({ to, name, description }) => (
          <Link
            key={to}
            to={to}
            className="block rounded-lg border border-gray-200 bg-white p-5 hover:border-indigo-300 hover:shadow-sm transition-shadow"
          >
            <h2 className="text-base font-semibold text-indigo-700 mb-1">{name}</h2>
            <p className="text-sm text-gray-600">{description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
