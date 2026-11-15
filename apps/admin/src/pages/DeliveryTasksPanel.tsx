import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Card, CardHeader, CardBody, Button, Input, Select, LabelledField, Badge, Spinner,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';

import {
  type DeliveryFlowConfig,
  type DeliveryTask,
  confirmDelivered, listDeliveryFlows, listDeliveryTasks, reportDeliveryFailure, runDeliveryExtract, setDeliveryFlow,
} from '../api/adjustmentTasks.js';
import { type AcademicPeriod, listAcademicPeriods } from '../api/academicPeriods.js';
import { ApiError } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { useValueSet } from '../hooks/useValueSet.js';

/**
 * Changes for adjacent systems the institution has not connected (library,
 * CRM, ...). Staff make each change in the system, then confirm it — the
 * reply a connector would send. Below, every outbound flow with no other
 * route and how it is fulfilled, including flows the SRS cannot produce yet.
 */
export function DeliveryTasksPanel() {
  const { roles } = useAuth();
  const canConfigure = userHasAnyPermission(roles, ['config:write']);
  const [searchParams] = useSearchParams();
  const [flowFilter, setFlowFilter] = useState(searchParams.get('flow') ?? '');
  const [flows, setFlows] = useState<DeliveryFlowConfig[] | null>(null);
  const [tasks, setTasks] = useState<DeliveryTask[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [f, t] = await Promise.all([listDeliveryFlows(), listDeliveryTasks(flowFilter || undefined)]);
      setFlows(f);
      setTasks(t);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to load tasks');
    }
  }, [flowFilter]);
  useEffect(() => { void load(); }, [load]);

  const overdue = tasks?.filter((t) => t.overdue).length ?? 0;

  return (
    <div>
      {error && <p className="mb-4 text-sm text-danger-600" role="alert">{error}</p>}

      <Card className="mb-6">
        <CardHeader
          title={tasks ? `${tasks.length} open${overdue ? ` · ${overdue} overdue` : ''}` : 'Open tasks'}
          actions={(
            <Select aria-label="Filter by flow" value={flowFilter} onChange={(e) => setFlowFilter(e.target.value)}>
              <option value="">All flows</option>
              {(flows ?? []).filter((f) => f.producer !== 'none').map((f) => (
                <option key={f.flowCode} value={f.flowCode}>{f.name}</option>
              ))}
            </Select>
          )}
        />
        <CardBody>
          {tasks === null ? <Spinner /> : tasks.length === 0 ? (
            <p className="text-sm text-neutral-500">Nothing to do.</p>
          ) : (
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Do</TableHeaderCell>
                  <TableHeaderCell>Student</TableHeaderCell>
                  <TableHeaderCell>Waiting since</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {tasks.map((task) => <DeliveryTaskRow key={task.deliveryItemId} task={task} onDone={() => void load()} />)}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <FlowSettings flows={flows} canConfigure={canConfigure} onSaved={() => void load()} />
    </div>
  );
}

function DeliveryTaskRow({ task, onDone }: { task: DeliveryTask; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try {
      await action();
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  function submitFailure(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    void run(() => reportDeliveryFailure(task, reason.trim()));
  }

  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col gap-1">
          <span className="font-medium text-neutral-800">{task.summary}</span>
          <span className="text-xs text-neutral-500">{task.flowName} · {task.targetLabel}</span>
          {task.overdue && <Badge value="overdue" />}
          {task.statusCode === 'failed' && <span className="text-xs text-danger-600">Could not apply: {task.failureReason}</span>}
          {task.ownerDescription && <span className="text-xs text-neutral-500">{task.ownerDescription}</span>}
        </div>
      </TableCell>
      <TableCell>
        <div>{task.studentName ?? '—'}</div>
        <div className="text-xs text-neutral-500">{task.studentNumber ?? task.personId ?? task.subjectId}</div>
      </TableCell>
      <TableCell className="text-sm">{new Date(task.createdAt).toLocaleString('en-GB')}</TableCell>
      <TableCell>
        {error && <p className="mb-1 text-xs text-danger-600" role="alert">{error}</p>}
        {reporting ? (
          <form onSubmit={submitFailure} className="flex flex-col gap-2">
            <Input aria-label="Why it cannot be applied" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why it cannot be applied" />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={busy || !reason.trim()}>Report</Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setReporting(false)}>Cancel</Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => void run(() => confirmDelivered(task))}>Confirm done</Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setReporting(true)}>Can't apply</Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

function FlowSettings({ flows, canConfigure, onSaved }: { flows: DeliveryFlowConfig[] | null; canConfigure: boolean; onSaved: () => void }) {
  const { members: modes } = useValueSet('delivery_flow_config', 'fulfilment_mode_code');
  const [periods, setPeriods] = useState<AcademicPeriod[]>([]);
  useEffect(() => { listAcademicPeriods().then(setPeriods).catch(() => setPeriods([])); }, []);
  return (
    <Card>
      <CardHeader title="Outbound flows to other systems" />
      <CardBody>
        <p className="mb-4 text-sm text-neutral-600">
          Every reference-model flow from the SRS to a system with no other route, and how this institution fulfils it.
          A flow marked &ldquo;No SRS trigger yet&rdquo; is known but not produced: nothing reaches that system from the SRS today.
        </p>
        {flows === null ? <Spinner /> : (
          <div className="flex flex-col gap-5">
            {flows.map((flow) => (
              <div key={flow.flowCode} className="flex flex-col gap-2">
                <FlowSettingRow flow={flow} modes={modes} canConfigure={canConfigure} onSaved={onSaved} />
                {flow.producer === 'extract' && <ExtractRun flow={flow} periods={periods} onRan={onSaved} />}
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function FlowSettingRow({
  flow, modes, canConfigure, onSaved,
}: {
  flow: DeliveryFlowConfig;
  modes: Array<{ code: string; displayLabel: string }>;
  canConfigure: boolean;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState(flow.fulfilmentModeCode);
  const [owner, setOwner] = useState(flow.ownerDescription ?? '');
  const [hours, setHours] = useState(String(flow.alertAfterHours));
  const [email, setEmail] = useState(flow.notifyEmail ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const id = `flow-${flow.flowCode.toLowerCase()}`;
  const label = flow.name;

  async function save(e: FormEvent) {
    e.preventDefault();
    const alertAfterHours = Number(hours);
    if (!Number.isInteger(alertAfterHours) || alertAfterHours < 1) {
      setError('Overdue after must be a whole number of hours, at least 1.');
      return;
    }
    setSaving(true); setError('');
    try {
      await setDeliveryFlow(flow.flowCode, {
        fulfilmentModeCode: mode,
        ownerDescription: owner.trim() || null,
        alertAfterHours,
        notifyEmail: email.trim() || null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void save(e)} className="grid grid-cols-1 items-end gap-3 md:grid-cols-6">
      <div>
        <div className="font-medium text-neutral-800">{flow.name}</div>
        <div className="text-xs text-neutral-500">
          {flow.flowCode} · {flow.targetLabel}
          {flow.producer === 'none' && <> · <span className="text-warning-700">No SRS trigger yet</span></>}
          {flow.producer === 'extract' && <> · Run per academic period</>}
        </div>
      </div>
      <LabelledField label={`${label} fulfilment`} htmlFor={`${id}-mode`}>
        <Select id={`${id}-mode`} value={mode} disabled={!canConfigure} onChange={(e) => setMode(e.target.value)}>
          {modes.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
        </Select>
      </LabelledField>
      <LabelledField label={`${label} owner`} htmlFor={`${id}-owner`}>
        <Input id={`${id}-owner`} value={owner} disabled={!canConfigure} placeholder="e.g. Library team" onChange={(e) => setOwner(e.target.value)} />
      </LabelledField>
      <LabelledField label={`${label} overdue after (hours)`} htmlFor={`${id}-hours`}>
        <Input id={`${id}-hours`} type="number" min="1" value={hours} disabled={!canConfigure} onChange={(e) => setHours(e.target.value)} />
      </LabelledField>
      <LabelledField label={`${label} overdue notices to`} htmlFor={`${id}-email`}>
        <Input id={`${id}-email`} type="email" value={email} disabled={!canConfigure} placeholder="team mailbox (optional)" onChange={(e) => setEmail(e.target.value)} />
      </LabelledField>
      <div>
        {canConfigure && <Button type="submit" size="sm" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>}
        {error && <p className="mt-1 text-xs text-danger-600" role="alert">{error}</p>}
      </div>
    </form>
  );
}

/** An aggregate flow (estates, surveys, curriculum) is produced on demand for a period. */
function ExtractRun({ flow, periods, onRan }: { flow: DeliveryFlowConfig; periods: AcademicPeriod[]; onRan: () => void }) {
  const [periodId, setPeriodId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const id = `run-${flow.flowCode.toLowerCase()}`;

  async function run(e: FormEvent) {
    e.preventDefault();
    if (!periodId) return;
    setBusy(true); setMessage('');
    try {
      const r = await runDeliveryExtract(flow.flowCode, periodId);
      setMessage(`${r.periodCode}: ${r.created} sent, ${r.unchanged} unchanged (${r.offerings} offerings)`);
      onRan();
    } catch (err) {
      setMessage(err instanceof ApiError ? (err.detail ?? err.message) : 'Run failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void run(e)} className="flex flex-wrap items-end gap-2 pl-1">
      <LabelledField label={`Run ${flow.name} for`} htmlFor={id}>
        <Select id={id} value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
          <option value="">Choose a period…</option>
          {periods.map((p) => <option key={p.academicPeriodId} value={p.academicPeriodId}>{p.academicYear} {p.periodCode}</option>)}
        </Select>
      </LabelledField>
      <Button type="submit" size="sm" variant="secondary" disabled={busy || !periodId}>{busy ? 'Running…' : 'Run'}</Button>
      {message && <span className="text-xs text-neutral-600" role="status">{message}</span>}
    </form>
  );
}
