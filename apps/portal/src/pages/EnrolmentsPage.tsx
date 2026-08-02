import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';
import { getEnrolments, getFieldValueSet, type ValueSetDto } from '../api/me.js';
import { Spinner, Problem, EmptyState, formatDate, PageHeader, Card, CardBody, Badge } from '@revelation-srs/ui';

function codeLabel(vs: ValueSetDto | null | undefined, code: string | null | undefined): string | null | undefined {
  if (!code) return code;
  if (!vs)   return code;
  return vs.members.find(m => m.code === code)?.displayLabel ?? code;
}

export function EnrolmentsPage() {
  const { t }    = useTranslation();
  const { personId } = useAuth();

  const fetchEnrolments = useCallback(
    () => personId ? getEnrolments(personId) : Promise.reject(new Error('')),
    [personId],
  );
  const fetchModeVS    = useCallback(() => getFieldValueSet('enrolment', 'mode_of_study_code').catch(() => undefined), []);
  const fetchFeeVS     = useCallback(() => getFieldValueSet('enrolment', 'fee_band_code').catch(() => undefined), []);
  const fetchFundingVS = useCallback(() => getFieldValueSet('enrolment', 'funding_source_code').catch(() => undefined), []);

  const { data: enrolments, loading, error } = useApiData(personId ? fetchEnrolments : null);
  const { data: modeVS    } = useApiData(fetchModeVS);
  const { data: feeVS     } = useApiData(fetchFeeVS);
  const { data: fundingVS } = useApiData(fetchFundingVS);

  if (loading) {
    return <div className="flex justify-center py-16"><Spinner size="lg" label={t('status.loading')} /></div>;
  }

  return (
    <div>
      <PageHeader title="Enrolments" />

      {error && <Problem title={t('status.error')} detail={error} />}

      {!error && enrolments?.length === 0 && (
        <EmptyState title={t('status.noResults')} />
      )}

      {enrolments && enrolments.length > 0 && (
        <div className="space-y-4">
          {enrolments.map(e => (
            <Card key={e.enrolmentId} aria-labelledby={`enrolment-${e.enrolmentId}`}>
              <CardBody>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 id={`enrolment-${e.enrolmentId}`} className="text-base font-semibold text-neutral-900">
                    {e.programmeName ?? e.programmeCode ?? 'Unknown programme'}
                  </h2>
                  <p className="mt-0.5 text-sm text-neutral-500">Academic year {e.academicYearOfEntry}</p>
                </div>
                <Badge value={e.statusCode} label={t(`portal.enrolment.status.${e.statusCode}`, { defaultValue: e.statusCode })} />
              </div>

              <dl className="mt-4 grid gap-3 sm:grid-cols-3 text-sm">
                <div>
                  <dt className="text-xs font-medium text-neutral-500">Mode of study</dt>
                  <dd className="mt-0.5 text-neutral-900">{codeLabel(modeVS, e.modeOfStudyCode) ?? '—'}</dd>
                </div>
                {e.feeBandCode && (
                  <div>
                    <dt className="text-xs font-medium text-neutral-500">Fee status</dt>
                    <dd className="mt-0.5 text-neutral-900">{codeLabel(feeVS, e.feeBandCode)}</dd>
                  </div>
                )}
                {e.fundingSourceCode && (
                  <div>
                    <dt className="text-xs font-medium text-neutral-500">Funding source</dt>
                    <dd className="mt-0.5 text-neutral-900">{codeLabel(fundingVS, e.fundingSourceCode)}</dd>
                  </div>
                )}
                {e.attendanceTypeCode && (
                  <div>
                    <dt className="text-xs font-medium text-neutral-500">Attendance</dt>
                    <dd className="mt-0.5 text-neutral-900">{e.attendanceTypeCode}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs font-medium text-neutral-500">Start date</dt>
                  <dd className="mt-0.5 text-neutral-900">{formatDate(e.startDate)}</dd>
                </div>
                {e.expectedEndDate && (
                  <div>
                    <dt className="text-xs font-medium text-neutral-500">Expected end date</dt>
                    <dd className="mt-0.5 text-neutral-900">{formatDate(e.expectedEndDate)}</dd>
                  </div>
                )}
                {e.actualEndDate && (
                  <div>
                    <dt className="text-xs font-medium text-neutral-500">Actual end date</dt>
                    <dd className="mt-0.5 text-neutral-900">{formatDate(e.actualEndDate)}</dd>
                  </div>
                )}
              </dl>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
