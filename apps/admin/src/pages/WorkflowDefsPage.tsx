import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  type WorkflowAssignmentRule,
  type WorkflowDefinition,
  type WorkflowDefinitionVersion,
  type WorkflowOutcomeOption,
  createGenericWorkflowVersion,
  createWorkflowAssignmentRule,
  createWorkflowDefinition,
  listWorkflowAssignmentRules,
  listWorkflowDefinitions,
  listWorkflowDefinitionVersions,
  publishWorkflowVersion,
  updateWorkflowDefinition,
} from '../api/workflowDefs.js';
import { ApiError } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';
import {
  PageHeader, Card, CardBody, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
  Button, Input, Select, LabelledField, Dialog, DialogClose,
  Tabs, TabsList, TabsTrigger, TabsContent,
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

// A workflow task shouldn't be assignable to a student or a
// machine-to-machine service account.
const ASSIGNABLE_ROLES = [
  'module-tutor', 'personal-tutor', 'engagement-officer', 'research-supervisor',
  'wellbeing-advisor', 'wellbeing-mental-health-advisor', 'wellbeing-specialist-assessor',
  'wellbeing-panel-chair', 'wellbeing-auditor', 'exam-board-member', 'exam-board-chair',
  'external-examiner', 'integrity-officer', 'registry-administrator', 'regulatory-officer',
  'finance-administrator', 'dpo', 'tenant-administrator', 'system-administrator',
  'programme-approver', 'pgr-administrator', 'pgr-director',
];

const OUTCOME_PRESETS: Record<string, WorkflowOutcomeOption[]> = {
  'approve-reject': [{ code: 'approved', label: 'Approve' }, { code: 'rejected', label: 'Reject' }],
  'mark-complete':  [{ code: 'completed', label: 'Mark complete' }],
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

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="mb-6">
          <TabsTrigger value="definitions">Definitions</TabsTrigger>
          <TabsTrigger value="assignments">Assignment rules</TabsTrigger>
        </TabsList>
        <TabsContent value="definitions"><DefinitionsTab canWrite={canWrite} /></TabsContent>
        <TabsContent value="assignments"><AssignmentsTab canWrite={canWrite} /></TabsContent>
      </Tabs>
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
  const [showStepForm, setShowStepForm] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);

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

  async function handlePublish(versionId: string) {
    setPublishingId(versionId); setError('');
    try {
      await publishWorkflowVersion(versionId);
      if (selected) await handleSelect(selected);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Publish failed');
    } finally {
      setPublishingId(null);
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
                  <div className="flex gap-2">
                    {selected.ownerModuleCode === 'custom' && (
                      <Button variant="secondary" size="sm" onClick={() => setShowStepForm(true)}>
                        Configure step
                      </Button>
                    )}
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
                  </div>
                )}
              </div>

              {selected.ownerModuleCode !== 'custom' && (
                <p className="mb-4 text-xs text-neutral-500 bg-neutral-50 border border-neutral-200 rounded px-3 py-2">
                  This definition is owned by a developer-authored module ({selected.ownerModuleCode}) and its
                  steps can only be changed in code.
                </p>
              )}

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
                        {canWrite && v.statusCode === 'draft' && (
                          <Button
                            size="sm"
                            className="ml-auto bg-success-600 hover:bg-success-700"
                            disabled={publishingId === v.workflowDefinitionVersionId}
                            onClick={() => void handlePublish(v.workflowDefinitionVersionId)}
                          >
                            {publishingId === v.workflowDefinitionVersionId ? 'Publishing…' : 'Publish'}
                          </Button>
                        )}
                      </div>

                      {v.steps.length > 0 && (
                        <div className="space-y-1">
                          {v.steps.map((s, idx) => {
                            const outcomeOptions = s.configuration['outcomeOptions'] as WorkflowOutcomeOption[] | undefined;
                            const dueAfterHours = s.configuration['dueAfterHours'] as number | null | undefined;
                            const escalateToRoleCode = s.configuration['escalateToRoleCode'] as string | null | undefined;
                            return (
                              <div key={s.stepKey} className="text-xs">
                                <div className="flex items-center gap-2">
                                  <span className="w-5 text-right text-neutral-300 flex-shrink-0">{idx + 1}.</span>
                                  <span className="font-medium text-neutral-700 flex-shrink-0">{s.displayName}</span>
                                  <span className="text-neutral-600 font-mono">{s.stepTypeCode in STEP_TYPE_LABELS ? STEP_TYPE_LABELS[s.stepTypeCode] : s.stepTypeCode}</span>
                                  {s.ownerRoleCode && (
                                    <span className="text-neutral-600 italic">{s.ownerRoleCode}</span>
                                  )}
                                </div>
                                {(outcomeOptions?.length || dueAfterHours || escalateToRoleCode) && (
                                  <div className="ml-7 mt-0.5 flex flex-wrap gap-x-3 text-neutral-500">
                                    {outcomeOptions?.length ? (
                                      <span>Outcomes: {outcomeOptions.map(o => o.label).join(' / ')}</span>
                                    ) : null}
                                    {dueAfterHours ? <span>Due after {dueAfterHours}h</span> : null}
                                    {escalateToRoleCode ? <span>Escalates to {escalateToRoleCode}</span> : null}
                                  </div>
                                )}
                              </div>
                            );
                          })}
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

      {canWrite && selected && (
        <Dialog open={showStepForm} onOpenChange={(open) => { if (!open) setShowStepForm(false); }} title={`Configure step — ${selected.displayName}`}>
          <StepForm
            onClose={() => setShowStepForm(false)}
            onCreated={() => { setShowStepForm(false); void handleSelect(selected); }}
            workflowDefinitionId={selected.workflowDefinitionId}
          />
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

function StepForm({ onClose, onCreated, workflowDefinitionId }: {
  onClose: () => void;
  onCreated: () => void;
  workflowDefinitionId: string;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');
  const [preset,     setPreset]     = useState<keyof typeof OUTCOME_PRESETS>('approve-reject');

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd                  = new FormData(e.currentTarget);
    const displayName         = String(fd.get('displayName')      ?? '').trim();
    const description         = String(fd.get('description')      ?? '').trim();
    const assigneeRoleCode    = String(fd.get('assigneeRoleCode') ?? '').trim();
    const dueAfterHoursRaw    = String(fd.get('dueAfterHours')    ?? '').trim();
    const escalateToRoleCode  = String(fd.get('escalateToRoleCode') ?? '').trim();
    if (!displayName || !assigneeRoleCode) {
      setError('Step name and assignee role are required.');
      return;
    }
    const dueAfterHours = dueAfterHoursRaw ? Number(dueAfterHoursRaw) : undefined;
    if (dueAfterHoursRaw && (!Number.isFinite(dueAfterHours) || dueAfterHours! <= 0)) {
      setError('Due-after must be a positive number of hours.');
      return;
    }

    setSubmitting(true); setError('');
    try {
      const result = await createGenericWorkflowVersion(workflowDefinitionId, {
        step: {
          displayName,
          ...(description ? { description } : {}),
          assigneeRoleCode,
          outcomeOptions: OUTCOME_PRESETS[preset] ?? OUTCOME_PRESETS['approve-reject']!,
          ...(dueAfterHours ? { dueAfterHours } : {}),
          ...(escalateToRoleCode ? { escalateToRoleCode } : {}),
        },
      });
      await publishWorkflowVersion(result.workflowDefinitionVersionId);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
      <p className="text-xs text-neutral-500">
        Creates a new, published version with one review-and-decide step. Publishing an earlier draft version is
        still available from the version list if you'd rather review before it goes live.
      </p>
      <LabelledField label="Step name" htmlFor="step-name" required>
        <Input id="step-name" name="displayName" placeholder="e.g. Data quality flag review" />
      </LabelledField>
      <LabelledField label="Description" htmlFor="step-desc" hint="Optional — shown to the assignee">
        <Input id="step-desc" name="description" />
      </LabelledField>
      <LabelledField label="Assignee role" htmlFor="step-role" required>
        <Select id="step-role" name="assigneeRoleCode" defaultValue="">
          <option value="" disabled>Select a role…</option>
          {ASSIGNABLE_ROLES.map(role => <option key={role} value={role}>{role}</option>)}
        </Select>
      </LabelledField>
      <LabelledField label="Decision outcomes" htmlFor="step-preset">
        <Select id="step-preset" value={preset} onChange={(e) => setPreset(e.target.value as keyof typeof OUTCOME_PRESETS)}>
          <option value="approve-reject">Approve / Reject</option>
          <option value="mark-complete">Single "Mark complete" outcome</option>
        </Select>
      </LabelledField>
      <LabelledField label="Due after (hours)" htmlFor="step-due" hint="Optional — leave blank for no deadline">
        <Input id="step-due" name="dueAfterHours" type="number" min="1" />
      </LabelledField>
      <LabelledField label="Escalate to role" htmlFor="step-escalate" hint="Optional — reassigned here if the deadline passes unactioned">
        <Select id="step-escalate" name="escalateToRoleCode" defaultValue="">
          <option value="">No escalation role</option>
          {ASSIGNABLE_ROLES.map(role => <option key={role} value={role}>{role}</option>)}
        </Select>
      </LabelledField>
      {error && <p className="text-sm text-danger-600">{error}</p>}
      <div className="flex justify-end gap-3 pt-2">
        <DialogClose asChild>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </DialogClose>
        <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save and publish'}</Button>
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
    // Captured before the first await: React nulls a SyntheticEvent's
    // currentTarget once the handler task returns, so reading it after an
    // await (e.g. to .reset()) throws — see EngagementCasePage for the same
    // fix, where this silently discarded a successful save as a false error.
    const form                        = e.currentTarget;
    const fd                         = new FormData(form);
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
      form.reset();
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
