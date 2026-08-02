import { useCallback, useEffect, useState } from 'react';
import { type EnrolmentVolumes, getEnrolmentVolumes } from '../api/reporting.js';
import { ApiError } from '../api/client.js';
import { Spinner } from '../components/Spinner.js';
import { useValueSet } from '../hooks/useValueSet.js';
import {
  PageHeader, Button, Card, CardHeader, CardBody, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';

export function EnrolmentReportPage() {
  const [data,    setData]    = useState<EnrolmentVolumes | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const { members: statusCodes } = useValueSet('enrolment', 'status_code');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setData(await getEnrolmentVolumes());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const years = data ? Object.keys(data.byYearOfEntry).sort().reverse() : [];

  return (
    <div>
      <PageHeader
        title="Enrolment volumes"
        actions={<Button onClick={() => { void load(); }} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</Button>}
        description={data ? `Generated ${new Date(data.generatedAt).toLocaleString('en-GB')} · ${data.total} enrolments` : undefined}
      />

      {error && <p className="mb-4 text-sm text-danger-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : data ? (
        <div className="space-y-6">
          {/* Status summary */}
          <Card>
            <CardHeader title="By status" />
            <CardBody>
            <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
              {statusCodes.map(({ code, displayLabel }) => (
                <div key={code} className="rounded-lg border border-neutral-100 bg-neutral-50 p-3 text-center">
                  <p className="text-2xl font-bold text-neutral-900">{data.byStatus[code] ?? 0}</p>
                  <p className="text-xs text-neutral-500 mt-0.5">{displayLabel}</p>
                </div>
              ))}
              <div className="rounded-lg border border-primary-100 bg-primary-50 p-3 text-center">
                <p className="text-2xl font-bold text-primary-700">{data.total}</p>
                <p className="text-xs text-neutral-500 mt-0.5">Total</p>
              </div>
            </div>
            </CardBody>
          </Card>

          {/* Mode of study */}
          <Card>
            <CardHeader title="By mode of study" />
            <CardBody>
            <div className="flex gap-6">
              {Object.entries(data.byMode).map(([mode, count]) => (
                <div key={mode} className="text-center">
                  <p className="text-xl font-bold text-neutral-900">{count}</p>
                  <p className="text-xs text-neutral-500 capitalize">{mode}</p>
                </div>
              ))}
              {Object.keys(data.byMode).length === 0 && (
                <p className="text-sm text-neutral-600">No data</p>
              )}
            </div>
            </CardBody>
          </Card>

          {/* By academic year */}
          {years.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-5 py-3 border-b border-neutral-100">
                <h2 className="text-sm font-semibold text-neutral-700">By academic year of entry</h2>
              </div>
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Year</TableHeaderCell>
                    {statusCodes.map(({ code, displayLabel }) => (
                      <TableHeaderCell key={code}>{displayLabel}</TableHeaderCell>
                    ))}
                    <TableHeaderCell>Total</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {years.map(year => {
                    const row = data.byYearOfEntry[year] ?? {};
                    const rowTotal = Object.values(row).reduce((a, b) => a + b, 0);
                    return (
                      <TableRow key={year}>
                        <TableCell className="font-medium text-neutral-900">{year}</TableCell>
                        {statusCodes.map(({ code }) => (
                          <TableCell key={code}>{row[code] ?? 0}</TableCell>
                        ))}
                        <TableCell className="font-medium text-neutral-700">{rowTotal}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}

          {/* Top programmes */}
          {data.byProgramme.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-5 py-3 border-b border-neutral-100">
                <h2 className="text-sm font-semibold text-neutral-700">Top programmes by enrolment</h2>
              </div>
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Programme</TableHeaderCell>
                    <TableHeaderCell>Enrolments</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {data.byProgramme.slice(0, 10).map(p => (
                    <TableRow key={p.programmeId}>
                      <TableCell className="text-neutral-900">
                        {p.programmeCode && <span className="font-mono text-xs text-neutral-500 mr-1">{p.programmeCode}</span>}
                        {p.programmeName ?? <span className="text-neutral-600 italic">Unknown</span>}
                      </TableCell>
                      <TableCell className="font-medium text-neutral-900">{p.count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </div>
      ) : null}
    </div>
  );
}
