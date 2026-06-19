import { useEffect, useState } from 'react';
import { listHesaReturns, listUcasApplications, listCasRequests, listComplianceAlerts, type HesaReturn } from '../api/regulatory.js';
import { ApiError } from '../api/client.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';

const CURRENT_YEAR = new Date().getFullYear().toString();

interface StatusSummary {
  hesa:     { total: number; submitted: number; latestStatus: string | null };
  ucas:     { applications: number };
  cas:      { pending: number; total: number };
  ukvi:     { activeAlerts: number };
}

export function RegulatoryStatusPage() {
  const [hesa,       setHesa]       = useState<HesaReturn[]>([]);
  const [summary,    setSummary]    = useState<StatusSummary | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const [hesaReturns, ucasApps, casReqs, alerts] = await Promise.all([
          listHesaReturns(),
          listUcasApplications(),
          listCasRequests(),
          listComplianceAlerts(),
        ]);

        const currentReturns = hesaReturns.filter(r => r.academicYear === CURRENT_YEAR);
        const latestReturn   = currentReturns.at(-1) ?? null;

        setSummary({
          hesa:  {
            total:        currentReturns.length,
            submitted:    currentReturns.filter(r => r.statusCode === 'submitted').length,
            latestStatus: latestReturn?.statusCode ?? null,
          },
          ucas:  { applications: ucasApps.length },
          cas:   {
            pending: casReqs.filter(c => c.statusCode === 'pending').length,
            total:   casReqs.length,
          },
          ukvi: { activeAlerts: alerts.filter(a => a.resolvedAt === null).length },
        });
        setHesa(hesaReturns);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Failed to load regulatory status');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-6">Regulatory submission status</h1>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : summary ? (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              title="HESA returns"
              subtitle={`Academic year ${CURRENT_YEAR}`}
              primary={`${summary.hesa.submitted} / ${summary.hesa.total}`}
              detail="submitted"
              status={summary.hesa.latestStatus}
            />
            <SummaryCard
              title="UCAS applications"
              subtitle="Current cycle"
              primary={String(summary.ucas.applications)}
              detail="total applications"
            />
            <SummaryCard
              title="UKVI CAS requests"
              subtitle="Pending / total"
              primary={`${summary.cas.pending} / ${summary.cas.total}`}
              detail="CAS requests"
            />
            <SummaryCard
              title="UKVI compliance alerts"
              subtitle="Active alerts"
              primary={String(summary.ukvi.activeAlerts)}
              detail="requiring action"
              alert={summary.ukvi.activeAlerts > 0}
            />
          </div>

          {/* HESA returns detail */}
          <section className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">HESA returns</h2>
              <a href="/regulatory/hesa" className="text-xs text-indigo-600 hover:underline">
                Manage →
              </a>
            </div>
            {hesa.length === 0 ? (
              <p className="px-5 py-4 text-sm text-gray-400">No HESA returns recorded.</p>
            ) : (
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Academic year</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Submitted</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {hesa.map(r => (
                    <tr key={r.returnId} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium text-gray-900">{r.academicYear}</td>
                      <td className="px-4 py-2"><Badge value={r.statusCode} /></td>
                      <td className="px-4 py-2 text-gray-500">
                        {r.submittedAt ? new Date(r.submittedAt).toLocaleDateString('en-GB') : '—'}
                      </td>
                      <td className="px-4 py-2 text-gray-500">{r.submissionReference ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Note on SLC and OfS */}
          <p className="text-xs text-gray-400">
            SLC confirmations and OfS extracts are generated on demand — see the{' '}
            <a href="/regulatory" className="text-indigo-600 hover:underline">Regulatory hub</a>.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function SummaryCard({
  title, subtitle, primary, detail, status, alert,
}: {
  title:    string;
  subtitle: string;
  primary:  string;
  detail:   string;
  status?:  string | null;
  alert?:   boolean;
}) {
  return (
    <div className={`rounded-lg border p-4 bg-white ${alert ? 'border-red-200' : 'border-gray-200'}`}>
      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{title}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{primary}</p>
      <p className="text-xs text-gray-400">{detail}</p>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-gray-400">{subtitle}</span>
        {status && <Badge value={status} />}
      </div>
    </div>
  );
}
