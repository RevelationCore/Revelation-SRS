import { useEffect, useState } from 'react';
import { listHesaReturns, listUcasApplications, listCasRequests, listComplianceAlerts, type HesaReturn } from '../api/regulatory.js';
import { ApiError } from '../api/client.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';
import { PageHeader, Card, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from '@revelation-srs/ui';

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
      <PageHeader title="Regulatory submission status" />

      {error && <p className="mb-4 text-sm text-danger-600">{error}</p>}

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
          <Card className="overflow-hidden">
            <div className="px-5 py-3 border-b border-neutral-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-700">HESA returns</h2>
              <a href="/regulatory/hesa" className="text-xs text-primary-600 hover:underline">
                Manage →
              </a>
            </div>
            {hesa.length === 0 ? (
              <p className="px-5 py-4 text-sm text-neutral-600">No HESA returns recorded.</p>
            ) : (
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Academic year</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell>Submitted</TableHeaderCell>
                    <TableHeaderCell>Reference</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {hesa.map(r => (
                    <TableRow key={r.returnId}>
                      <TableCell className="font-medium text-neutral-900">{r.academicYear}</TableCell>
                      <TableCell><Badge value={r.statusCode} /></TableCell>
                      <TableCell>
                        {r.submittedAt ? new Date(r.submittedAt).toLocaleDateString('en-GB') : '—'}
                      </TableCell>
                      <TableCell>{r.submissionReference ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>

          {/* Note on SLC and OfS */}
          <p className="text-xs text-neutral-600">
            SLC confirmations and OfS extracts are generated on demand — see the{' '}
            <a href="/regulatory" className="text-primary-700 underline hover:no-underline">Regulatory hub</a>.
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
    <div className={`rounded-lg border p-4 bg-white ${alert ? 'border-danger-200' : 'border-neutral-200'}`}>
      <p className="text-xs text-neutral-500 font-medium uppercase tracking-wide">{title}</p>
      <p className="text-2xl font-bold text-neutral-900 mt-1">{primary}</p>
      <p className="text-xs text-neutral-600">{detail}</p>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-neutral-600">{subtitle}</span>
        {status && <Badge value={status} />}
      </div>
    </div>
  );
}
