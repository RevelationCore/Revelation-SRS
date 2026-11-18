import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';
import { getEnrolments, getTimetable } from '../api/me.js';
import {
  Spinner, Problem, EmptyState, formatDate, PageHeader, Card, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, CodeLabel, useCodes,
} from '@revelation-srs/ui';

export function TimetablePage() {
  const activityTypes = useCodes('timetable_activity', 'activity_type_code');
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
                    <TableHeaderCell>When</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {(periodEntries ?? []).map(e => (
                    <TableRow key={e.moduleRegistrationId}>
                      <TableCell className="font-mono text-xs text-neutral-800">{e.moduleCode}</TableCell>
                      <TableCell className="text-neutral-900">{e.moduleTitle}</TableCell>
                      <TableCell>{formatDate(e.startDate)}</TableCell>
                      <TableCell>{formatDate(e.endDate)}</TableCell>
                      <TableCell><CodeLabel entity="module_offering" field="delivery_mode_code" code={e.deliveryModeCode} /></TableCell>
                      <TableCell className="text-xs">
                        {(e.activities ?? []).length === 0 ? (
                          <span className="text-neutral-500">Not yet published</span>
                        ) : (
                          <ul className="space-y-0.5">
                            {groupActivities(e.activities ?? [], activityTypes.label).map((line) => <li key={line}>{line}</li>)}
                          </ul>
                        )}
                      </TableCell>
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

const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** One line per activity; a group set (the student attends one group) reads "Seminar, one of: …". */
function groupActivities(activities: NonNullable<import('../api/me.js').TimetableEntry['activities']>, label: (code: string) => string): string[] {
  const slotText = (s: { dayOfWeek: number; startTime: string; endTime: string; weekCommencing: string[]; locationRef: string | null }) =>
    `${DAYS[s.dayOfWeek]} ${s.startTime}–${s.endTime}${s.locationRef ? `, ${s.locationRef}` : ''} (${s.weekCommencing.length} week${s.weekCommencing.length === 1 ? '' : 's'})`;
  const lines: string[] = [];
  const sets = new Map<string, typeof activities>();
  for (const a of activities) {
    if (a.groupSetCode) sets.set(a.groupSetCode, [...(sets.get(a.groupSetCode) ?? []), a]);
    else lines.push(`${label(a.activityTypeCode)}: ${a.slots.map(slotText).join('; ')}`);
  }
  for (const group of sets.values()) {
    lines.push(`${label(group[0]!.activityTypeCode)}, one of: ${group.map((g) => `${g.groupCode ?? ''} ${g.slots.map(slotText).join('; ')}`.trim()).join(' / ')}`);
  }
  return lines;
}
