import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';
import { useFormSubmit } from '../hooks/useFormSubmit.js';
import { getDisabilityDeclarations, postDisabilityDeclaration, getFieldValueSet } from '../api/me.js';
import { Spinner, Problem, EmptyState, formatDate } from '@revelation-srs/ui';

export function DisabilityPage() {
  const { t }    = useTranslation();
  const { personId } = useAuth();

  const [showForm, setShowForm]     = useState(false);
  const [selected, setSelected]     = useState<Set<string>>(new Set());
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchDeclarations = useCallback(
    () => personId ? getDisabilityDeclarations(personId) : Promise.reject(new Error('')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [personId, refreshKey],
  );
  const { data: declarations, loading: dLoading, error: dError } = useApiData(
    personId ? fetchDeclarations : null,
  );

  const fetchCategories = useCallback(
    () => getFieldValueSet('disability_declaration', 'disability_category_code'),
    [],
  );
  const { data: categorySet, loading: cLoading, error: cError } = useApiData(fetchCategories);

  const { submitting, submitError, submit } = useFormSubmit<true>();

  const alreadyDeclared = new Set(
    declarations?.map(d => d.disabilityCategoryCode) ?? [],
  );

  const toggle = (code: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!personId || selected.size === 0) return;

    const codes = [...selected].filter(c => !alreadyDeclared.has(c));
    if (codes.length === 0) return;

    const result = await submit(async () => {
      for (const code of codes) {
        await postDisabilityDeclaration(personId, {
          disabilityCategoryCode: code,
          declarationStatusCode:  'declared',
        });
      }
      return true as const;
    });
    if (result !== undefined) {
      setSelected(new Set());
      setShowForm(false);
      setRefreshKey(k => k + 1);
    }
  };

  const handleCancel = () => {
    setSelected(new Set());
    setShowForm(false);
  };

  const loading = dLoading || cLoading;
  const error   = dError ?? cError;

  if (loading) {
    return <div className="flex justify-center py-16"><Spinner size="lg" label={t('status.loading')} /></div>;
  }

  const categories = categorySet?.members ?? [];
  const newSelections = [...selected].filter(c => !alreadyDeclared.has(c));

  const labelFor = (code: string) =>
    categories.find(m => m.code === code)?.displayLabel ?? code;
  const hintFor = (code: string) =>
    categories.find(m => m.code === code)?.description ?? null;

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
          <h2 id="add-declaration-heading" className="mb-1 text-base font-semibold text-gray-900">
            {t('portal.disability.addDeclaration')}
          </h2>
          <p className="mb-4 text-sm text-gray-500">
            Select all that apply. Categories you have already declared are disabled.
          </p>
          {submitError && <Problem title={t('status.error')} detail={submitError} />}
          <form onSubmit={onSubmit} noValidate>
            <fieldset className="space-y-2">
              <legend className="sr-only">Disability categories</legend>
              {categories.map(({ code, displayLabel, description }) => {
                const isDeclared = alreadyDeclared.has(code);
                const isChecked  = selected.has(code);
                return (
                  <label
                    key={code}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border bg-white p-3 transition-colors ${
                      isDeclared
                        ? 'cursor-not-allowed border-gray-100 opacity-50'
                        : isChecked
                          ? 'border-indigo-400 ring-1 ring-indigo-300'
                          : 'border-gray-200 hover:border-indigo-200'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      checked={isChecked}
                      disabled={isDeclared}
                      onChange={() => toggle(code)}
                      aria-label={displayLabel}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-900">{displayLabel}</span>
                      {description && (
                        <span className="block text-xs text-gray-500">{description}</span>
                      )}
                    </span>
                    <span className="ml-auto shrink-0 font-mono text-xs text-gray-400">{code}</span>
                    {isDeclared && (
                      <span className="ml-1 shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        Declared
                      </span>
                    )}
                  </label>
                );
              })}
            </fieldset>

            <div className="mt-4 flex items-center gap-3">
              <button
                type="submit"
                disabled={submitting || newSelections.length === 0}
                className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
              >
                {submitting
                  ? <><Spinner size="sm" />{t('status.submitting')}</>
                  : newSelections.length > 0
                    ? `${t('actions.submit')} (${newSelections.length})`
                    : t('actions.submit')}
              </button>
              <button
                type="button"
                onClick={handleCancel}
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
                <p className="text-sm font-medium text-gray-900">
                  {labelFor(d.disabilityCategoryCode)}
                </p>
                {hintFor(d.disabilityCategoryCode) && (
                  <p className="mt-0.5 text-xs text-gray-500">{hintFor(d.disabilityCategoryCode)}</p>
                )}
                <p className="mt-0.5 text-xs text-gray-400">
                  {t('portal.disability.declaredOn')} {formatDate(d.declaredAt)}
                  <span className="ml-2 font-mono">({d.disabilityCategoryCode})</span>
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
