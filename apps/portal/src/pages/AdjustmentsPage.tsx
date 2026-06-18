import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';
import { getEnrolments, getAdjustments } from '../api/me.js';
import { Spinner, Problem, EmptyState, formatDate } from '@revelation-srs/ui';

export function AdjustmentsPage() {
  const { t }    = useTranslation();
  const { personId } = useAuth();

  const fetchEnrolments = useCallback(
    () => personId ? getEnrolments(personId) : Promise.reject(new Error('')),
    [personId],
  );
  const { data: enrolments, loading: eLoading, error: eError } = useApiData(personId ? fetchEnrolments : null);

  const currentEnrolment = enrolments?.find(e => e.statusCode === 'enrolled') ?? enrolments?.[0] ?? null;

  const fetchAdjustments = useCallback(
    () => personId ? getAdjustments(personId, currentEnrolment?.enrolmentId) : Promise.reject(new Error('')),
    [personId, currentEnrolment?.enrolmentId], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const { data: adjustments, loading: aLoading, error: aError } = useApiData(
    personId ? fetchAdjustments : null,
  );

  const loading = eLoading || aLoading;
  const error   = eError ?? aError;

  if (loading) {
    return <div className="flex justify-center py-16"><Spinner size="lg" label={t('status.loading')} /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('portal.nav.adjustments')}</h1>
        <p className="mt-1 text-sm text-gray-500">
          Your learning support adjustments and reasonable adjustments
        </p>
      </div>

      {error && <Problem title={t('status.error')} detail={error} />}

      {!error && adjustments?.length === 0 && (
        <EmptyState title="No adjustments are recorded against your account." />
      )}

      {adjustments && adjustments.length > 0 && (
        <div className="space-y-4">
          {adjustments.map(adj => (
            <section
              key={adj.adjustmentId}
              aria-labelledby={`adj-${adj.adjustmentId}`}
              className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <h2 id={`adj-${adj.adjustmentId}`} className="text-base font-semibold text-gray-900">
                  {adj.adjustmentTypeCode}
                </h2>
                <span className="flex-none rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                  {adj.scopeCode}
                </span>
              </div>

              <dl className="mt-4 grid gap-3 sm:grid-cols-3 text-sm">
                <div>
                  <dt className="text-xs font-medium text-gray-500">Valid from</dt>
                  <dd className="mt-0.5 text-gray-900">{formatDate(adj.validFrom)}</dd>
                </div>
                {adj.validTo && (
                  <div>
                    <dt className="text-xs font-medium text-gray-500">Valid to</dt>
                    <dd className="mt-0.5 text-gray-900">{formatDate(adj.validTo)}</dd>
                  </div>
                )}
                {adj.notes && (
                  <div className="sm:col-span-3">
                    <dt className="text-xs font-medium text-gray-500">Notes</dt>
                    <dd className="mt-0.5 text-gray-900 whitespace-pre-line">{adj.notes}</dd>
                  </div>
                )}
              </dl>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
