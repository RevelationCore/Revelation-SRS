import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  type WorkflowAssignmentRule,
  type WorkflowDefinition,
  type WorkflowDefinitionVersion,
  createWorkflowAssignmentRule,
  createWorkflowDefinition,
  listWorkflowAssignmentRules,
  listWorkflowDefinitions,
  listWorkflowDefinitionVersions,
  updateWorkflowDefinition,
} from '../api/workflowDefs.js';
import { ApiError } from '../api/client.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';

type Tab = 'definitions' | 'assignments';

export function WorkflowDefsPage() {
  const [tab, setTab] = useState<Tab>('definitions');

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-4">Workflow definitions</h1>

      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {(['definitions', 'assignments'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t === 'definitions' ? 'Definitions' : 'Assignment rules'}
          </button>
        ))}
      </div>

      {tab === 'definitions'  && <DefinitionsTab />}
      {tab === 'assignments'  && <AssignmentsTab />}
    </div>
  );
}

// ── Definitions tab ───────────────────────────────────────────────────────────

function DefinitionsTab() {
  const [defs,       setDefs]       = useState<WorkflowDefinition[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selected,   setSelected]   = useState<WorkflowDefinition | null>(null);
  const [versions,   setVersions]   = useState<WorkflowDefinitionVersion[]>([]);
  const [versLoad,   setVersLoad]   = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setDefs(await listWorkflowDefinitions()); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleSelect(def: WorkflowDefinition) {
    setSelected(def);
    setVersLoad(true);
    try { setVersions(await listWorkflowDefinitionVersions(def.workflowDefinitionId)); }
    catch { /* ignore */ }
    finally { setVersLoad(false); }
  }

  async function handleToggle(def: WorkflowDefinition) {
    setTogglingId(def.workflowDefinitionId); setError('');
    try {
      await updateWorkflowDefinition(def.workflowDefinitionId, { isEnabled: !def.isEnabled });
      await load();
      if (selected?.workflowDefinitionId === def.workflowDefinitionId) {
        setSelected(prev => prev ? { ...prev, isEnabled: !prev.isEnabled } : prev);
      }
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Toggle failed');
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button
          onClick={() => setShowCreate(true)}
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          New definition
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-1">
          {loading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <ul className="divide-y divide-gray-100">
                {defs.map(d => (
                  <li key={d.workflowDefinitionId}>
                    <button
                      onClick={() => void handleSelect(d)}
                      className={`w-full text-left px-4 py-3 hover:bg-gray-50 ${
                        selected?.workflowDefinitionId === d.workflowDefinitionId ? 'bg-indigo-50' : ''
                      }`}
                    >
                      <p className="text-sm font-medium text-gray-900">{d.name}</p>
                      <div className="mt-0.5 flex items-center gap-2">
                        <Badge value={d.workflowTypeCode} />
                        {d.isEnabled
                          ? <span className="text-xs text-green-600">enabled</span>
                          : <span className="text-xs text-gray-400">disabled</span>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="col-span-2">
          {selected ? (
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">{selected.name}</h2>
                  {selected.description && <p className="text-xs text-gray-500 mt-0.5">{selected.description}</p>}
                </div>
                <button
                  onClick={() => void handleToggle(selected)}
                  disabled={togglingId === selected.workflowDefinitionId}
                  className={`rounded px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                    selected.isEnabled
                      ? 'border border-red-300 text-red-600 hover:bg-red-50'
                      : 'border border-green-300 text-green-700 hover:bg-green-50'
                  }`}
                >
                  {togglingId === selected.workflowDefinitionId
                    ? 'Saving…'
                    : selected.isEnabled ? 'Disable' : 'Enable'}
                </button>
              </div>

              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Versions</h3>
              {versLoad ? (
                <Spinner />
              ) : versions.length === 0 ? (
                <p className="text-sm text-gray-400">No versions yet.</p>
              ) : (
                <div className="space-y-2">
                  {versions.map(v => (
                    <div key={v.workflowDefinitionVersionId} className={`rounded border p-3 ${v.isCurrent ? 'border-indigo-200 bg-indigo-50' : 'border-gray-100'}`}>
                      <div className="flex items-center gap-2 text-xs text-gray-600">
                        <span className="font-medium">v{v.versionNumber}</span>
                        {v.isCurrent && <Badge value="current" />}
                        {v.publishedAt && <span>Published {new Date(v.publishedAt).toLocaleDateString('en-GB')}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-400 py-8 text-center">Select a definition to view details.</p>
          )}
        </div>
      </div>

      {showCreate && (
        <CreateDefModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); void load(); }} />
      )}
    </div>
  );
}

function CreateDefModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd               = new FormData(e.currentTarget);
    const workflowTypeCode = String(fd.get('workflowTypeCode') ?? '').trim();
    const name             = String(fd.get('name')             ?? '').trim();
    const description      = String(fd.get('description')      ?? '').trim();
    if (!workflowTypeCode || !name) { setError('Type code and name are required.'); return; }
    setSubmitting(true); setError('');
    try {
      await createWorkflowDefinition({ workflowTypeCode, name, ...(description ? { description } : {}) });
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
        <h2 className="text-base font-semibold text-gray-900 mb-4">New workflow definition</h2>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          <MField name="workflowTypeCode" label="Workflow type code *" />
          <MField name="name"             label="Name *" />
          <MField name="description"      label="Description" />
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

// ── Assignment rules tab ──────────────────────────────────────────────────────

function AssignmentsTab() {
  const [rules,      setRules]      = useState<WorkflowAssignmentRule[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [creating,   setCreating]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setRules(await listWorkflowAssignmentRules()); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed to load rules'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd               = new FormData(e.currentTarget);
    const workflowTypeCode = String(fd.get('workflowTypeCode') ?? '').trim();
    const stepKey          = String(fd.get('stepKey')          ?? '').trim();
    const assigneeRoleCode = String(fd.get('assigneeRoleCode') ?? '').trim();
    if (!workflowTypeCode || !stepKey || !assigneeRoleCode) return;
    setCreating(true); setError('');
    try {
      await createWorkflowAssignmentRule({ workflowTypeCode, stepKey, assigneeRoleCode });
      setShowCreate(false);
      e.currentTarget.reset();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Create failed');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button onClick={() => setShowCreate(s => !s)} className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          New rule
        </button>
      </div>

      {showCreate && (
        <form onSubmit={(e) => void handleCreate(e)} className="flex items-end gap-3 mb-4 bg-indigo-50 rounded-lg p-4">
          <MiniField name="workflowTypeCode" label="Workflow type" />
          <MiniField name="stepKey"          label="Step key" />
          <MiniField name="assigneeRoleCode" label="Assignee role" />
          <button type="submit" disabled={creating} className="rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
            {creating ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => setShowCreate(false)} className="text-sm text-gray-500">Cancel</button>
        </form>
      )}

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : rules.length === 0 ? (
        <p className="text-sm text-gray-400">No assignment rules.</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Workflow type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Step key</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Assignee role</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Priority</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Enabled</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rules.map(r => (
                <tr key={r.assignmentRuleId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{r.workflowTypeCode}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{r.stepKey}</td>
                  <td className="px-4 py-3 text-gray-600">{r.assigneeRoleCode}</td>
                  <td className="px-4 py-3 text-gray-500">{r.priority}</td>
                  <td className="px-4 py-3">
                    {r.isEnabled
                      ? <span className="text-xs text-green-600">Yes</span>
                      : <span className="text-xs text-gray-400">No</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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

function MiniField({ name, label }: { name: string; label: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      <input name={name} className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
    </div>
  );
}
