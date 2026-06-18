import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';
import { useFormSubmit } from '../hooks/useFormSubmit.js';
import { getEnrolments, getModuleRegistrations, postWithdrawal } from '../api/me.js';
import { Spinner, Problem, EmptyState, formatDate } from '@revelation-srs/ui';

export function ModulesPage() {
  const { t }    = useTranslation();
  const { personId } = useAuth();

  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [refreshKey,  setRefreshKey]  = useState(0);

  const fetchEnrolments = useCallback(
    () => personId ? getEnrolments(personId) : Promise.reject(new Error('')),
    [personId],
  );
  const { data: enrolments, loading: eLoading, error: eError } = useApiData(personId ? fetchEnrolments : null);

  const currentEnrolment = enrolments?.find(e => e.statusCode === 'enrolled') ?? enrolments?.[0] ?? null;

  const fetchRegs = useCallback(
    () => currentEnrolment ? getModuleRegistrations(currentEnrolment.enrolmentId) : Promise.reject(new Error('')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentEnrolment?.enrolmentId, refreshKey],
  );
  const { data: registrations, loading: rLoading, error: rError } = useApiData(
    currentEnrolment ? fetchRegs : null,
  );

  const { submitting, submitError, submit } = useFormSubmit<void>();

  const handleWithdraw = async (moduleRegistrationId: string) => {
    const result = await submit(() => postWithdrawal(moduleRegistrationId));
    if (result !== undefined) {
      setWithdrawing(null);
      setRefreshKey(k => k + 1);
    }
  };

  const loading = eLoading || rLoading;
  const error   = eError ?? rError;

  if (loading) {
    return <div className="flex justify-center py-16"><Spinner size="lg" label={t('status.loading')} /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('portal.nav.modules')}</h1>
          {currentEnrolment && (
            <p className="mt-1 text-sm text-gray-500">
              Academic year {currentEnrolment.academicYearOfEntry}
            </p>
          )}
        </div>
        <Link
          to="/modules/add"
          className="flex-none rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {t('portal.modules.registerButton')}
        </Link>
      </div>

      {error      && <Problem title={t('status.error')} detail={error} />}
      {submitError && <Problem title={t('status.error')} detail={submitError} />}

      {!error && registrations?.length === 0 && (
        <EmptyState title="No module registrations found for the current enrolment." />
      )}

      {registrations && registrations.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Module</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Period</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Registered</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {registrations.map(r => (
                <tr key={r.moduleRegistrationId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-gray-800 text-xs">{r.moduleId}</td>
                  <td className="px-4 py-3 text-gray-600">{r.academicPeriodId}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${regStatusColour(r.statusCode)}`}>
                      {r.statusCode}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(r.registrationDate)}</td>
                  <td className="px-4 py-3 text-right">
                    {r.statusCode === 'registered' && (
                      withdrawing === r.moduleRegistrationId ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="text-xs text-gray-700">{t('portal.modules.confirmWithdraw')}</span>
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => handleWithdraw(r.moduleRegistrationId)}
                            className="inline-flex items-center gap-1 rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-500"
                          >
                            {submitting ? <Spinner size="sm" /> : null}
                            {t('actions.confirm')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setWithdrawing(null)}
                            className="rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400"
                          >
                            {t('actions.cancel')}
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setWithdrawing(r.moduleRegistrationId)}
                          className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400"
                        >
                          {t('portal.modules.withdrawButton')}
                        </button>
                      )
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

function regStatusColour(code: string): string {
  const map: Record<string, string> = {
    registered: 'bg-green-100 text-green-700',
    withdrawn:  'bg-red-100 text-red-700',
    pending:    'bg-yellow-100 text-yellow-700',
  };
  return map[code] ?? 'bg-gray-100 text-gray-700';
}
