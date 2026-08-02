import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';
import { useFormSubmit } from '../hooks/useFormSubmit.js';
import { getDisabilityDeclarations, postDisabilityDeclaration, getFieldValueSet } from '../api/me.js';
import { Spinner, Problem, EmptyState, formatDate, PageHeader, Button, Badge, Card, CardBody, LabelledField, Textarea } from '@revelation-srs/ui';

export function DisabilityPage() {
  const { t }    = useTranslation();
  const { personId } = useAuth();

  const [showForm, setShowForm]     = useState(false);
  const [selected, setSelected]     = useState<Set<string>>(new Set());
  const [notes, setNotes]           = useState('');
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
          notes:                  notes.trim() || null,
        });
      }
      return true as const;
    });
    if (result !== undefined) {
      setSelected(new Set());
      setNotes('');
      setShowForm(false);
      setRefreshKey(k => k + 1);
    }
  };

  const handleCancel = () => {
    setSelected(new Set());
    setNotes('');
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
    <div>
      <PageHeader
        title={t('portal.nav.disability')}
        description={t('portal.disability.subheading')}
        actions={!showForm && (
          <Button onClick={() => setShowForm(true)}>{t('portal.disability.addDeclaration')}</Button>
        )}
      />

      {error && <Problem title={t('status.error')} detail={error} />}

      {/* Add declaration form */}
      {showForm && (
        <Card className="mb-6 border-primary-200 bg-primary-50" aria-labelledby="add-declaration-heading">
          <CardBody>
          <h2 id="add-declaration-heading" className="mb-1 text-base font-semibold text-neutral-900">
            {t('portal.disability.addDeclaration')}
          </h2>
          <p className="mb-4 text-sm text-neutral-500">
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
                        ? 'cursor-not-allowed border-neutral-100 opacity-50'
                        : isChecked
                          ? 'border-primary-400 ring-1 ring-primary-300'
                          : 'border-neutral-200 hover:border-primary-200'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
                      checked={isChecked}
                      disabled={isDeclared}
                      onChange={() => toggle(code)}
                      aria-label={displayLabel}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-neutral-900">{displayLabel}</span>
                      {description && (
                        <span className="block text-xs text-neutral-500">{description}</span>
                      )}
                    </span>
                    <span className="ml-auto shrink-0 font-mono text-xs text-neutral-400">{code}</span>
                    {isDeclared && (
                      <span className="ml-1 shrink-0 rounded-full bg-success-100 px-2 py-0.5 text-xs font-medium text-success-700">
                        Declared
                      </span>
                    )}
                  </label>
                );
              })}
            </fieldset>

            <div className="mt-4">
              <label htmlFor="declaration-notes" className="block text-sm font-medium text-neutral-700 mb-1">
                Supporting notes <span className="font-normal text-neutral-400">(optional)</span>
              </label>
              <Textarea
                id="declaration-notes"
                rows={3}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Any additional context or supporting information..."
              />
            </div>

            <div className="mt-4 flex items-center gap-3">
              <Button
                type="submit"
                disabled={submitting || newSelections.length === 0}
                icon={submitting ? <Spinner size="sm" /> : undefined}
              >
                {submitting
                  ? t('status.submitting')
                  : newSelections.length > 0
                    ? `${t('actions.submit')} (${newSelections.length})`
                    : t('actions.submit')}
              </Button>
              <Button type="button" variant="ghost" onClick={handleCancel}>
                {t('actions.cancel')}
              </Button>
            </div>
          </form>
          </CardBody>
        </Card>
      )}

      {/* Declarations list */}
      {!error && declarations?.length === 0 && (
        <EmptyState title={t('portal.disability.noDeclarations')} />
      )}

      {declarations && declarations.length > 0 && (
        <div className="space-y-3">
          {declarations.map(d => (
            <Card key={d.declarationId}>
              <CardBody className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-neutral-900">
                  {labelFor(d.disabilityCategoryCode)}
                </p>
                {hintFor(d.disabilityCategoryCode) && (
                  <p className="mt-0.5 text-xs text-neutral-500">{hintFor(d.disabilityCategoryCode)}</p>
                )}
                <p className="mt-0.5 text-xs text-neutral-400">
                  {t('portal.disability.declaredOn')} {formatDate(d.declaredAt)}
                  <span className="ml-2 font-mono">({d.disabilityCategoryCode})</span>
                </p>
                {d.notes && (
                  <p className="mt-1 text-xs text-neutral-600 italic">{d.notes}</p>
                )}
              </div>
              <Badge value={d.declarationStatusCode} />
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
