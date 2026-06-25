import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';
import { getEnrolments, getModuleRegistrations, getModuleResult } from '../api/me.js';
import type { ModuleResult } from '../api/me.js';
import { Spinner, Problem, EmptyState, ApiError } from '@revelation-srs/ui';

interface ResultWithModule {
  moduleRegistrationId: string;
  moduleCode:           string;
  moduleTitle:          string;
  result:               ModuleResult;
}

export function ResultsPage() {
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

  const [results,  setResults]  = useState<ResultWithModule[]>([]);
  const [xLoading, setXLoading] = useState(false);
  const [xError,   setXError]   = useState<string | null>(null);

  useEffect(() => {
    if (!registrations || registrations.length === 0) return;
    setXLoading(true);
    setXError(null);
    Promise.all(
      registrations.map(async r => {
        try {
          const result = await getModuleResult(r.moduleRegistrationId);
          // Only surface results that have been locked (ratified/published)
          if (!result.locked) return null;
          return { moduleRegistrationId: r.moduleRegistrationId, moduleCode: r.moduleCode, moduleTitle: r.moduleTitle, result };
        } catch (e) {
          // 404 = no result yet — treat as unpublished, not an error
          if (e instanceof ApiError && e.status === 404) return null;
          return null;
        }
      }),
    ).then(all => {
      setResults(all.filter((r): r is ResultWithModule => r !== null));
      setXLoading(false);
    });
  }, [registrations]);

  const loading = eLoading || rLoading || xLoading;
  const error   = eError ?? rError ?? xError;

  if (loading) {
    return <div className="flex justify-center py-16"><Spinner size="lg" label={t('status.loading')} /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('portal.nav.results')}</h1>
        <p className="mt-1 text-sm text-gray-500">{t('portal.results.subheading')}</p>
      </div>

      {error && <Problem title={t('status.error')} detail={error} />}

      {!error && results.length === 0 && (
        <EmptyState title={t('portal.results.noResults')} />
      )}

      {results.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Module
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  {t('portal.results.aggregateMark')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  {t('portal.results.resultCode')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {results.map(({ moduleCode, moduleTitle, moduleRegistrationId, result }) => (
                <tr key={moduleRegistrationId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-900">
                    <span className="font-mono text-xs text-gray-500 mr-1">{moduleCode}</span>
                    {moduleTitle}
                  </td>
                  <td className="px-4 py-3 text-gray-900 tabular-nums">{result.aggregateMark}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${resultColour(result.resultCode)}`}>
                      {t(`portal.results.code.${result.resultCode}`, { defaultValue: result.resultCode })}
                    </span>
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

function resultColour(code: string): string {
  const map: Record<string, string> = {
    pass:        'bg-green-100 text-green-700',
    fail:        'bg-red-100 text-red-700',
    defer:       'bg-yellow-100 text-yellow-700',
    distinction: 'bg-blue-100 text-blue-700',
    merit:       'bg-indigo-100 text-indigo-700',
  };
  return map[code?.toLowerCase()] ?? 'bg-gray-100 text-gray-700';
}
