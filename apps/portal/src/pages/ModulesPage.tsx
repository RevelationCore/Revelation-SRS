import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';
import { useFormSubmit } from '../hooks/useFormSubmit.js';
import { getEnrolments, getModuleRegistrations, getTimetable, requestWithdrawal, getMyModuleRegistrationRequests } from '../api/me.js';
import {
  Spinner, Problem, EmptyState, formatDate, PageHeader, Button, Badge,
  Card, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';

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

  const fetchTimetable = useCallback(
    () => currentEnrolment ? getTimetable(currentEnrolment.enrolmentId) : Promise.reject(new Error('')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentEnrolment?.enrolmentId, refreshKey],
  );
  const { data: timetable, loading: tLoading } = useApiData(currentEnrolment ? fetchTimetable : null);

  const fetchRequests = useCallback(
    () => personId ? getMyModuleRegistrationRequests(personId) : Promise.reject(new Error('')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [personId, refreshKey],
  );
  const { data: changeRequests } = useApiData(personId ? fetchRequests : null);
  const pendingRequests = changeRequests?.filter(r => r.statusCode === 'running') ?? [];

  // Build a lookup map from moduleRegistrationId → timetable entry for display names
  const timetableByRegId = useMemo(() => {
    const map = new Map<string, { moduleCode: string; moduleTitle: string; periodCode: string }>();
    for (const entry of timetable ?? []) map.set(entry.moduleRegistrationId, entry);
    return map;
  }, [timetable]);

  const { submitting, submitError, submit } = useFormSubmit<true>();

  const handleWithdraw = async (moduleRegistrationId: string) => {
    const result = await submit(async () => { await requestWithdrawal(moduleRegistrationId); return true as const; });
    if (result !== undefined) {
      setWithdrawing(null);
      setRefreshKey(k => k + 1);
    }
  };

  const loading = eLoading || rLoading || tLoading;
  const error   = eError ?? rError;

  if (loading) {
    return <div className="flex justify-center py-16"><Spinner size="lg" label={t('status.loading')} /></div>;
  }

  return (
    <div>
      <PageHeader
        title={t('portal.nav.modules')}
        description={currentEnrolment ? `Academic year ${currentEnrolment.academicYearOfEntry}` : undefined}
        actions={
          <div className="flex items-center gap-2">
            <Link to="/modules/select">
              <Button variant="secondary">{t('portal.moduleSelection.heading')}</Button>
            </Link>
            <Link to="/modules/add">
              <Button icon={<Plus className="h-4 w-4" />}>{t('portal.modules.registerButton')}</Button>
            </Link>
          </div>
        }
      />

      {error      && <Problem title={t('status.error')} detail={error} />}
      {submitError && <Problem title={t('status.error')} detail={submitError} />}

      {pendingRequests.length > 0 && (
        <Card className="mb-6 border-warning-200 bg-warning-50">
          <div className="p-4">
            <h2 className="mb-2 text-sm font-semibold text-neutral-700">Pending requests</h2>
            <p className="mb-3 text-xs text-neutral-600">
              Awaiting personal tutor or registry approval before it takes effect.
            </p>
            <ul className="space-y-2">
              {pendingRequests.map(r => {
                const actionType = r.context['actionType'] as string | undefined;
                return (
                  <li key={r.workflowInstanceId} className="flex items-center justify-between text-sm">
                    <span className="text-neutral-800">
                      {actionType === 'withdraw' ? 'Withdrawal request' : 'Registration request'}
                    </span>
                    <span className="text-xs text-neutral-500">Submitted {formatDate(r.startedAt)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </Card>
      )}

      {!error && registrations?.length === 0 && (
        <EmptyState title="No module registrations found for the current enrolment." />
      )}

      {registrations && registrations.length > 0 && (
        <Card>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Module</TableHeaderCell>
                <TableHeaderCell>Period</TableHeaderCell>
                <TableHeaderCell>Credits</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Registered</TableHeaderCell>
                <TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {registrations.map(r => (
                <TableRow key={r.moduleRegistrationId}>
                  <TableCell className="text-neutral-800">
                    <span className="font-mono text-xs text-neutral-500 mr-1">{r.moduleCode}</span>
                    <span className="font-medium">{r.moduleTitle}</span>
                  </TableCell>
                  <TableCell>{r.periodCode}</TableCell>
                  <TableCell>{r.creditValue ?? '—'}</TableCell>
                  <TableCell>
                    <Badge value={r.statusCode} label={t(`portal.modules.status.${r.statusCode}`, { defaultValue: r.statusCode })} />
                  </TableCell>
                  <TableCell>{formatDate(r.registrationDate)}</TableCell>
                  <TableCell className="text-right">
                    {r.statusCode === 'registered' && (
                      withdrawing === r.moduleRegistrationId ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="text-xs text-neutral-700">{t('portal.modules.confirmWithdraw')}</span>
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={submitting}
                            icon={submitting ? <Spinner size="sm" /> : undefined}
                            onClick={() => handleWithdraw(r.moduleRegistrationId)}
                          >
                            {t('actions.confirm')}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setWithdrawing(null)}>
                            {t('actions.cancel')}
                          </Button>
                        </span>
                      ) : (
                        <Button variant="ghost" size="sm" className="text-danger-600 hover:bg-danger-50" onClick={() => setWithdrawing(r.moduleRegistrationId)}>
                          {t('portal.modules.withdrawButton')}
                        </Button>
                      )
                    )}
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
