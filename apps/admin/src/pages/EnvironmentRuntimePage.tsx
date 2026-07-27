import { type FormEvent, useEffect, useState } from 'react';
import {
  type EnvironmentRuntime,
  type DeploymentEnvironment,
  type EnvironmentPromotion,
  getEnvironmentRuntime,
  listEnvironments,
  listEnvironmentPromotions,
  createEnvironmentPromotion,
} from '../api/operations.js';
import { ApiError } from '../api/client.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';

type Tab = 'runtime' | 'environments' | 'promotions';

export function EnvironmentRuntimePage() {
  const [tab, setTab] = useState<Tab>('runtime');

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-4">Environment runtime</h1>

      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {(['runtime', 'environments', 'promotions'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 capitalize ${
              tab === t
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'runtime'      && <RuntimeTab />}
      {tab === 'environments' && <EnvironmentsTab />}
      {tab === 'promotions'   && <PromotionsTab />}
    </div>
  );
}

function RuntimeTab() {
  const [data,    setData]    = useState<EnvironmentRuntime | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    void (async () => {
      try {
        setData(await getEnvironmentRuntime());
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Failed to load runtime');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>;
  if (error)   return <p className="text-sm text-red-600">{error}</p>;
  if (!data)   return null;

  return (
    <div className="space-y-6">
      {/* Overview */}
      <section className="bg-white rounded-lg border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Current environment</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <KV label="Environment" value={data.environment.displayName} />
          <KV label="Type" value={data.environment.environmentTypeCode} />
          <KV label="Release version" value={data.releaseVersion} mono />
          <KV label="Migration version" value={data.migrationVersion} mono />
          {data.imageDigest && (
            <KV label="Image digest" value={data.imageDigest.slice(0, 24) + '…'} mono />
          )}
          <KV
            label="Production-like"
            value={data.environment.productionLike ? 'Yes' : 'No'}
          />
          <KV
            label="Live integrations"
            value={data.environment.liveIntegrationsAllowed ? 'Allowed' : 'Disabled'}
          />
        </div>
      </section>

      {/* Workflow definitions */}
      <section className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">
            Workflow definitions ({data.workflowDefinitions.length})
          </h2>
        </div>
        {data.workflowDefinitions.length === 0 ? (
          <p className="px-5 py-4 text-sm text-gray-600">No workflow definitions registered.</p>
        ) : (
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Definition code</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Current version</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {data.workflowDefinitions.map(w => (
                <tr key={w.definitionCode} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-gray-900">{w.definitionCode}</td>
                  <td className="px-4 py-2 text-gray-500">
                    {w.currentVersionNumber != null ? `v${w.currentVersionNumber}` : <span className="text-amber-600">none</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Feature flags */}
      <section className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">
            Feature flags ({data.featureFlags.length})
          </h2>
        </div>
        {data.featureFlags.length === 0 ? (
          <p className="px-5 py-4 text-sm text-gray-600">No feature flags registered.</p>
        ) : (
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Flag key</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Default variant</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {data.featureFlags.map(f => (
                <tr key={f.flagKey} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-gray-900">{f.flagKey}</td>
                  <td className="px-4 py-2"><Badge value={f.statusCode} /></td>
                  <td className="px-4 py-2 text-gray-500 font-mono">{f.defaultVariantKey}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function EnvironmentsTab() {
  const [envs,    setEnvs]    = useState<DeploymentEnvironment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    void listEnvironments()
      .then(setEnvs)
      .catch(e => setError(e instanceof ApiError ? e.message : 'Failed'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>;
  if (error)   return <p className="text-sm text-red-600">{error}</p>;

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      {envs.length === 0 ? (
        <p className="px-5 py-4 text-sm text-gray-600">No environments registered.</p>
      ) : (
        <table className="min-w-full divide-y divide-gray-100 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Code</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Prod-like</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Live integrations</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {envs.map(env => (
              <tr key={env.deploymentEnvironmentId} className="hover:bg-gray-50">
                <td className="px-4 py-2 font-mono text-gray-900">{env.environmentCode}</td>
                <td className="px-4 py-2 font-medium text-gray-900">{env.displayName}</td>
                <td className="px-4 py-2 text-gray-500">{env.environmentTypeCode}</td>
                <td className="px-4 py-2"><Badge value={env.productionLike ? 'yes' : 'no'} /></td>
                <td className="px-4 py-2"><Badge value={env.liveIntegrationsAllowed ? 'allowed' : 'disabled'} /></td>
                <td className="px-4 py-2"><Badge value={env.active ? 'active' : 'inactive'} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PromotionsTab() {
  const [promotions, setPromotions] = useState<EnvironmentPromotion[]>([]);
  const [envs,       setEnvs]       = useState<DeploymentEnvironment[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [showForm,   setShowForm]   = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [p, e] = await Promise.all([listEnvironmentPromotions(), listEnvironments()]);
      setPromotions(p); setEnvs(e);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setShowForm(true)}
          className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Create promotion
        </button>
      </div>

      {showForm && (
        <CreatePromotionForm
          envs={envs}
          onCreated={() => { setShowForm(false); void load(); }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          {promotions.length === 0 ? (
            <p className="px-5 py-4 text-sm text-gray-600">No promotions recorded.</p>
          ) : (
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Source → Target</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Promoted by</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Promoted at</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Completed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {promotions.map(p => {
                  const src = envs.find(e => e.deploymentEnvironmentId === p.sourceEnvId);
                  const tgt = envs.find(e => e.deploymentEnvironmentId === p.targetEnvId);
                  return (
                    <tr key={p.promotionId} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-700">
                        {src?.displayName ?? p.sourceEnvId} → {tgt?.displayName ?? p.targetEnvId}
                      </td>
                      <td className="px-4 py-2"><Badge value={p.statusCode} /></td>
                      <td className="px-4 py-2 text-gray-500">{p.promotedBy}</td>
                      <td className="px-4 py-2 text-gray-500">
                        {new Date(p.promotedAt).toLocaleString('en-GB')}
                      </td>
                      <td className="px-4 py-2 text-gray-500">
                        {p.completedAt ? new Date(p.completedAt).toLocaleString('en-GB') : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function CreatePromotionForm({
  envs, onCreated, onCancel,
}: {
  envs:      DeploymentEnvironment[];
  onCreated: () => void;
  onCancel:  () => void;
}) {
  const [srcId, setSrcId] = useState('');
  const [tgtId, setTgtId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      await createEnvironmentPromotion({ sourceEnvId: srcId, targetEnvId: tgtId, notes: notes || undefined });
      onCreated();
    } catch (e) {
      setError(e instanceof ApiError ? (e.detail ?? e.message) : 'Failed');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-gray-700 mb-4">New environment promotion</h2>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Source environment *</label>
          <select
            value={srcId}
            onChange={e => setSrcId(e.target.value)}
            required
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="">Select…</option>
            {envs.map(e => <option key={e.deploymentEnvironmentId} value={e.deploymentEnvironmentId}>{e.displayName}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Target environment *</label>
          <select
            value={tgtId}
            onChange={e => setTgtId(e.target.value)}
            required
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="">Select…</option>
            {envs.filter(e => e.deploymentEnvironmentId !== srcId).map(e => (
              <option key={e.deploymentEnvironmentId} value={e.deploymentEnvironmentId}>{e.displayName}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            placeholder="Optional notes"
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
          />
        </div>
      </div>
      <div className="mt-4 flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? 'Creating…' : 'Create'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-gray-600 font-medium uppercase tracking-wide">{label}</p>
      <p className={`mt-0.5 text-gray-900 ${mono ? 'font-mono text-xs' : 'text-sm'}`}>{value}</p>
    </div>
  );
}
