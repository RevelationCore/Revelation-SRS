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

type Tab = 'locale' | 'currency' | 'labels';

export function GlobalisationPage() {
  const { roles }  = useAuth();
  const canWrite   = roles.includes('tenant-administrator') || roles.includes('system-administrator');
  const [tab, setTab] = useState<Tab>('locale');

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-4">Globalisation</h1>

      {!canWrite && (
        <p className="mb-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          You have read-only access to globalisation settings.
        </p>
      )}

      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {(['locale', 'currency', 'labels'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t === 'locale' ? 'Locale & timezone' : t === 'currency' ? 'Currency' : 'Value-set labels'}
          </button>
        ))}
      </div>

      {tab === 'locale'   && <LocaleTab   canWrite={canWrite} />}
      {tab === 'currency' && <CurrencyTab canWrite={canWrite} />}
      {tab === 'labels'   && <LabelsTab   canWrite={canWrite} />}
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
    <section className="bg-white rounded-lg border border-gray-200 p-6 max-w-lg">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <ConfigField name="defaultLocale"   label="Default locale"   defaultValue={config?.defaultLocale ?? ''}   placeholder="en-GB"          disabled={!canWrite} />
        <ConfigField name="defaultTimeZone" label="Default timezone" defaultValue={config?.defaultTimeZone ?? ''} placeholder="Europe/London" disabled={!canWrite} />

        <div>
          <p className="text-xs font-medium text-gray-600 mb-1">Supported locales</p>
          <p className="text-xs text-gray-500 font-mono">{config?.supportedLocales.join(', ') || '—'}</p>
        </div>

        {error   && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-green-600">{success}</p>}

        {canWrite && (
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </form>
    </section>
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
    <section className="bg-white rounded-lg border border-gray-200 p-6 max-w-lg">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <ConfigField name="defaultCurrencyCode" label="Default currency code" defaultValue={config?.defaultCurrencyCode ?? ''} placeholder="GBP" disabled={!canWrite} />

        <div>
          <p className="text-xs font-medium text-gray-600 mb-1">Accepted currencies</p>
          <p className="text-xs text-gray-500 font-mono">{config?.acceptedCurrencies?.join(', ') || '—'}</p>
        </div>

        {error   && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-green-600">{success}</p>}

        {canWrite && (
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </form>
    </section>
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
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-hidden overflow-y-auto max-h-[calc(100vh-16rem)]">
          <ul className="divide-y divide-gray-100">
            {labelSets.map(ls => (
              <li key={ls.setCode}>
                <button
                  onClick={() => void handleSelectSet(ls.setCode)}
                  className={`w-full text-left px-4 py-3 text-sm hover:bg-gray-50 ${
                    selected === ls.setCode ? 'bg-indigo-50' : ''
                  }`}
                >
                  <span className="font-mono text-xs text-gray-700">{ls.setCode}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="col-span-2 overflow-y-auto max-h-[calc(100vh-16rem)]">
        {error   && <p className="mb-3 text-sm text-red-600">{error}</p>}
        {success && <p className="mb-3 text-sm text-green-600">{success}</p>}

        {editing ? (
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4 font-mono">{editing.setCode}</h2>
            <form onSubmit={(e) => void handleSave(e)} className="space-y-3">
              {Object.entries(editing.labels).map(([code, label]) => (
                <div key={code} className="flex items-center gap-3">
                  <span className="text-xs font-mono text-gray-500 w-32 flex-shrink-0">{code}</span>
                  <input
                    name={code}
                    defaultValue={label}
                    disabled={!canWrite}
                    className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-700"
                  />
                </div>
              ))}
              {canWrite && (
                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Save labels'}
                  </button>
                </div>
              )}
            </form>
          </div>
        ) : (
          <p className="text-sm text-gray-600 py-8 text-center">Select a value set to edit its labels.</p>
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
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-700"
      />
    </div>
  );
}
