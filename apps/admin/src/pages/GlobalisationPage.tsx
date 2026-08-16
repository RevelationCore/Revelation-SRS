import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  type CurrencyConfig,
  type LocaleConfig,
  type ValueSetLabels,
  getCurrencyConfig,
  getLocaleConfig,
  getValueSetLabels,
  listValueSetLabels,
  updateCurrencyConfig,
  updateLocaleConfig,
  updateValueSetLabels,
} from '../api/globalisation.js';
import { ApiError } from '../api/client.js';
import { Spinner } from '../components/Spinner.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { PageHeader, Card, CardBody, Button, Input, LabelledField, Tabs, TabsList, TabsTrigger, TabsContent } from '@revelation-srs/ui';

type Tab = 'locale' | 'currency' | 'labels';

export function GlobalisationPage() {
  const { roles }  = useAuth();
  const canWrite   = userHasAnyPermission(roles, ['globalisation:write']);
  const [tab, setTab] = useState<Tab>('locale');

  return (
    <div>
      <PageHeader title="Globalisation" />

      {!canWrite && (
        <p className="mb-4 text-xs text-warning-700 bg-warning-50 border border-warning-200 rounded px-3 py-2">
          You have read-only access to globalisation settings.
        </p>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="mb-6">
          <TabsTrigger value="locale">Locale &amp; timezone</TabsTrigger>
          <TabsTrigger value="currency">Currency</TabsTrigger>
          <TabsTrigger value="labels">Value-set labels</TabsTrigger>
        </TabsList>
        <TabsContent value="locale"><LocaleTab canWrite={canWrite} /></TabsContent>
        <TabsContent value="currency"><CurrencyTab canWrite={canWrite} /></TabsContent>
        <TabsContent value="labels"><LabelsTab canWrite={canWrite} /></TabsContent>
      </Tabs>
    </div>
  );
}

// ── Locale tab ────────────────────────────────────────────────────────────────

function LocaleTab({ canWrite }: { canWrite: boolean }) {
  const [config,  setConfig]  = useState<LocaleConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    getLocaleConfig()
      .then(setConfig)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Failed to load locale config'))
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canWrite) return;
    const fd = new FormData(e.currentTarget);
    const patch: Partial<LocaleConfig> = {
      defaultLocale:   String(fd.get('defaultLocale')   ?? '').trim() || undefined,
      defaultTimeZone: String(fd.get('defaultTimeZone') ?? '').trim() || undefined,
    };
    setSaving(true); setError(''); setSuccess('');
    try {
      await updateLocaleConfig(patch);
      setSuccess('Locale configuration saved.');
      setConfig(await getLocaleConfig());
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex justify-center py-8"><Spinner /></div>;

  return (
    <Card className="max-w-lg">
      <CardBody>
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <ConfigField name="defaultLocale"   label="Default locale"   defaultValue={config?.defaultLocale ?? ''}   placeholder="en-GB"          disabled={!canWrite} />
        <ConfigField name="defaultTimeZone" label="Default timezone" defaultValue={config?.defaultTimeZone ?? ''} placeholder="Europe/London" disabled={!canWrite} />

        <div>
          <p className="text-xs font-medium text-neutral-600 mb-1">Supported locales</p>
          <p className="text-xs text-neutral-500 font-mono">{config?.supportedLocales.join(', ') || '—'}</p>
        </div>

        {error   && <p className="text-sm text-danger-600">{error}</p>}
        {success && <p className="text-sm text-success-600">{success}</p>}

        {canWrite && (
          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        )}
      </form>
      </CardBody>
    </Card>
  );
}

// ── Currency tab ──────────────────────────────────────────────────────────────

function CurrencyTab({ canWrite }: { canWrite: boolean }) {
  const [config,  setConfig]  = useState<CurrencyConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    getCurrencyConfig()
      .then(setConfig)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Failed to load currency config'))
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canWrite) return;
    const fd = new FormData(e.currentTarget);
    const patch: Partial<CurrencyConfig> = {
      defaultCurrencyCode: String(fd.get('defaultCurrencyCode') ?? '').trim() || undefined,
    };
    setSaving(true); setError(''); setSuccess('');
    try {
      await updateCurrencyConfig(patch);
      setSuccess('Currency configuration saved.');
      setConfig(await getCurrencyConfig());
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex justify-center py-8"><Spinner /></div>;

  return (
    <Card className="max-w-lg">
      <CardBody>
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <ConfigField name="defaultCurrencyCode" label="Default currency code" defaultValue={config?.defaultCurrencyCode ?? ''} placeholder="GBP" disabled={!canWrite} />

        <div>
          <p className="text-xs font-medium text-neutral-600 mb-1">Accepted currencies</p>
          <p className="text-xs text-neutral-500 font-mono">{config?.acceptedCurrencies?.join(', ') || '—'}</p>
        </div>

        {error   && <p className="text-sm text-danger-600">{error}</p>}
        {success && <p className="text-sm text-success-600">{success}</p>}

        {canWrite && (
          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        )}
      </form>
      </CardBody>
    </Card>
  );
}

// ── Value-set labels tab ──────────────────────────────────────────────────────

function LabelsTab({ canWrite }: { canWrite: boolean }) {
  const [labelSets,  setLabelSets]  = useState<ValueSetLabels[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [selected,   setSelected]   = useState<string | null>(null);
  const [editing,    setEditing]    = useState<ValueSetLabels | null>(null);
  const [saving,     setSaving]     = useState(false);
  const [success,    setSuccess]    = useState('');

  const load = useCallback(async () => {
    try {
      setLabelSets(await listValueSetLabels());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load labels');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleSelectSet(setCode: string) {
    setSelected(setCode);
    setSuccess('');
    try {
      const data = await getValueSetLabels(setCode);
      setEditing(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load label set');
    }
  }

  async function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing || !canWrite) return;
    const fd = new FormData(e.currentTarget);
    const labels: Record<string, string> = {};
    for (const [key, val] of fd.entries()) {
      labels[key] = String(val).trim();
    }
    setSaving(true); setError(''); setSuccess('');
    try {
      await updateValueSetLabels(editing.setCode, labels);
      setSuccess('Labels saved.');
      setEditing({ ...editing, labels });
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex justify-center py-8"><Spinner /></div>;

  return (
    <div className="grid grid-cols-3 gap-6 items-start">
      <div className="col-span-1">
        <Card className="overflow-x-hidden overflow-y-auto max-h-[calc(100vh-16rem)]">
          <ul className="divide-y divide-neutral-100">
            {labelSets.map(ls => (
              <li key={ls.setCode}>
                <button
                  onClick={() => void handleSelectSet(ls.setCode)}
                  className={`w-full text-left px-4 py-3 text-sm hover:bg-neutral-50 ${
                    selected === ls.setCode ? 'bg-primary-50' : ''
                  }`}
                >
                  <span className="font-mono text-xs text-neutral-700">{ls.setCode}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="col-span-2 overflow-y-auto max-h-[calc(100vh-16rem)]">
        {error   && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        {success && <p className="mb-3 text-sm text-success-600">{success}</p>}

        {editing ? (
          <Card>
            <CardBody>
            <h2 className="text-sm font-semibold text-neutral-700 mb-4 font-mono">{editing.setCode}</h2>
            <form onSubmit={(e) => void handleSave(e)} className="space-y-3">
              {Object.entries(editing.labels).map(([code, label]) => (
                <div key={code} className="flex items-center gap-3">
                  <span className="text-xs font-mono text-neutral-500 w-32 flex-shrink-0">{code}</span>
                  <Input
                    name={code}
                    defaultValue={label}
                    disabled={!canWrite}
                    className="flex-1"
                  />
                </div>
              ))}
              {canWrite && (
                <div className="flex justify-end pt-2">
                  <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save labels'}</Button>
                </div>
              )}
            </form>
            </CardBody>
          </Card>
        ) : (
          <p className="text-sm text-neutral-600 py-8 text-center">Select a value set to edit its labels.</p>
        )}
      </div>
    </div>
  );
}

// ── Shared form field ─────────────────────────────────────────────────────────

function ConfigField({
  name,
  label,
  defaultValue = '',
  placeholder = '',
  disabled = false,
}: {
  name:          string;
  label:         string;
  defaultValue?: string;
  placeholder?:  string;
  disabled?:     boolean;
}) {
  return (
    <LabelledField label={label} htmlFor={`glob-${name}`}>
      <Input id={`glob-${name}`} name={name} defaultValue={defaultValue} placeholder={placeholder} disabled={disabled} />
    </LabelledField>
  );
}
