import { type FormEvent, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';
import {
  getEnrolments,
  getModuleRegistrations,
  getExceptionalCircumstances,
  submitExceptionalCircumstances,
} from '../api/me.js';
import {
  Spinner, Problem, EmptyState, formatDate, PageHeader, Button, Badge,
  Card, CardBody, LabelledField, Select, Textarea,
} from '@revelation-srs/ui';

export function CircumstancesPage() {
  const { t }    = useTranslation();
  const { personId } = useAuth();

  const fetchEnrolments = useCallback(
    () => personId ? getEnrolments(personId) : Promise.reject(new Error('')),
    [personId],
  );
  const { data: enrolments, loading: eLoading, error: eError } = useApiData(personId ? fetchEnrolments : null);

  const currentEnrolment = enrolments?.find(e => e.statusCode === 'enrolled') ?? enrolments?.[0] ?? null;

  const fetchRegistrations = useCallback(
    () => currentEnrolment ? getModuleRegistrations(currentEnrolment.enrolmentId) : Promise.reject(new Error('')),
    [currentEnrolment?.enrolmentId], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const { data: registrations } = useApiData(currentEnrolment ? fetchRegistrations : null);

  const [refreshKey, setRefreshKey] = useState(0);

  const fetchCircumstances = useCallback(
    () => personId ? getExceptionalCircumstances(personId, currentEnrolment?.enrolmentId) : Promise.reject(new Error('')),
    [personId, currentEnrolment?.enrolmentId, refreshKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const {
    data: circumstances,
    loading: cLoading,
    error: cError,
  } = useApiData(personId ? fetchCircumstances : null);

  const loading = eLoading || cLoading;
  const error   = eError ?? cError;

  const [showForm,           setShowForm]           = useState(false);
  const [description,        setDescription]        = useState('');
  const [moduleOfferingId,   setModuleOfferingId]   = useState('');
  const [submitting,         setSubmitting]         = useState(false);
  const [submitError,        setSubmitError]        = useState('');
  const [successMsg,         setSuccessMsg]         = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!currentEnrolment || !description.trim()) return;
    setSubmitting(true);
    setSubmitError('');
    setSuccessMsg('');
    try {
      await submitExceptionalCircumstances({
        enrolmentId:      currentEnrolment.enrolmentId,
        description:      description.trim(),
        moduleOfferingId: moduleOfferingId || undefined,
      });
      setDescription('');
      setModuleOfferingId('');
      setShowForm(false);
      setSuccessMsg(t('portal.circumstances.submitSuccess'));
      setRefreshKey(k => k + 1);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="flex justify-center py-16"><Spinner size="lg" label={t('status.loading')} /></div>;
  }

  return (
    <div>
      <PageHeader
        title={t('portal.nav.circumstances')}
        description="Exceptional circumstances submissions and outcomes"
        actions={currentEnrolment && (
          <Button
            variant={showForm ? 'secondary' : 'primary'}
            onClick={() => { setShowForm(s => { if (s) { setModuleOfferingId(''); setDescription(''); } return !s; }); }}
          >
            {showForm ? t('actions.cancel') : t('portal.circumstances.submitButton')}
          </Button>
        )}
      />

      {!currentEnrolment && (
        <p className="text-sm text-warning-700 bg-warning-50 rounded-lg border border-warning-200 px-4 py-3 mb-6">
          {t('portal.circumstances.noEnrolment')}
        </p>
      )}

      {showForm && currentEnrolment && (
        <Card className="mb-6 border-primary-200 bg-primary-50">
          <CardBody>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-primary-900">
                {t('portal.circumstances.submitHeading')}
              </h2>
              <p className="text-sm text-primary-700">{t('portal.circumstances.submitSubheading')}</p>
            </div>

            {submitError && <p className="text-sm text-danger-700" role="alert">{submitError}</p>}

            <LabelledField label="Related module" htmlFor="ec-module" hint="Optional">
              <Select id="ec-module" value={moduleOfferingId} onChange={e => setModuleOfferingId(e.target.value)}>
                <option value="">— Not module-specific —</option>
                {(registrations ?? [])
                  .filter(r => r.statusCode === 'registered')
                  .map(r => (
                    <option key={r.moduleOfferingId} value={r.moduleOfferingId}>
                      {r.moduleCode} — {r.moduleTitle}
                    </option>
                  ))}
              </Select>
            </LabelledField>

            <LabelledField label={t('portal.circumstances.descriptionLabel')} htmlFor="ec-description" hint={t('portal.circumstances.descriptionHint')}>
              <Textarea
                id="ec-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                rows={5}
              />
            </LabelledField>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={submitting || !description.trim()}>
                {submitting ? t('status.submitting') : t('actions.submit')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => { setShowForm(false); setModuleOfferingId(''); setDescription(''); }}
              >
                {t('actions.cancel')}
              </Button>
            </div>
          </form>
          </CardBody>
        </Card>
      )}

      {successMsg && (
        <p className="text-sm text-success-700 bg-success-50 rounded-lg border border-success-200 px-4 py-3 mb-6" role="status">
          {successMsg}
        </p>
      )}

      {error && <Problem title={t('status.error')} detail={error} />}

      {!error && circumstances?.length === 0 && !showForm && (
        <EmptyState title="No exceptional circumstances are recorded against your account." />
      )}

      {circumstances && circumstances.length > 0 && (
        <div className="space-y-4">
          {circumstances.map(ec => (
            <Card key={ec.exceptionalCircumstancesId} aria-labelledby={`ec-${ec.exceptionalCircumstancesId}`}>
              <CardBody>
              <div className="flex items-start justify-between gap-4">
                <h2 id={`ec-${ec.exceptionalCircumstancesId}`} className="text-base font-semibold text-neutral-900">
                  Exceptional circumstances
                  {ec.determinationDate && (
                    <span className="ml-2 text-sm font-normal text-neutral-500">
                      — determined {formatDate(ec.determinationDate)}
                    </span>
                  )}
                </h2>
                <Badge value={ec.outcomeCode} />
              </div>

              <dl className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
                <div>
                  <dt className="text-xs font-medium text-neutral-500">Submitted</dt>
                  <dd className="mt-0.5 text-neutral-900">{formatDate(ec.validFrom)}</dd>
                </div>
                {(ec.moduleTitle ?? ec.moduleOfferingId) && (
                  <div>
                    <dt className="text-xs font-medium text-neutral-500">Module</dt>
                    <dd className="mt-0.5 text-neutral-800">
                      {ec.moduleTitle
                        ? <>{ec.moduleCode && <span className="font-mono text-xs text-neutral-500 mr-1">{ec.moduleCode}</span>}{ec.moduleTitle}</>
                        : <span className="font-mono text-xs">{ec.moduleOfferingId}</span>
                      }
                    </dd>
                  </div>
                )}
                {ec.notes && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-medium text-neutral-500">Notes</dt>
                    <dd className="mt-0.5 text-neutral-900 whitespace-pre-line">{ec.notes}</dd>
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
