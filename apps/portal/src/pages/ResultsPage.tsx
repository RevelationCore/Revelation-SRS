import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';
import { getEnrolments, getModuleRegistrations, getModuleResult } from '../api/me.js';
import type { ModuleResult } from '../api/me.js';
import {
  Spinner, Problem, EmptyState, ApiError, PageHeader,
  Card, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';

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
    <div>
      <PageHeader title={t('portal.nav.results')} description={t('portal.results.subheading')} />

      {error && <Problem title={t('status.error')} detail={error} />}

      {!error && results.length === 0 && (
        <EmptyState title={t('portal.results.noResults')} />
      )}

      {results.length > 0 && (
        <Card>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Module</TableHeaderCell>
                <TableHeaderCell>{t('portal.results.aggregateMark')}</TableHeaderCell>
                <TableHeaderCell>{t('portal.results.resultCode')}</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {results.map(({ moduleCode, moduleTitle, moduleRegistrationId, result }) => (
                <TableRow key={moduleRegistrationId}>
                  <TableCell className="text-neutral-900">
                    <span className="font-mono text-xs text-neutral-500 mr-1">{moduleCode}</span>
                    {moduleTitle}
                  </TableCell>
                  <TableCell className="text-neutral-900 tabular-nums">{result.aggregateMark}</TableCell>
                  <TableCell>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${resultColour(result.resultCode)}`}>
                      {t(`portal.results.code.${result.resultCode}`, { defaultValue: result.resultCode })}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function resultColour(code: string): string {
  const map: Record<string, string> = {
    pass:        'bg-success-100 text-success-700',
    fail:        'bg-danger-100 text-danger-700',
    defer:       'bg-warning-100 text-warning-700',
    distinction: 'bg-primary-100 text-primary-700',
    merit:       'bg-primary-100 text-primary-700',
  };
  return map[code?.toLowerCase()] ?? 'bg-neutral-100 text-neutral-700';
}
