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
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';
import {
  PageHeader, Card, CardBody, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
  Button, Input, LabelledField, Dialog, DialogClose,
} from '@revelation-srs/ui';

type Tab = 'definitions' | 'assignments';

const STEP_TYPE_LABELS: Record<string, string> = {
  start:          'Start',
  end:            'End',
  'human-task':   'Human task',
  decision:       'Decision',
  integration:    'Integration',
  notification:   'Notification',
  parallel:       'Parallel',
};

export function WorkflowDefsPage() {
  const { roles }  = useAuth();
  const canWrite   = userHasAnyPermission(roles, ['workflow:write']);
  const [tab, setTab] = useState<Tab>('definitions');

  return (
    <div>
      <PageHeader title="Workflow definitions" />

      {!canWrite && (
        <p className="mb-4 text-xs text-warning-700 bg-warning-50 border border-warning-200 rounded px-3 py-2">
          You have read-only access to workflow definitions.
        </p>
      )}

      <div className="flex gap-1 mb-6 border-b border-neutral-200">
        {(['definitions', 'assignments'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-neutral-500 hover:text-neutral-800'
            }`}
          >
            {t === 'definitions' ? 'Definitions' : 'Assignment rules'}
          </button>
        ))}
      </div>

      {tab === 'definitions'  && <DefinitionsTab canWrite={canWrite} />}
      {tab === 'assignments'  && <AssignmentsTab canWrite={canWrite} />}
    </div>
  );
}

// ── Definitions tab ───────────────────────────────────────────────────────────

function DefinitionsTab({ canWrite }: { canWrite: boolean }) {
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
    const nextStatus = def.statusCode === 'active' ? 'disabled' : 'active';
    try {
      await updateWorkflowDefinition(def.workflowDefinitionId, { statusCode: nextStatus });
      await load();
      if (selected?.workflowDefinitionId === def.workflowDefinitionId) {
        setSelected(prev => prev ? { ...prev, statusCode: nextStatus } : prev);
      }
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Toggle failed');
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div>
      {canWrite && (
        <div className="flex justify-end mb-4">
          <Button onClick={() => setShowCreate(true)}>New definition</Button>
        </div>
      )}

      {error && <p className="mb-4 text-sm text-danger-600">{error}</p>}

      <div className="grid grid-cols-3 gap-6 items-start">
        <div className="col-span-1">
          {loading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : (
            <Card className="overflow-x-hidden overflow-y-auto max-h-[calc(100vh-14rem)]">
              <ul className="divide-y divide-neutral-100">
                {defs.map(d => (
                  <li key={d.workflowDefinitionId}>
                    <button
                      onClick={() => void handleSelect(d)}
                      className={`w-full text-left px-4 py-3 hover:bg-neutral-50 ${
                        selected?.workflowDefinitionId === d.workflowDefinitionId ? 'bg-primary-50' : ''
                      }`}
                    >
                      <p className="text-sm font-medium text-neutral-900">{d.displayName}</p>
                      <div className="mt-0.5 flex items-center gap-2">
                        <span className="font-mono text-xs text-neutral-600">{d.definitionCode}</span>
                        {d.statusCode === 'active'
                          ? <span className="text-xs text-success-600">active</span>
                          : <span className="text-xs text-neutral-600">{d.statusCode}</span>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="col-span-2 overflow-y-auto max-h-[calc(100vh-14rem)]">
          {selected ? (
            <Card>
              <CardBody>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-neutral-900">{selected.displayName}</h2>
                  <p className="text-xs font-mono text-neutral-600 mt-0.5">{selected.definitionCode}</p>
                  {selected.description && <p className="text-xs text-neutral-500 mt-1">{selected.description}</p>}
                </div>
                {canWrite && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className={selected.statusCode === 'active' ? 'border-danger-300 text-danger-600 hover:bg-danger-50' : 'border-success-300 text-success-700 hover:bg-success-50'}
                    onClick={() => void handleToggle(selected)}
                    disabled={togglingId === selected.workflowDefinitionId}
                  >
                    {togglingId === selected.workflowDefinitionId
                      ? 'Saving…'
                      : selected.statusCode === 'active' ? 'Disable' : 'Enable'}
                  </Button>
                )}
              </div>

              <h3 className="text-xs font-semibold text-neutral-500 uppercase mb-2">Versions</h3>
              {versLoad ? (
                <Spinner />
              ) : versions.length === 0 ? (
                <p className="text-sm text-neutral-600">No versions yet.</p>
              ) : (
                <div className="space-y-3">
                  {versions.map(v => (
                    <div
                      key={v.workflowDefinitionVersionId}
                      className={`rounded border p-3 ${v.statusCode === 'current' ? 'border-primary-200 bg-primary-50' : 'border-neutral-100'}`}
                    >
                      <div className="flex items-center gap-2 text-xs text-neutral-600 mb-2">
                        <span className="font-medium">v{v.versionNumber}</span>
                        <Badge value={v.statusCode} />
                        {v.effectiveFrom && (
                          <span className="text-neutral-600">
                            Published {new Date(v.effectiveFrom).toLocaleDateString('en-GB')}
                          </span>
                        )}
                      </div>

                      {v.steps.length > 0 && (
                        <div className="space-y-1">
                          {v.steps.map((s, idx) => (
                            <div key={s.stepKey} className="flex items-center gap-2 text-xs">
                              <span className="w-5 text-right text-neutral-300 flex-shrink-0">{idx + 1}.</span>
                              <span className="font-medium text-neutral-700 flex-shrink-0">{s.displayName}</span>
                              <span className="text-neutral-600 font-mono">{s.stepTypeCode in STEP_TYPE_LABELS ? STEP_TYPE_LABELS[s.stepTypeCode] : s.stepTypeCode}</span>
                              {s.ownerRoleCode && (
                                <span className="text-neutral-600 italic">{s.ownerRoleCode}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              </CardBody>
            </Card>
          ) : (
            <p className="text-sm text-neutral-600 py-8 text-center">Select a definition to view details.</p>
          )}
        </div>
      </div>

      {canWrite && (
        <Dialog open={showCreate} onOpenChange={(open) => { if (!open) setShowCreate(false); }} title="New workflow definition">
          <CreateDefForm onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); void load(); }} />
        </Dialog>
      )}
    </div>
  );
}

function CreateDefForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd             = new FormData(e.currentTarget);
    const definitionCode = String(fd.get('definitionCode') ?? '').trim();
    const displayName    = String(fd.get('displayName')    ?? '').trim();
    const description    = String(fd.get('description')    ?? '').trim();
    if (!definitionCode || !displayName) { setError('Definition code and display name are required.'); return; }
    setSubmitting(true); setError('');
    try {
      await createWorkflowDefinition({ definitionCode, displayName, ...(description ? { description } : {}) });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
      <LabelledField label="Definition code" htmlFor="wf-code" required><Input id="wf-code" name="definitionCode" /></LabelledField>
      <LabelledField label="Display name" htmlFor="wf-name" required><Input id="wf-name" name="displayName" /></LabelledField>
      <LabelledField label="Description" htmlFor="wf-desc" hint="Optional"><Input id="wf-desc" name="description" /></LabelledField>
      {error && <p className="text-sm text-danger-600">{error}</p>}
      <div className="flex justify-end gap-3 pt-2">
        <DialogClose asChild>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </DialogClose>
        <Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create'}</Button>
      </div>
    </form>
  );
}

// ── Assignment rules tab ──────────────────────────────────────────────────────

function AssignmentsTab({ canWrite }: { canWrite: boolean }) {
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
    const fd                         = new FormData(e.currentTarget);
    const workflowDefinitionVersionId = String(fd.get('workflowDefinitionVersionId') ?? '').trim();
    const stepKey                    = String(fd.get('stepKey')                     ?? '').trim();
    const ruleKey                    = String(fd.get('ruleKey')                     ?? '').trim();
    const assigneeRoleCode           = String(fd.get('assigneeRoleCode')            ?? '').trim();
    if (!workflowDefinitionVersionId || !stepKey || !ruleKey) return;
    setCreating(true); setError('');
    try {
      await createWorkflowAssignmentRule({
        workflowDefinitionVersionId,
        stepKey,
        ruleKey,
        ...(assigneeRoleCode ? { assigneeRoleCode } : {}),
      });
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
      {canWrite && (
        <div className="flex justify-end mb-4">
          <Button onClick={() => setShowCreate(s => !s)}>New rule</Button>
        </div>
      )}

      {canWrite && showCreate && (
        <form onSubmit={(e) => void handleCreate(e)} className="flex items-end gap-3 mb-4 bg-primary-50 rounded-lg p-4 flex-wrap">
          <MiniField name="workflowDefinitionVersionId" label="Version ID" />
          <MiniField name="stepKey"                     label="Step key" />
          <MiniField name="ruleKey"                     label="Rule key" />
          <MiniField name="assigneeRoleCode"            label="Assignee role" />
          <Button type="submit" disabled={creating}>{creating ? 'Saving…' : 'Save'}</Button>
          <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
        </form>
      )}

      {error && <p className="mb-4 text-sm text-danger-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : rules.length === 0 ? (
        <p className="text-sm text-neutral-600">No assignment rules.</p>
      ) : (
        <Card>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Workflow</TableHeaderCell>
                <TableHeaderCell>Step</TableHeaderCell>
                <TableHeaderCell>Assignee role</TableHeaderCell>
                <TableHeaderCell>Priority</TableHeaderCell>
                <TableHeaderCell>Active</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {rules.map(r => (
                <TableRow key={r.workflowAssignmentRuleId}>
                  <TableCell className="font-mono text-xs text-neutral-700">{r.definitionCode}</TableCell>
                  <TableCell className="font-mono text-xs text-neutral-700">{r.stepKey}</TableCell>
                  <TableCell>{r.assigneeRoleCode ?? '—'}</TableCell>
                  <TableCell>{r.priority}</TableCell>
                  <TableCell>
                    {r.active
                      ? <span className="text-xs text-success-600">Yes</span>
                      : <span className="text-xs text-neutral-600">No</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function MiniField({ name, label }: { name: string; label: string }) {
  return (
    <LabelledField label={label} htmlFor={`wfa-${name}`}>
      <Input id={`wfa-${name}`} name={name} />
    </LabelledField>
  );
}
