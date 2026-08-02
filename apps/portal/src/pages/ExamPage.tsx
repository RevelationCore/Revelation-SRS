import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';
import { getEnrolments, getModuleRegistrations, getExamEntries } from '../api/me.js';
import type { ExamEntry } from '../api/me.js';
import { Spinner, Problem, EmptyState, formatDate, formatDateTime, PageHeader, Card, CardBody, Badge } from '@revelation-srs/ui';

export function ExamPage() {
  const { t }    = useTranslation();
  const { personId } = useAuth();

  const fetchEnrolments = useCallback(
    () => personId ? getEnrolments(personId) : Promise.reject(new Error('')),
    [personId],
  );
  const { data: enrolments, loading: eLoading, error: eError } = useApiData(personId ? fetchEnrolments : null);

  const currentEnrolment = enrolments?.find(e => e.statusCode === 'enrolled') ?? enrolments?.[0] ?? null;

  const fetchRegs = useCallback(
    () => currentEnrolment ? getModuleRegistrations(currentEnrolment.enrolmentId) : Promise.reject(new Error('')),
    [currentEnrolment?.enrolmentId], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const { data: registrations, loading: rLoading, error: rError } = useApiData(
    currentEnrolment ? fetchRegs : null,
  );

  // Fetch exam entries for each registration in parallel
  const [examEntries, setExamEntries] = useState<ExamEntry[]>([]);
  const [xLoading, setXLoading]       = useState(false);
  const [xError,   setXError]         = useState<string | null>(null);

  useEffect(() => {
    if (!registrations || registrations.length === 0) return;
    setXLoading(true);
    setXError(null);
    Promise.all(registrations.map(r => getExamEntries(r.moduleRegistrationId).catch(() => [] as ExamEntry[])))
      .then(results => {
        setExamEntries(results.flat());
        setXLoading(false);
      })
      .catch((e: unknown) => {
        setXError(e instanceof Error ? e.message : 'Failed to load exam entries.');
        setXLoading(false);
      });
  }, [registrations]);

  const loading = eLoading || rLoading || xLoading;
  const error   = eError ?? rError ?? xError;

  if (loading) {
    return <div className="flex justify-center py-16"><Spinner size="lg" label={t('status.loading')} /></div>;
  }

  return (
    <div>
      <PageHeader
        title={t('portal.nav.exams')}
        description={currentEnrolment ? `Academic year ${currentEnrolment.academicYearOfEntry}` : undefined}
      />

      {error && <Problem title={t('status.error')} detail={error} />}

      {!error && examEntries.length === 0 && (
        <EmptyState title={t('portal.exam.noExams')} />
      )}

      {examEntries.length > 0 && (
        <div className="space-y-4">
          {examEntries.map(entry => (
            <Card key={entry.examEntryId} aria-labelledby={`exam-${entry.examEntryId}`}>
              <CardBody>
              <div className="flex items-start justify-between gap-4">
                <h2 id={`exam-${entry.examEntryId}`} className="text-base font-semibold text-neutral-900">
                  {t('portal.exam.candidateNumber')}: {entry.candidateNumber}
                </h2>
                <Badge value={entry.statusCode} label={t(`portal.exam.status.${entry.statusCode}`, { defaultValue: entry.statusCode })} />
              </div>

              <dl className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
                {entry.scheduledDate && (
                  <div>
                    <dt className="text-xs font-medium text-neutral-500">{t('portal.exam.scheduledDate')}</dt>
                    <dd className="mt-0.5 text-neutral-900">{formatDateTime(entry.scheduledDate)}</dd>
                  </div>
                )}
                {entry.roomReference && (
                  <div>
                    <dt className="text-xs font-medium text-neutral-500">{t('portal.exam.room')}</dt>
                    <dd className="mt-0.5 text-neutral-900">{entry.roomReference}</dd>
                  </div>
                )}
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium text-neutral-500">{t('portal.exam.accommodations')}</dt>
                  <dd className="mt-0.5 text-neutral-900">
                    {entry.accommodations.length > 0
                      ? entry.accommodations.join(', ')
                      : t('portal.exam.noAccommodations')}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-neutral-500">Valid from</dt>
                  <dd className="mt-0.5 text-neutral-600">{formatDate(entry.validFrom)}</dd>
                </div>
              </dl>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
