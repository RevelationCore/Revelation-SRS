import { type FormEvent, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';
import {
  getEnrolments,
  getExceptionalCircumstances,
  submitExceptionalCircumstances,
} from '../api/me.js';
import { Spinner, Problem, EmptyState, formatDate } from '@revelation-srs/ui';

export function CircumstancesPage() {
  const { t }    = useTranslation();
  const { personId } = useAuth();

  const fetchEnrolments = useCallback(
    () => personId ? getEnrolments(personId) : Promise.reject(new Error('')),
    [personId],
  );
  const { data: enrolments, loading: eLoading, error: eError } = useApiData(personId ? fetchEnrolments : null);

  const currentEnrolment = enrolments?.find(e => e.statusCode === 'enrolled') ?? enrolments?.[0] ?? null;

  const fetchCircumstances = useCallback(
    () => personId ? getExceptionalCircumstances(personId, currentEnrolment?.enrolmentId) : Promise.reject(new Error('')),
    [personId, currentEnrolment?.enrolmentId], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const {
    data: circumstances,
    loading: cLoading,
    error: cError,
  } = useApiData(personId ? fetchCircumstances : null);

  const loading = eLoading || cLoading;
  const error   = eError ?? cError;

  const [showForm,     setShowForm]     = useState(false);
  const [description,  setDescription]  = useState('');
  const [submitting,   setSubmitting]   = useState(false);
  const [submitError,  setSubmitError]  = useState('');
  const [successMsg,   setSuccessMsg]   = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!currentEnrolment || !description.trim()) return;
    setSubmitting(true);
    setSubmitError('');
    setSuccessMsg('');
    try {
      await submitExceptionalCircumstances({
        enrolmentId: currentEnrolment.enrolmentId,
        description: description.trim(),
      });
      setDescription('');
      setShowForm(false);
      setSuccessMsg(t('portal.circumstances.submitSuccess'));
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
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('portal.nav.circumstances')}</h1>
          <p className="mt-1 text-sm text-gray-500">
            Exceptional circumstances submissions and outcomes
          </p>
        </div>
        {currentEnrolment && (
          <button
            onClick={() => setShowForm(s => !s)}
            className="flex-none rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            {showForm ? t('actions.cancel') : t('portal.circumstances.submitButton')}
          </button>
        )}
      </div>

      {!currentEnrolment && (
        <p className="text-sm text-amber-700 bg-amber-50 rounded-lg border border-amber-200 px-4 py-3">
          {t('portal.circumstances.noEnrolment')}
        </p>
      )}

      {showForm && currentEnrolment && (
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="rounded-lg border border-indigo-200 bg-indigo-50 p-6 space-y-4"
        >
          <h2 className="text-base font-semibold text-indigo-900">
            {t('portal.circumstances.submitHeading')}
          </h2>
          <p className="text-sm text-indigo-700">{t('portal.circumstances.submitSubheading')}</p>

          {submitError && <p className="text-sm text-red-700" role="alert">{submitError}</p>}

          <div>
            <label htmlFor="ec-description" className="block text-sm font-medium text-gray-700 mb-1">
              {t('portal.circumstances.descriptionLabel')}
            </label>
            <p className="text-xs text-gray-500 mb-1">{t('portal.circumstances.descriptionHint')}</p>
            <textarea
              id="ec-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              rows={5}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={submitting || !description.trim()}
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? t('status.submitting') : t('actions.submit')}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-sm text-gray-500 hover:text-gray-800"
            >
              {t('actions.cancel')}
            </button>
          </div>
        </form>
      )}

      {successMsg && (
        <p className="text-sm text-green-700 bg-green-50 rounded-lg border border-green-200 px-4 py-3" role="status">
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
            <section
              key={ec.exceptionalCircumstancesId}
              aria-labelledby={`ec-${ec.exceptionalCircumstancesId}`}
              className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <h2 id={`ec-${ec.exceptionalCircumstancesId}`} className="text-base font-semibold text-gray-900">
                  Exceptional circumstances
                  {ec.determinationDate && (
                    <span className="ml-2 text-sm font-normal text-gray-500">
                      — determined {formatDate(ec.determinationDate)}
                    </span>
                  )}
                </h2>
                <span className={`flex-none rounded-full px-2.5 py-0.5 text-xs font-medium ${outcomeColour(ec.outcomeCode)}`}>
                  {ec.outcomeCode}
                </span>
              </div>

              <dl className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
                <div>
                  <dt className="text-xs font-medium text-gray-500">Submitted</dt>
                  <dd className="mt-0.5 text-gray-900">{formatDate(ec.validFrom)}</dd>
                </div>
                {ec.moduleOfferingId && (
                  <div>
                    <dt className="text-xs font-medium text-gray-500">Module offering</dt>
                    <dd className="mt-0.5 font-mono text-xs text-gray-800">{ec.moduleOfferingId}</dd>
                  </div>
                )}
                {ec.notes && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-medium text-gray-500">Notes</dt>
                    <dd className="mt-0.5 text-gray-900 whitespace-pre-line">{ec.notes}</dd>
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

function outcomeColour(code: string): string {
  const map: Record<string, string> = {
    approved:  'bg-green-100 text-green-700',
    rejected:  'bg-red-100 text-red-700',
    pending:   'bg-yellow-100 text-yellow-700',
    withdrawn: 'bg-gray-100 text-gray-600',
  };
  return map[code] ?? 'bg-gray-100 text-gray-700';
}
