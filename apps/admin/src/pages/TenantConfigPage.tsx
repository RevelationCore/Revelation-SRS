import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  type Tenant,
  type TenantConfiguration,
  createTenant,
  getTenantConfiguration,
  listTenants,
  updateTenantConfiguration,
} from '../api/tenant.js';
import { ApiError } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';

export function TenantConfigPage() {
  const { roles }         = useAuth();
  const isSysAdmin        = roles.includes('system-administrator');

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-6">Tenant configuration</h1>
      <div className="space-y-8">
        <TenantConfigForm />
        {isSysAdmin && <TenantsPanel />}
      </div>
    </div>
  );
}

// ── Current-tenant configuration ──────────────────────────────────────────────

function TenantConfigForm() {
  const { roles }              = useAuth();
  const canWrite               = roles.includes('tenant-administrator') || roles.includes('system-administrator');
  const [config,   setConfig]  = useState<TenantConfiguration | null>(null);
  const [loading,  setLoading] = useState(true);
  const [saving,   setSaving]  = useState(false);
  const [error,    setError]   = useState('');
  const [success,  setSuccess] = useState('');

  useEffect(() => {
    getTenantConfiguration()
      .then(setConfig)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Failed to load config'))
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!config || !canWrite) return;
    const fd = new FormData(e.currentTarget);
    const patch: Partial<TenantConfiguration> = {
      institutionName:        String(fd.get('institutionName')        ?? '').trim() || undefined,
      defaultLocale:          String(fd.get('defaultLocale')          ?? '').trim() || undefined,
      defaultTimezone:        String(fd.get('defaultTimezone')        ?? '').trim() || undefined,
      defaultCurrencyCode:    String(fd.get('defaultCurrencyCode')    ?? '').trim() || undefined,
      ukprn:                  String(fd.get('ukprn')                  ?? '').trim() || undefined,
      hesaSubscriberId:       String(fd.get('hesaSubscriberId')       ?? '').trim() || undefined,
      ucasProviderCode:       String(fd.get('ucasProviderCode')       ?? '').trim() || undefined,
    };
    const yearMonth = Number(fd.get('academicYearStartMonth'));
    if (!isNaN(yearMonth) && yearMonth > 0) patch.academicYearStartMonth = yearMonth;

    setSaving(true); setError(''); setSuccess('');
    try {
      await updateTenantConfiguration(patch);
      setSuccess('Configuration saved.');
      const updated = await getTenantConfiguration();
      setConfig(updated);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex justify-center py-8"><Spinner /></div>;

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-700 mb-4">Institution settings</h2>
      {!canWrite && (
        <p className="mb-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          You have read-only access to this configuration.
        </p>
      )}
      <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-2 gap-4">
        <Field name="institutionName"        label="Institution name"               defaultValue={config?.institutionName ?? ''}           disabled={!canWrite} />
        <Field name="defaultLocale"          label="Default locale"                 defaultValue={config?.defaultLocale ?? ''}             disabled={!canWrite} />
        <Field name="defaultTimezone"        label="Default timezone"               defaultValue={config?.defaultTimezone ?? ''}           disabled={!canWrite} />
        <Field name="defaultCurrencyCode"    label="Default currency code"          defaultValue={config?.defaultCurrencyCode ?? ''}       disabled={!canWrite} />
        <Field name="academicYearStartMonth" label="Academic year start month (1–12)" defaultValue={String(config?.academicYearStartMonth ?? '')} type="number" disabled={!canWrite} />
        <Field name="ukprn"                  label="UKPRN"                          defaultValue={config?.ukprn ?? ''}                    disabled={!canWrite} />
        <Field name="hesaSubscriberId"       label="HESA subscriber ID"             defaultValue={config?.hesaSubscriberId ?? ''}          disabled={!canWrite} />
        <Field name="ucasProviderCode"       label="UCAS provider code"             defaultValue={config?.ucasProviderCode ?? ''}          disabled={!canWrite} />

        {error   && <p className="col-span-2 text-sm text-red-600">{error}</p>}
        {success && <p className="col-span-2 text-sm text-green-600">{success}</p>}

        {canWrite && (
          <div className="col-span-2 flex justify-end pt-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save configuration'}
            </button>
          </div>
        )}
      </form>
    </section>
  );
}

// ── System-admin: tenants list ────────────────────────────────────────────────

function TenantsPanel() {
  const [tenants,    setTenants]    = useState<Tenant[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [creating,   setCreating]   = useState(false);
  const [slug,       setSlug]       = useState('');
  const [displayName, setDisplayName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTenants(await listTenants());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load tenants');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!slug.trim() || !displayName.trim()) return;
    setCreating(true);
    setError('');
    try {
      await createTenant({ slug: slug.trim(), displayName: displayName.trim() });
      setSlug(''); setDisplayName(''); setShowCreate(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Create failed');
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-700">All tenants (system admin)</h2>
        <button
          onClick={() => setShowCreate(s => !s)}
          className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
        >
          New tenant
        </button>
      </div>

      {showCreate && (
        <form onSubmit={(e) => void handleCreate(e)} className="flex items-center gap-3 mb-4 p-4 bg-indigo-50 rounded-lg">
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="slug"
            className="rounded border border-gray-300 px-3 py-1.5 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Display name"
            className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit"
            disabled={creating}
            className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
          <button type="button" onClick={() => setShowCreate(false)} className="text-sm text-gray-500">Cancel</button>
        </form>
      )}

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-4"><Spinner /></div>
      ) : tenants.length === 0 ? (
        <p className="text-sm text-gray-600">No tenants found.</p>
      ) : (
        <div className="overflow-hidden border border-gray-100 rounded-lg">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Slug</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {tenants.map(t => (
                <tr key={t.tenantId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{t.slug}</td>
                  <td className="px-4 py-3 text-gray-900">{t.displayName}</td>
                  <td className="px-4 py-3"><Badge value={t.statusCode} /></td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{new Date(t.createdAt).toLocaleDateString('en-GB')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Field({
  name,
  label,
  defaultValue = '',
  type = 'text',
  disabled = false,
}: {
  name:          string;
  label:         string;
  defaultValue?: string;
  type?:         string;
  disabled?:     boolean;
}) {
  return (
    <div>
      <label htmlFor={`tenant-config-${name}`} className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input
        id={`tenant-config-${name}`}
        name={name}
        type={type}
        defaultValue={defaultValue}
        disabled={disabled}
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-700"
      />
    </div>
  );
}
