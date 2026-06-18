import { useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';
import { useFormSubmit } from '../hooks/useFormSubmit.js';
import { getDisabilityDeclarations, postDisabilityDeclaration } from '../api/me.js';
import { Spinner, Problem, EmptyState, Field, formatDate } from '@revelation-srs/ui';

const schema = z.object({
  disabilityCategoryCode: z.string().min(1, 'Category is required.'),
  declarationStatusCode:  z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export function DisabilityPage() {
  const { t }    = useTranslation();
  const { personId } = useAuth();

  const [showForm, setShowForm]   = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchDeclarations = useCallback(
    () => personId ? getDisabilityDeclarations(personId) : Promise.reject(new Error('')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [personId, refreshKey],
  );
  const { data: declarations, loading, error } = useApiData(personId ? fetchDeclarations : null);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { disabilityCategoryCode: '', declarationStatusCode: 'declared' },
  });

  const { submitting, submitError, submit } = useFormSubmit<{ declarationId: string }>();

  const onSubmit = async (data: FormValues) => {
    if (!personId) return;
    const result = await submit(() =>
      postDisabilityDeclaration(personId, {
        disabilityCategoryCode: data.disabilityCategoryCode,
        declarationStatusCode:  data.declarationStatusCode || 'declared',
      }),
    );
    if (result !== undefined) {
      reset();
      setShowForm(false);
      setRefreshKey(k => k + 1);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-16"><Spinner size="lg" label={t('status.loading')} /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('portal.nav.disability')}</h1>
          <p className="mt-1 text-sm text-gray-500">{t('portal.disability.subheading')}</p>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="flex-none rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {t('portal.disability.addDeclaration')}
          </button>
        )}
      </div>

      {error && <Problem title={t('status.error')} detail={error} />}

      {/* Add declaration form */}
      {showForm && (
        <section
          aria-labelledby="add-declaration-heading"
          className="rounded-lg border border-indigo-200 bg-indigo-50 p-6"
        >
          <h2 id="add-declaration-heading" className="mb-4 text-base font-semibold text-gray-900">
            {t('portal.disability.addDeclaration')}
          </h2>
          {submitError && <Problem title={t('status.error')} detail={submitError} />}
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <Field
              label={`${t('portal.disability.categoryLabel')} *`}
              registration={register('disabilityCategoryCode')}
              error={errors.disabilityCategoryCode}
              required
              placeholder="e.g. specific-learning-difficulty"
            />
            <p className="text-xs text-gray-500">{t('portal.disability.categoryHint')}</p>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
              >
                {submitting
                  ? <><Spinner size="sm" />{t('status.submitting')}</>
                  : t('actions.submit')}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {t('actions.cancel')}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Declarations list */}
      {!error && declarations?.length === 0 && (
        <EmptyState title={t('portal.disability.noDeclarations')} />
      )}

      {declarations && declarations.length > 0 && (
        <div className="space-y-3">
          {declarations.map(d => (
            <div
              key={d.declarationId}
              className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
            >
              <div>
                <p className="text-sm font-medium text-gray-900">{d.disabilityCategoryCode}</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {t('portal.disability.declaredOn')} {formatDate(d.declaredAt)}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${declarationStatusColour(d.declarationStatusCode)}`}>
                {d.declarationStatusCode}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function declarationStatusColour(code: string): string {
  const map: Record<string, string> = {
    declared:  'bg-green-100 text-green-700',
    withdrawn: 'bg-gray-100 text-gray-600',
    pending:   'bg-yellow-100 text-yellow-700',
  };
  return map[code] ?? 'bg-gray-100 text-gray-700';
}
