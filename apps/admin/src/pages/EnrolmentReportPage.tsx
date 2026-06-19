import { useCallback, useEffect, useState } from 'react';
import { type EnrolmentVolumes, getEnrolmentVolumes } from '../api/reporting.js';
import { ApiError } from '../api/client.js';
import { Spinner } from '../components/Spinner.js';
import { useValueSet } from '../hooks/useValueSet.js';

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
      <h1 className="text-xl font-semibold text-gray-900 mb-4">Enrolment volumes</h1>

      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={() => { void load(); }}
          disabled={loading}
          className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        {data && (
          <span className="text-xs text-gray-400">
            Generated {new Date(data.generatedAt).toLocaleString('en-GB')} · {data.total} enrolments
          </span>
        )}
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : data ? (
        <div className="space-y-6">
          {/* Status summary */}
          <section className="bg-white rounded-lg border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">By status</h2>
            <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
              {statusCodes.map(({ code, displayLabel }) => (
                <div key={code} className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-center">
                  <p className="text-2xl font-bold text-gray-900">{data.byStatus[code] ?? 0}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{displayLabel}</p>
                </div>
              ))}
              <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-center">
                <p className="text-2xl font-bold text-indigo-700">{data.total}</p>
                <p className="text-xs text-gray-500 mt-0.5">Total</p>
              </div>
            </div>
          </section>

          {/* Mode of study */}
          <section className="bg-white rounded-lg border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">By mode of study</h2>
            <div className="flex gap-6">
              {Object.entries(data.byMode).map(([mode, count]) => (
                <div key={mode} className="text-center">
                  <p className="text-xl font-bold text-gray-900">{count}</p>
                  <p className="text-xs text-gray-500 capitalize">{mode}</p>
                </div>
              ))}
              {Object.keys(data.byMode).length === 0 && (
                <p className="text-sm text-gray-400">No data</p>
              )}
            </div>
          </section>

          {/* By academic year */}
          {years.length > 0 && (
            <section className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-700">By academic year of entry</h2>
              </div>
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Year</th>
                    {statusCodes.map(({ code, displayLabel }) => (
                      <th key={code} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{displayLabel}</th>
                    ))}
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {years.map(year => {
                    const row = data.byYearOfEntry[year] ?? {};
                    const rowTotal = Object.values(row).reduce((a, b) => a + b, 0);
                    return (
                      <tr key={year} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-medium text-gray-900">{year}</td>
                        {statusCodes.map(({ code }) => (
                          <td key={code} className="px-4 py-2 text-gray-600">{row[code] ?? 0}</td>
                        ))}
                        <td className="px-4 py-2 font-medium text-gray-700">{rowTotal}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}

          {/* Top programmes */}
          {data.byProgramme.length > 0 && (
            <section className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-700">Top programmes by enrolment</h2>
              </div>
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Programme ID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Enrolments</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.byProgramme.slice(0, 10).map(p => (
                    <tr key={p.programmeId} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono text-xs text-gray-600">{p.programmeId}</td>
                      <td className="px-4 py-2 font-medium text-gray-900">{p.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      ) : null}
    </div>
  );
}
