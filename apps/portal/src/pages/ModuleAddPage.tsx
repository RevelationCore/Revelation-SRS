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
  requestModuleRegistration,
} from '../api/me.js';
import type { ModuleOffering } from '../api/me.js';
import { ArrowLeft } from 'lucide-react';
import {
  Spinner, Problem, EmptyState, PageHeader, Button,
  Card, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';

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

  const { submitting, submitError, submit } = useFormSubmit<{ workflowInstanceId: string }>();

  const handleRegister = async (offering: ModuleOffering) => {
    if (!currentEnrolment) return;
    const result = await submit(() =>
      requestModuleRegistration({
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
      <div>
        <PageHeader title={t('portal.modules.addHeading')} />
        <Problem title="No active enrolment" detail="Module registration requires an active enrolment." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t('portal.modules.addHeading')}
        description={currentPeriodCode
          ? `${t('portal.modules.period')}: ${currentPeriodCode}`
          : t('portal.modules.allPeriods')}
        actions={
          <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/modules')}>
            {t('portal.nav.modules')}
          </Button>
        }
      />

      {error      && <Problem title={t('status.error')} detail={error} />}
      {submitError && <Problem title={t('status.error')} detail={submitError} />}

      {!error && available.length === 0 && (
        <EmptyState title={t('portal.modules.noOfferings')} />
      )}

      {available.length > 0 && (
        <Card>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Module</TableHeaderCell>
                <TableHeaderCell>Period</TableHeaderCell>
                <TableHeaderCell>Delivery</TableHeaderCell>
                <TableHeaderCell>Credits</TableHeaderCell>
                <TableHeaderCell>Capacity</TableHeaderCell>
                <TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {available.map(offering => (
                <TableRow key={offering.moduleOfferingId}>
                  <TableCell className="text-neutral-800">
                    <span className="font-medium">{offering.moduleCode}</span>
                    <span className="ml-2 text-xs text-neutral-500">{offering.moduleTitle}</span>
                  </TableCell>
                  <TableCell>{offering.periodCode}</TableCell>
                  <TableCell>{offering.deliveryModeCode ?? '—'}</TableCell>
                  <TableCell>{offering.creditValue ?? '—'}</TableCell>
                  <TableCell>{offering.capacity ?? '—'}</TableCell>
                  <TableCell className="text-right">
                    {confirming === offering.moduleOfferingId ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-xs text-neutral-700">{t('portal.modules.confirmRegister')}</span>
                        <Button
                          size="sm"
                          disabled={submitting}
                          icon={submitting ? <Spinner size="sm" /> : undefined}
                          onClick={() => handleRegister(offering)}
                        >
                          {t('actions.confirm')}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                          {t('actions.cancel')}
                        </Button>
                      </span>
                    ) : (
                      <Button variant="secondary" size="sm" onClick={() => setConfirming(offering.moduleOfferingId)}>
                        {t('portal.modules.registerButton')}
                      </Button>
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
