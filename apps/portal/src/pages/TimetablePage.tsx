import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';
import { getEnrolments, getTimetable } from '../api/me.js';
import { Spinner, Problem, EmptyState, formatDate } from '@revelation-srs/ui';

export function TimetablePage() {
  const { t }    = useTranslation();
  const { user } = useAuth();
  const personId = user?.sub ?? null;

  const fetchEnrolments = useCallback(
    () => personId ? getEnrolments(personId) : Promise.reject(new Error('')),
    [personId],
  );
  const { data: enrolments, loading: eLoading, error: eError } = useApiData(personId ? fetchEnrolments : null);

  const currentEnrolment = enrolments?.find(e => e.statusCode === 'enrolled') ?? enrolments?.[0] ?? null;

  const fetchTimetable = useCallback(
    () => currentEnrolment ? getTimetable(currentEnrolment.enrolmentId) : Promise.reject(new Error('')),
    [currentEnrolment?.enrolmentId], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const { data: entries, loading: tLoading, error: tError } = useApiData(
    currentEnrolment ? fetchTimetable : null,
  );

  const loading = eLoading || tLoading;
  const error   = eError ?? tError;

  if (loading) {
    return <div className="flex justify-center py-16"><Spinner size="lg" label={t('status.loading')} /></div>;
  }

  // Group entries by period
  const byPeriod: Record<string, typeof entries> = {};
  for (const entry of entries ?? []) {
    const key = `${entry.academicYear} — ${entry.periodCode}`;
    (byPeriod[key] ??= []).push(entry);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('portal.nav.timetable')}</h1>
        {currentEnrolment && (
          <p className="mt-1 text-sm text-gray-500">
            Academic year {currentEnrolment.academicYearOfEntry}
          </p>
        )}
      </div>

      {error && <Problem title={t('status.error')} detail={error} />}

      {!error && Object.keys(byPeriod).length === 0 && (
        <EmptyState title="No timetable entries found for the current enrolment." />
      )}

      {Object.entries(byPeriod).map(([period, periodEntries]) => (
        <section key={period} aria-labelledby={`period-${period}`}>
          <h2 id={`period-${period}`} className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            {period}
          </h2>
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Module</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Title</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Start</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">End</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Delivery</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(periodEntries ?? []).map(e => (
                  <tr key={e.moduleRegistrationId} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-800">{e.moduleCode}</td>
                    <td className="px-4 py-3 text-gray-900">{e.moduleTitle}</td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(e.startDate)}</td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(e.endDate)}</td>
                    <td className="px-4 py-3 text-gray-600">{e.deliveryModeCode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
