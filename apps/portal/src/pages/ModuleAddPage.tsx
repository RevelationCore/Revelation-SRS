import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';
import { useFormSubmit } from '../hooks/useFormSubmit.js';
import {
  getEnrolments,
  getModuleRegistrations,
  getModuleOfferings,
  postModuleRegistration,
} from '../api/me.js';
import type { ModuleOffering } from '../api/me.js';
import { Spinner, Problem, EmptyState } from '@revelation-srs/ui';

export function ModuleAddPage() {
  const { t }    = useTranslation();
  const navigate = useNavigate();
  const { personId } = useAuth();

  // Track which offering is pending confirmation
  const [confirming, setConfirming] = useState<string | null>(null);

  const fetchEnrolments = useCallback(
    () => personId ? getEnrolments(personId) : Promise.reject(new Error('')),
    [personId],
  );
  const { data: enrolments, loading: eLoading, error: eError } = useApiData(personId ? fetchEnrolments : null);

  const currentEnrolment = enrolments?.find(e => e.statusCode === 'enrolled') ?? enrolments?.[0] ?? null;

  const fetchRegs = useCallback(
    () => currentEnrolment
      ? getModuleRegistrations(currentEnrolment.enrolmentId)
      : Promise.reject(new Error('')),
    [currentEnrolment?.enrolmentId], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const { data: registrations, loading: rLoading, error: rError } = useApiData(
    currentEnrolment ? fetchRegs : null,
  );

  // Derive the current academic period from the most recent active registration
  const currentPeriodId = registrations
    ?.filter(r => r.statusCode === 'registered')
    ?.[0]?.academicPeriodId ?? undefined;

  const fetchOfferings = useCallback(
    () => getModuleOfferings({ academicPeriodId: currentPeriodId }),
    [currentPeriodId],
  );
  // Only fetch once we have registrations (even empty) so we know the period
  const { data: offerings, loading: oLoading, error: oError } = useApiData(
    registrations !== null ? fetchOfferings : null,
  );

  const currentPeriodCode = offerings?.find(o => o.academicPeriodId === currentPeriodId)?.periodCode ?? currentPeriodId;

  const { submitting, submitError, submit } = useFormSubmit<{ moduleRegistrationId: string }>();

  const handleRegister = async (offering: ModuleOffering) => {
    if (!currentEnrolment) return;
    const result = await submit(() =>
      postModuleRegistration({
        enrolmentId:      currentEnrolment.enrolmentId,
        moduleOfferingId: offering.moduleOfferingId,
      }),
    );
    if (result !== undefined) navigate('/modules');
  };

  const loading = eLoading || rLoading || oLoading;
  const error   = eError ?? rError ?? oError;

  // Filter out offerings the student is already registered for
  const registeredOfferingIds = new Set(registrations?.map(r => r.moduleOfferingId) ?? []);
  const available = offerings?.filter(o => !registeredOfferingIds.has(o.moduleOfferingId)) ?? [];

  if (loading) {
    return <div className="flex justify-center py-16"><Spinner size="lg" label={t('status.loading')} /></div>;
  }

  if (!currentEnrolment) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">{t('portal.modules.addHeading')}</h1>
        <Problem title="No active enrolment" detail="Module registration requires an active enrolment." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('portal.modules.addHeading')}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {currentPeriodCode
              ? `${t('portal.modules.period')}: ${currentPeriodCode}`
              : t('portal.modules.allPeriods')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/modules')}
          className="flex-none rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          ← {t('portal.nav.modules')}
        </button>
      </div>

      {error      && <Problem title={t('status.error')} detail={error} />}
      {submitError && <Problem title={t('status.error')} detail={submitError} />}

      {!error && available.length === 0 && (
        <EmptyState title={t('portal.modules.noOfferings')} />
      )}

      {available.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Module
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Period
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Delivery
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Credits
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Capacity
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {available.map(offering => (
                <tr key={offering.moduleOfferingId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-800">
                    <span className="font-medium">{offering.moduleCode}</span>
                    <span className="ml-2 text-xs text-gray-500">{offering.moduleTitle}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{offering.periodCode}</td>
                  <td className="px-4 py-3 text-gray-600">{offering.deliveryModeCode ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{offering.creditValue ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{offering.capacity ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    {confirming === offering.moduleOfferingId ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-xs text-gray-700">{t('portal.modules.confirmRegister')}</span>
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => handleRegister(offering)}
                          className="inline-flex items-center gap-1 rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          {submitting ? <Spinner size="sm" /> : null}
                          {t('actions.confirm')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirming(null)}
                          className="rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400"
                        >
                          {t('actions.cancel')}
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirming(offering.moduleOfferingId)}
                        className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-indigo-600 ring-1 ring-inset ring-indigo-300 hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        {t('portal.modules.registerButton')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
