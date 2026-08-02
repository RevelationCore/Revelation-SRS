import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  type FeatureFlag,
  type FeatureFlagAssignment,
  type FeatureFlagImpact,
  createFeatureFlag,
  createFeatureFlagAssignment,
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
import { PageHeader, Card, Button, Dialog, DialogClose, LabelledField, Input, Select } from '@revelation-srs/ui';

type DetailTab = 'assignments' | 'governance' | 'impact';

export function FeatureFlagsPage() {
  const { roles }      = useAuth();
  const isSysAdmin     = roles.includes('system-administrator');
  const canWrite       = roles.includes('tenant-administrator') || isSysAdmin;

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
      <PageHeader
        title="Feature flags"
        actions={canWrite && <Button onClick={() => setShowCreate(true)}>New flag</Button>}
      />

      {!canWrite && (
        <p className="mb-4 text-xs text-warning-700 bg-warning-50 border border-warning-200 rounded px-3 py-2">
          You have read-only access to feature flags.
        </p>
      )}

      {error && <p className="mb-4 text-sm text-danger-600">{error}</p>}

      <div className="grid grid-cols-3 gap-6 items-start">
        {/* Flags list */}
        <div className="col-span-1">
          {loading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : flags.length === 0 ? (
            <p className="text-sm text-neutral-600">No feature flags.</p>
          ) : (
            <Card className="overflow-x-hidden overflow-y-auto max-h-[calc(100vh-14rem)]">
              <ul className="divide-y divide-neutral-100">
                {flags.map(f => (
                  <li key={f.featureFlagId}>
                    <button
                      onClick={() => setSelected(f)}
                      className={`w-full text-left px-4 py-3 hover:bg-neutral-50 ${
                        selected?.featureFlagId === f.featureFlagId ? 'bg-primary-50' : ''
                      }`}
                    >
                      <p className="text-xs font-mono font-medium text-neutral-900">{f.flagKey}</p>
                      <div className="mt-0.5 flex items-center gap-2">
                        <Badge value={f.statusCode} />
                        <span className="text-xs text-neutral-500">default: {f.defaultVariantKey}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        {/* Flag detail */}
        <div className="col-span-2 overflow-y-auto max-h-[calc(100vh-14rem)]">
          {selected ? (
            <FlagDetail
              flag={selected}
              canWrite={canWrite}
              isSysAdmin={isSysAdmin}
              onRefresh={async () => {
                await load();
                const refreshed = flags.find(f => f.featureFlagId === selected.featureFlagId);
                if (refreshed) setSelected(refreshed);
              }}
            />
          ) : (
            <p className="text-sm text-neutral-600 py-8 text-center">Select a flag to view details.</p>
          )}
        </div>
      </div>

      {canWrite && (
        <Dialog open={showCreate} onOpenChange={(open) => { if (!open) setShowCreate(false); }} title="New feature flag">
          <CreateFlagForm onClose={() => setShowCreate(false)} onCreated={handleCreated} />
        </Dialog>
      )}
    </div>
  );
}

// ── Flag detail ───────────────────────────────────────────────────────────────

function FlagDetail({
  flag,
  canWrite,
  isSysAdmin,
  onRefresh,
}: {
  flag:       FeatureFlag;
  canWrite:   boolean;
  isSysAdmin: boolean;
  onRefresh:  () => Promise<void>;
}) {
  const [tab,         setTab]         = useState<DetailTab>('assignments');
  const [assignments, setAssignments] = useState<FeatureFlagAssignment[]>([]);
  const [impact,      setImpact]      = useState<FeatureFlagImpact | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [retiring,    setRetiring]    = useState(false);
  const [confirmRetire, setConfirmRetire] = useState(false);
  const [toggling,    setToggling]    = useState(false);
  const [showAddAssignment, setShowAddAssignment] = useState(false);
  const [addingAssignment,  setAddingAssignment]  = useState(false);

  useEffect(() => {
    if (tab === 'governance') return; // governance fields come from the flag object
    setLoading(true); setError('');
    const flagId = flag.featureFlagId;
    if (tab === 'assignments') {
      listFeatureFlagAssignments(flagId)
        .then(setAssignments)
        .catch(() => setAssignments([]))
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
      const next = flag.defaultVariantKey === 'on' ? 'off' : 'on';
      await updateFeatureFlag(flag.featureFlagId, { defaultVariantKey: next });
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
    const fd         = new FormData(e.currentTarget);
    const variantKey = String(fd.get('variantKey') ?? '').trim();
    const roleCode   = String(fd.get('roleCode')   ?? '').trim();
    setAddingAssignment(true); setError('');
    try {
      await createFeatureFlagAssignment(flag.featureFlagId, {
        ...(variantKey ? { variantKey } : {}),
        ...(roleCode   ? { roleCode }   : {}),
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

  const isDefaultOn = flag.defaultVariantKey === 'on';

  return (
    <Card>
      <div className="p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-base font-mono font-semibold text-neutral-900">{flag.flagKey}</p>
          <p className="text-xs text-neutral-600 mt-0.5">{flag.displayName}</p>
          {flag.description && <p className="text-xs text-neutral-500 mt-0.5">{flag.description}</p>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {canWrite && (
            <Button
              variant="secondary"
              size="sm"
              className={isDefaultOn ? 'border-danger-300 text-danger-600 hover:bg-danger-50' : 'border-success-300 text-success-700 hover:bg-success-50'}
              onClick={() => void handleToggleDefault()}
              disabled={toggling || flag.statusCode === 'retired'}
            >
              {toggling ? '…' : isDefaultOn ? 'Default: ON' : 'Default: OFF'}
            </Button>
          )}
          {isSysAdmin && flag.statusCode !== 'retired' && (
            confirmRetire ? (
              <span className="inline-flex items-center gap-1">
                <Button
                  variant="secondary"
                  size="sm"
                  className="border-danger-300 text-danger-600 hover:bg-danger-50"
                  onClick={() => void handleRetire()}
                  disabled={retiring}
                >
                  {retiring ? '…' : 'Confirm retire'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmRetire(false)}>Cancel</Button>
              </span>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => setConfirmRetire(true)}>Retire</Button>
            )
          )}
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}

      <div className="flex gap-1 mb-4 border-b border-neutral-200">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px ${
              tab === id ? 'border-primary-600 text-primary-600' : 'border-transparent text-neutral-500 hover:text-neutral-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Governance tab reads directly from flag — no spinner needed */}
      {tab === 'governance' && (
        <dl className="grid grid-cols-2 gap-3 text-xs">
          <InfoRow label="Class"               value={flag.flagClassCode} />
          <InfoRow label="Risk"                value={flag.riskClassCode} />
          <InfoRow label="Owner contact"       value={flag.ownerContact} />
          <InfoRow label="Review date"         value={flag.reviewDate ? new Date(flag.reviewDate).toLocaleDateString('en-GB') : null} />
          <InfoRow label="Retirement condition" value={flag.retirementCondition} />
          <InfoRow label="Non-bypassable"      value={flag.nonBypassable ? 'Yes' : 'No'} />
          {flag.allowedScopeCodes.length > 0 && (
            <div className="col-span-2">
              <dt className="text-neutral-500 mb-0.5">Allowed scopes</dt>
              <dd className="text-neutral-900 font-mono">{flag.allowedScopeCodes.join(', ')}</dd>
            </div>
          )}
        </dl>
      )}

      {tab !== 'governance' && (
        loading ? <Spinner /> : (
          <>
            {tab === 'assignments' && (
              <div>
                {assignments.length === 0 ? (
                  <p className="text-xs text-neutral-600 mb-3">No overrides — default applies everywhere.</p>
                ) : (
                  <table className="min-w-full text-xs mb-3">
                    <thead>
                      <tr className="text-neutral-600 uppercase text-xs">
                        <th className="text-left pb-1 pr-4">Scope</th>
                        <th className="text-left pb-1 pr-4">Variant</th>
                        <th className="text-left pb-1 pr-4">Active from</th>
                        <th className="text-left pb-1 pr-4">Active to</th>
                        <th className="text-left pb-1">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assignments.map(a => {
                        const variant  = flag.variants.find(v => v.featureFlagVariantId === a.variantId);
                        const scopeStr = a.roleCode ?? a.cohortCode ?? a.programmeId ?? a.sourceSystemCode ?? '(global)';
                        return (
                          <tr key={a.featureFlagAssignmentId}>
                            <td className="py-1 pr-4 font-mono text-neutral-700">{scopeStr}</td>
                            <td className="py-1 pr-4 text-neutral-600">{variant ? variant.variantKey : '—'}</td>
                            <td className="py-1 pr-4 text-neutral-500">{new Date(a.activeFrom).toLocaleDateString('en-GB')}</td>
                            <td className="py-1 pr-4 text-neutral-500">{a.activeTo ? new Date(a.activeTo).toLocaleDateString('en-GB') : '—'}</td>
                            <td className="py-1"><Badge value={a.statusCode} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                {canWrite && (
                  showAddAssignment ? (
                    <form onSubmit={(e) => void handleAddAssignment(e)} className="flex items-end gap-2 mt-2 bg-primary-50 rounded p-3 flex-wrap">
                      <div>
                        <label className="block text-xs text-neutral-600 mb-0.5">Variant</label>
                        <select name="variantKey" className="rounded border border-neutral-300 px-2 py-1 text-xs">
                          {flag.variants.map(v => (
                            <option key={v.featureFlagVariantId} value={v.variantKey}>{v.variantKey}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-neutral-600 mb-0.5">Role code (optional)</label>
                        <input name="roleCode" className="rounded border border-neutral-300 px-2 py-1 text-xs w-36" />
                      </div>
                      <button type="submit" disabled={addingAssignment} className="rounded bg-primary-600 px-2.5 py-1 text-xs text-white disabled:opacity-50">
                        {addingAssignment ? '…' : 'Add'}
                      </button>
                      <button type="button" onClick={() => setShowAddAssignment(false)} className="text-xs text-neutral-500">Cancel</button>
                    </form>
                  ) : (
                    <button onClick={() => setShowAddAssignment(true)} className="text-xs text-primary-600 hover:text-primary-800">
                      + Add assignment
                    </button>
                  )
                )}
              </div>
            )}

            {tab === 'impact' && (
              <div className="space-y-4 text-xs">
                {impact ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded bg-neutral-50 border border-neutral-200 p-3">
                        <p className="text-neutral-500 mb-0.5">Active assignments</p>
                        <p className="text-lg font-semibold text-neutral-900">{impact.activeAssignmentCount}</p>
                      </div>
                      <div className="rounded bg-neutral-50 border border-neutral-200 p-3">
                        <p className="text-neutral-500 mb-0.5">Tenants affected</p>
                        <p className="text-lg font-semibold text-neutral-900">{impact.activeTenantsCount}</p>
                      </div>
                    </div>

                    <div>
                      <p className="font-medium text-neutral-700 mb-1">Current default variant</p>
                      <p className="font-mono text-neutral-600">{impact.currentDefaultVariantKey}
                        {impact.currentDefaultValue !== undefined && (
                          <span className="ml-2 text-neutral-600">({String(impact.currentDefaultValue)})</span>
                        )}
                      </p>
                    </div>

                    {impact.activeTenantIds.length > 0 && (
                      <div>
                        <p className="font-medium text-neutral-700 mb-1">Tenants ({impact.activeTenantIds.length})</p>
                        <ul className="list-disc list-inside text-neutral-500 font-mono space-y-0.5">
                          {impact.activeTenantIds.map(id => <li key={id}>{id}</li>)}
                        </ul>
                      </div>
                    )}

                    {impact.referencingTriggerRuleKeys.length > 0 && (
                      <div>
                        <p className="font-medium text-neutral-700 mb-1">Referencing trigger rules ({impact.referencingTriggerRuleKeys.length})</p>
                        <ul className="list-disc list-inside text-neutral-500 font-mono space-y-0.5">
                          {impact.referencingTriggerRuleKeys.map(k => <li key={k}>{k}</li>)}
                        </ul>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-neutral-600">No impact data available.</p>
                )}
              </div>
            )}
          </>
        )
      )}
      </div>
    </Card>
  );
}

// ── Create modal ──────────────────────────────────────────────────────────────

function CreateFlagForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd              = new FormData(e.currentTarget);
    const flagKey         = String(fd.get('flagKey')        ?? '').trim();
    const displayName     = String(fd.get('displayName')    ?? '').trim();
    const ownerModuleCode = String(fd.get('ownerModuleCode') ?? '').trim();
    const description     = String(fd.get('description')    ?? '').trim();
    const defaultVariantKey = String(fd.get('defaultVariantKey') ?? 'off').trim();
    if (!flagKey || !displayName || !ownerModuleCode) { setError('Flag key, display name and module are required.'); return; }
    setSubmitting(true); setError('');
    try {
      await createFeatureFlag({ flagKey, displayName, ownerModuleCode, defaultVariantKey, ...(description ? { description } : {}) });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
      <LabelledField label="Flag key (kebab-case)" htmlFor="ff-key" required>
        <Input id="ff-key" name="flagKey" />
      </LabelledField>
      <LabelledField label="Display name" htmlFor="ff-name" required>
        <Input id="ff-name" name="displayName" />
      </LabelledField>
      <LabelledField label="Owner module" htmlFor="ff-module" required>
        <Input id="ff-module" name="ownerModuleCode" />
      </LabelledField>
      <LabelledField label="Description" htmlFor="ff-desc" hint="Optional">
        <Input id="ff-desc" name="description" />
      </LabelledField>
      <LabelledField label="Default variant" htmlFor="ff-variant">
        <Select id="ff-variant" name="defaultVariantKey">
          <option value="off">off</option>
          <option value="on">on</option>
        </Select>
      </LabelledField>
      {error && <p className="text-sm text-danger-600">{error}</p>}
      <div className="flex justify-end gap-3 pt-2">
        <DialogClose asChild>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </DialogClose>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </form>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="w-36 flex-shrink-0 text-neutral-500">{label}</dt>
      <dd className="text-neutral-900">{value ?? <span className="text-neutral-600">—</span>}</dd>
    </div>
  );
}
