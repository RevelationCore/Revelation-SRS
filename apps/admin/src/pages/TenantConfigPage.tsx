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
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';
import {
  PageHeader, Card, CardHeader, CardBody, Button, Input, LabelledField,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';

export function TenantConfigPage() {
  const { roles }         = useAuth();
  const isSysAdmin        = roles.includes('system-administrator');

  return (
    <div>
      <PageHeader title="Tenant configuration" />
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
  const canWrite               = userHasAnyPermission(roles, ['config:write']);
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
    <Card>
      <CardHeader title="Institution settings" />
      <CardBody>
      {!canWrite && (
        <p className="mb-4 text-xs text-warning-700 bg-warning-50 border border-warning-200 rounded px-3 py-2">
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

        {error   && <p className="col-span-2 text-sm text-danger-600">{error}</p>}
        {success && <p className="col-span-2 text-sm text-success-600">{success}</p>}

        {canWrite && (
          <div className="col-span-2 flex justify-end pt-2">
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save configuration'}</Button>
          </div>
        )}
      </form>
      </CardBody>
    </Card>
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
    <Card>
      <CardHeader
        title="All tenants (system admin)"
        actions={<Button size="sm" onClick={() => setShowCreate(s => !s)}>New tenant</Button>}
      />
      <CardBody>
      {showCreate && (
        <form onSubmit={(e) => void handleCreate(e)} className="flex items-center gap-3 mb-4 p-4 bg-primary-50 rounded-lg">
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="slug"
            className="w-32"
          />
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Display name"
            className="flex-1"
          />
          <Button type="submit" disabled={creating}>{creating ? 'Creating…' : 'Create'}</Button>
          <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
        </form>
      )}

      {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-4"><Spinner /></div>
      ) : tenants.length === 0 ? (
        <p className="text-sm text-neutral-600">No tenants found.</p>
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Slug</TableHeaderCell>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Created</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {tenants.map(t => (
              <TableRow key={t.tenantId}>
                <TableCell className="font-mono text-xs text-neutral-700">{t.slug}</TableCell>
                <TableCell className="text-neutral-900">{t.displayName}</TableCell>
                <TableCell><Badge value={t.statusCode} /></TableCell>
                <TableCell className="text-xs">{new Date(t.createdAt).toLocaleDateString('en-GB')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      </CardBody>
    </Card>
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
    <LabelledField label={label} htmlFor={`tenant-config-${name}`}>
      <Input id={`tenant-config-${name}`} name={name} type={type} defaultValue={defaultValue} disabled={disabled} />
    </LabelledField>
  );
}
