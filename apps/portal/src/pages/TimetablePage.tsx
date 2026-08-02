import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';
import { getEnrolments, getTimetable } from '../api/me.js';
import {
  Spinner, Problem, EmptyState, formatDate, PageHeader,
  Card, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';

export function TimetablePage() {
  const { t }    = useTranslation();
  const { personId } = useAuth();

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
    <div>
      <PageHeader
        title={t('portal.nav.timetable')}
        description={currentEnrolment ? `Academic year ${currentEnrolment.academicYearOfEntry}` : undefined}
      />

      {error && <Problem title={t('status.error')} detail={error} />}

      {!error && Object.keys(byPeriod).length === 0 && (
        <EmptyState title="No timetable entries found for the current enrolment." />
      )}

      <div className="space-y-6">
        {Object.entries(byPeriod).map(([period, periodEntries]) => (
          <section key={period} aria-labelledby={`period-${period}`}>
            <h2 id={`period-${period}`} className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
              {period}
            </h2>
            <Card>
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Module</TableHeaderCell>
                    <TableHeaderCell>Title</TableHeaderCell>
                    <TableHeaderCell>Start</TableHeaderCell>
                    <TableHeaderCell>End</TableHeaderCell>
                    <TableHeaderCell>Delivery</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {(periodEntries ?? []).map(e => (
                    <TableRow key={e.moduleRegistrationId}>
                      <TableCell className="font-mono text-xs text-neutral-800">{e.moduleCode}</TableCell>
                      <TableCell className="text-neutral-900">{e.moduleTitle}</TableCell>
                      <TableCell>{formatDate(e.startDate)}</TableCell>
                      <TableCell>{formatDate(e.endDate)}</TableCell>
                      <TableCell>{e.deliveryModeCode}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </section>
        ))}
      </div>
    </div>
  );
}
