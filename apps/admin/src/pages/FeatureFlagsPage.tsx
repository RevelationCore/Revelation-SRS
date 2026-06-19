import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  type FeatureFlag,
  type FeatureFlagAssignment,
  type FeatureFlagGovernance,
  type FeatureFlagImpact,
  createFeatureFlag,
  createFeatureFlagAssignment,
  getFeatureFlagGovernance,
  getFeatureFlagImpact,
  listFeatureFlagAssignments,
  listFeatureFlags,
  retireFeatureFlag,
  updateFeatureFlag,
} from '../api/featureFlags.js';
import { ApiError } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';

type DetailTab = 'assignments' | 'governance' | 'impact';

export function FeatureFlagsPage() {
  const { roles }      = useAuth();
  const isSysAdmin     = roles.includes('system-administrator');

  const [flags,      setFlags]      = useState<FeatureFlag[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selected,   setSelected]   = useState<FeatureFlag | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setFlags(await listFeatureFlags()); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed to load flags'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function handleCreated() {
    setShowCreate(false);
    void load();
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-4">Feature flags</h1>

      <div className="flex justify-end mb-4">
        <button
          onClick={() => setShowCreate(true)}
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          New flag
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-3 gap-6">
        {/* Flags list */}
        <div className="col-span-1">
          {loading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : flags.length === 0 ? (
            <p className="text-sm text-gray-400">No feature flags.</p>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <ul className="divide-y divide-gray-100">
                {flags.map(f => (
                  <li key={f.featureFlagId}>
                    <button
                      onClick={() => setSelected(f)}
                      className={`w-full text-left px-4 py-3 hover:bg-gray-50 ${
                        selected?.featureFlagId === f.featureFlagId ? 'bg-indigo-50' : ''
                      }`}
                    >
                      <p className="text-xs font-mono font-medium text-gray-900">{f.flagKey}</p>
                      <div className="mt-0.5 flex items-center gap-2">
                        <Badge value={f.statusCode} />
                        <span className="text-xs text-gray-500">
                          default: {f.defaultValue ? 'on' : 'off'}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Flag detail */}
        <div className="col-span-2">
          {selected ? (
            <FlagDetail
              flag={selected}
              isSysAdmin={isSysAdmin}
              onRefresh={async () => {
                await load();
                const refreshed = flags.find(f => f.featureFlagId === selected.featureFlagId);
                if (refreshed) setSelected(refreshed);
              }}
            />
          ) : (
            <p className="text-sm text-gray-400 py-8 text-center">Select a flag to view details.</p>
          )}
        </div>
      </div>

      {showCreate && <CreateFlagModal onClose={() => setShowCreate(false)} onCreated={handleCreated} />}
    </div>
  );
}

// ── Flag detail ───────────────────────────────────────────────────────────────

function FlagDetail({
  flag,
  isSysAdmin,
  onRefresh,
}: {
  flag:       FeatureFlag;
  isSysAdmin: boolean;
  onRefresh:  () => Promise<void>;
}) {
  const [tab,         setTab]         = useState<DetailTab>('assignments');
  const [assignments, setAssignments] = useState<FeatureFlagAssignment[]>([]);
  const [governance,  setGovernance]  = useState<FeatureFlagGovernance | null>(null);
  const [impact,      setImpact]      = useState<FeatureFlagImpact | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [retiring,    setRetiring]    = useState(false);
  const [confirmRetire, setConfirmRetire] = useState(false);
  const [toggling,    setToggling]    = useState(false);
  const [showAddAssignment, setShowAddAssignment] = useState(false);
  const [addingAssignment,  setAddingAssignment]  = useState(false);

  useEffect(() => {
    setLoading(true); setError('');
    const flagId = flag.featureFlagId;
    if (tab === 'assignments') {
      listFeatureFlagAssignments(flagId)
        .then(setAssignments)
        .catch(() => setAssignments([]))
        .finally(() => setLoading(false));
    } else if (tab === 'governance') {
      getFeatureFlagGovernance(flagId)
        .then(setGovernance)
        .catch(() => setGovernance(null))
        .finally(() => setLoading(false));
    } else if (tab === 'impact') {
      getFeatureFlagImpact(flagId)
        .then(setImpact)
        .catch(() => setImpact(null))
        .finally(() => setLoading(false));
    }
  }, [flag.featureFlagId, tab]);

  async function handleToggleDefault() {
    setToggling(true); setError('');
    try {
      await updateFeatureFlag(flag.featureFlagId, { defaultValue: !flag.defaultValue });
      await onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Update failed');
    } finally {
      setToggling(false);
    }
  }

  async function handleRetire() {
    setRetiring(true); setError('');
    try {
      await retireFeatureFlag(flag.featureFlagId);
      setConfirmRetire(false);
      await onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Retire failed');
    } finally {
      setRetiring(false);
    }
  }

  async function handleAddAssignment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd           = new FormData(e.currentTarget);
    const scopeTypeCode = String(fd.get('scopeTypeCode') ?? '').trim();
    const scopeId       = String(fd.get('scopeId')       ?? '').trim();
    const value         = fd.get('value') === 'true';
    if (!scopeTypeCode) return;
    setAddingAssignment(true); setError('');
    try {
      await createFeatureFlagAssignment(flag.featureFlagId, {
        scopeTypeCode,
        ...(scopeId ? { scopeId } : {}),
        value,
      });
      setShowAddAssignment(false);
      setAssignments(await listFeatureFlagAssignments(flag.featureFlagId));
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Assignment failed');
    } finally {
      setAddingAssignment(false);
    }
  }

  const TABS: { id: DetailTab; label: string }[] = [
    { id: 'assignments', label: 'Assignments' },
    { id: 'governance',  label: 'Governance' },
    { id: 'impact',      label: 'Impact' },
  ];

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-base font-mono font-semibold text-gray-900">{flag.flagKey}</p>
          {flag.description && <p className="text-xs text-gray-500 mt-0.5">{flag.description}</p>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => void handleToggleDefault()}
            disabled={toggling || flag.statusCode === 'retired'}
            className={`rounded border px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
              flag.defaultValue
                ? 'border-red-300 text-red-600 hover:bg-red-50'
                : 'border-green-300 text-green-700 hover:bg-green-50'
            }`}
          >
            {toggling ? '…' : flag.defaultValue ? 'Default: ON' : 'Default: OFF'}
          </button>
          {isSysAdmin && flag.statusCode !== 'retired' && (
            confirmRetire ? (
              <span className="inline-flex items-center gap-1">
                <button
                  onClick={() => void handleRetire()}
                  disabled={retiring}
                  className="rounded border border-red-300 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {retiring ? '…' : 'Confirm retire'}
                </button>
                <button onClick={() => setConfirmRetire(false)} className="text-xs text-gray-500">Cancel</button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmRetire(true)}
                className="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
              >
                Retire
              </button>
            )
          )}
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px ${
              tab === id ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? <Spinner /> : (
        <>
          {tab === 'assignments' && (
            <div>
              {assignments.length === 0 ? (
                <p className="text-xs text-gray-400 mb-3">No overrides — default applies everywhere.</p>
              ) : (
                <table className="min-w-full text-xs mb-3">
                  <thead>
                    <tr className="text-gray-400 uppercase text-xs">
                      <th className="text-left pb-1 pr-4">Scope type</th>
                      <th className="text-left pb-1 pr-4">Scope ID</th>
                      <th className="text-left pb-1 pr-4">Value</th>
                      <th className="text-left pb-1">Expires</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.map(a => (
                      <tr key={a.assignmentId}>
                        <td className="py-1 pr-4 font-mono text-gray-700">{a.scopeTypeCode}</td>
                        <td className="py-1 pr-4 text-gray-500">{a.scopeId ?? '—'}</td>
                        <td className="py-1 pr-4">
                          {a.value
                            ? <span className="text-green-600 font-medium">ON</span>
                            : <span className="text-red-500 font-medium">OFF</span>}
                        </td>
                        <td className="py-1 text-gray-500">{a.expiresAt ? new Date(a.expiresAt).toLocaleDateString('en-GB') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {showAddAssignment ? (
                <form onSubmit={(e) => void handleAddAssignment(e)} className="flex items-end gap-2 mt-2 bg-indigo-50 rounded p-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-0.5">Scope type</label>
                    <input name="scopeTypeCode" className="rounded border border-gray-300 px-2 py-1 text-xs w-28" required />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-0.5">Scope ID (optional)</label>
                    <input name="scopeId" className="rounded border border-gray-300 px-2 py-1 text-xs w-36" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-0.5">Value</label>
                    <select name="value" className="rounded border border-gray-300 px-2 py-1 text-xs">
                      <option value="true">ON</option>
                      <option value="false">OFF</option>
                    </select>
                  </div>
                  <button type="submit" disabled={addingAssignment} className="rounded bg-indigo-600 px-2.5 py-1 text-xs text-white disabled:opacity-50">
                    {addingAssignment ? '…' : 'Add'}
                  </button>
                  <button type="button" onClick={() => setShowAddAssignment(false)} className="text-xs text-gray-500">Cancel</button>
                </form>
              ) : (
                <button onClick={() => setShowAddAssignment(true)} className="text-xs text-indigo-600 hover:text-indigo-800">
                  + Add assignment
                </button>
              )}
            </div>
          )}

          {tab === 'governance' && (
            <div className="space-y-2 text-sm">
              {governance ? (
                <dl className="grid grid-cols-2 gap-3 text-xs">
                  <InfoRow label="Approved by"  value={governance.approvedBy} />
                  <InfoRow label="Approved at"  value={governance.approvedAt ? new Date(governance.approvedAt).toLocaleDateString('en-GB') : null} />
                  <InfoRow label="Rationale"    value={governance.rationale} />
                  <InfoRow label="Review cycle" value={governance.reviewCycle} />
                  <InfoRow label="Next review"  value={governance.nextReviewAt ? new Date(governance.nextReviewAt).toLocaleDateString('en-GB') : null} />
                </dl>
              ) : (
                <p className="text-xs text-gray-400">No governance record.</p>
              )}
            </div>
          )}

          {tab === 'impact' && (
            <div className="space-y-3 text-xs">
              {impact ? (
                <>
                  {impact.estimatedScope && <p className="text-gray-600">{impact.estimatedScope}</p>}
                  <div>
                    <p className="font-medium text-gray-700 mb-1">Affected rules ({impact.affectedRuleIds.length})</p>
                    {impact.affectedRuleIds.length > 0
                      ? <ul className="list-disc list-inside text-gray-500 font-mono">{impact.affectedRuleIds.map(id => <li key={id}>{id}</li>)}</ul>
                      : <p className="text-gray-400">None</p>}
                  </div>
                  <div>
                    <p className="font-medium text-gray-700 mb-1">Affected workflows ({impact.affectedWorkflows.length})</p>
                    {impact.affectedWorkflows.length > 0
                      ? <ul className="list-disc list-inside text-gray-500">{impact.affectedWorkflows.map(w => <li key={w}>{w}</li>)}</ul>
                      : <p className="text-gray-400">None</p>}
                  </div>
                </>
              ) : (
                <p className="text-gray-400">No impact data.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Create modal ──────────────────────────────────────────────────────────────

function CreateFlagModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd           = new FormData(e.currentTarget);
    const flagKey      = String(fd.get('flagKey')      ?? '').trim();
    const description  = String(fd.get('description')  ?? '').trim();
    const defaultValue = fd.get('defaultValue') === 'true';
    if (!flagKey) { setError('Flag key is required.'); return; }
    setSubmitting(true); setError('');
    try {
      await createFeatureFlag({ flagKey, defaultValue, ...(description ? { description } : {}) });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg border border-gray-200 p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-gray-900 mb-4">New feature flag</h2>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          <MField name="flagKey"     label="Flag key * (snake_case)" />
          <MField name="description" label="Description" />
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Default value</label>
            <select name="defaultValue" className="w-full rounded border border-gray-300 px-3 py-2 text-sm">
              <option value="false">OFF (false)</option>
              <option value="true">ON (true)</option>
            </select>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
            <button type="submit" disabled={submitting} className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MField({ name, label }: { name: string; label: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      <input name={name} className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 flex-shrink-0 text-gray-500">{label}</dt>
      <dd className="text-gray-900">{value ?? <span className="text-gray-400">—</span>}</dd>
    </div>
  );
}
