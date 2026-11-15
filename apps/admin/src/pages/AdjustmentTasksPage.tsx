import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  PageHeader, Card, CardHeader, CardBody, Button, Input, Select, LabelledField, Badge, Spinner,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';

import {
  type AdjustmentTargetConfig,
  type AdjustmentTask,
  confirmApplied, confirmRemoved, listAdjustmentTargets, listAdjustmentTasks, reportCannotApply, setAdjustmentTarget,
} from '../api/adjustmentTasks.js';
import { ApiError } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { useValueSet } from '../hooks/useValueSet.js';

const TARGET_LABELS: Record<string, string> = { vle: 'VLE', attendance: 'Attendance', exams: 'Exams' };

/**
 * Reasonable-adjustment instructions for target systems the institution has
 * not connected. A person applies each one in whatever tool the team uses,
 * then confirms it here — the same replies a connector would send — so an
 * approved adjustment never waits silently for a system that does not exist.
 */
export function AdjustmentTasksPage() {
  return (
    <div>
      <PageHeader
        title="Adjustment tasks"
        description="Approved adjustments for systems with no connected integration. Apply each one, then confirm it here."
      />
      <AdjustmentTasksPanel />
    </div>
  );
}

/** The adjustment queue and target settings, without a page header (a tab of Integration tasks). */
export function AdjustmentTasksPanel() {
  const { roles } = useAuth();
  const canConfigure = userHasAnyPermission(roles, ['config:write']);
  // ?target=attendance — the link in an overdue digest opens the right queue.
  const [searchParams] = useSearchParams();
  const initialTarget = searchParams.get('target') ?? '';
  const [targetFilter, setTargetFilter] = useState(initialTarget in TARGET_LABELS ? initialTarget : '');
  const [tasks, setTasks] = useState<AdjustmentTask[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setTasks(await listAdjustmentTasks(targetFilter || undefined));
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to load tasks');
    }
  }, [targetFilter]);

  useEffect(() => { void load(); }, [load]);

  const overdue = tasks?.filter((t) => t.overdue).length ?? 0;

  return (
    <div>
      {error && <p className="mb-4 text-sm text-danger-600" role="alert">{error}</p>}

      <Card className="mb-6">
        <CardHeader
          title={tasks ? `${tasks.length} open${overdue ? ` · ${overdue} overdue` : ''}` : 'Open tasks'}
          actions={(
            <Select aria-label="Filter by target" value={targetFilter} onChange={(e) => setTargetFilter(e.target.value)}>
              <option value="">All targets</option>
              {Object.entries(TARGET_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
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
                  <TableHeaderCell>Adjustment</TableHeaderCell>
                  <TableHeaderCell>Valid</TableHeaderCell>
                  <TableHeaderCell>Waiting since</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {tasks.map((task) => <TaskRow key={task.distributionId} task={task} onDone={() => void load()} />)}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <TargetSettings canConfigure={canConfigure} onChanged={() => void load()} />
    </div>
  );
}

function TaskRow({ task, onDone }: { task: AdjustmentTask; onDone: () => void }) {
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
    void run(() => reportCannotApply(task, reason.trim()));
  }

  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col gap-1">
          <span className="font-medium text-neutral-800">
            {task.action === 'apply' ? 'Apply' : 'Remove'} in {TARGET_LABELS[task.targetSystem] ?? task.targetSystem}
          </span>
          {task.overdue && <Badge value="overdue" />}
          {task.statusCode === 'failed' && <span className="text-xs text-danger-600">Could not apply: {task.failureReason}</span>}
          {task.ownerDescription && <span className="text-xs text-neutral-500">{task.ownerDescription}</span>}
        </div>
      </TableCell>
      <TableCell>
        <div>{task.studentName ?? '—'}</div>
        <div className="text-xs text-neutral-500">{task.studentNumber ?? task.personId}</div>
      </TableCell>
      <TableCell>
        <div>{task.adjustmentTypeCode.replace(/-/g, ' ')}</div>
        <div className="text-xs text-neutral-500">
          {task.amount ? `${task.amount.value} ${task.amount.unitCode.replace(/-/g, ' ')} · ` : ''}{task.scopeCode}
        </div>
      </TableCell>
      <TableCell className="text-sm">
        {new Date(task.validFrom).toLocaleDateString('en-GB')}
        {' – '}
        {task.validTo ? new Date(task.validTo).toLocaleDateString('en-GB') : 'open-ended'}
      </TableCell>
      <TableCell className="text-sm">{new Date(task.dueSince).toLocaleString('en-GB')}</TableCell>
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
            {task.action === 'apply' ? (
              <Button size="sm" disabled={busy} onClick={() => void run(() => confirmApplied(task))}>Confirm applied</Button>
            ) : (
              <Button size="sm" disabled={busy} onClick={() => void run(() => confirmRemoved(task))}>Confirm removed</Button>
            )}
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setReporting(true)}>Can't apply</Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

function TargetSettings({ canConfigure, onChanged }: { canConfigure: boolean; onChanged: () => void }) {
  const [configs, setConfigs] = useState<AdjustmentTargetConfig[] | null>(null);
  const [error, setError] = useState('');
  const { members: modes } = useValueSet('adjustment_target_config', 'fulfilment_mode_code');

  const load = useCallback(async () => {
    try {
      setConfigs(await listAdjustmentTargets());
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to load settings');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <Card>
      <CardHeader title="How each target is fulfilled" />
      <CardBody>
        <p className="mb-4 text-sm text-neutral-600">
          Connected: an integration applies adjustments automatically. Manual: they appear in this task list.
          File: delivered through a file exchange the SRS produces. Not used: no adjustments are sent.
          A change applies to adjustments approved from now on. A manual target with a mailbox is sent one
          digest a day while tasks are overdue — counts and a link only, no student details.
        </p>
        {error && <p className="mb-3 text-sm text-danger-600" role="alert">{error}</p>}
        {configs === null ? <Spinner /> : (
          <div className="flex flex-col gap-4">
            {configs.map((config) => (
              <TargetSettingRow
                key={config.targetSystem}
                config={config}
                modes={modes}
                canConfigure={canConfigure}
                onSaved={() => { void load(); onChanged(); }}
              />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function TargetSettingRow({
  config, modes, canConfigure, onSaved,
}: {
  config: AdjustmentTargetConfig;
  modes: Array<{ code: string; displayLabel: string }>;
  canConfigure: boolean;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState(config.fulfilmentModeCode);
  const [owner, setOwner] = useState(config.ownerDescription ?? '');
  const [hours, setHours] = useState(String(config.alertAfterHours));
  const [email, setEmail] = useState(config.notifyEmail ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const label = TARGET_LABELS[config.targetSystem] ?? config.targetSystem;
  const id = `target-${config.targetSystem}`;

  async function save(e: FormEvent) {
    e.preventDefault();
    const alertAfterHours = Number(hours);
    if (!Number.isInteger(alertAfterHours) || alertAfterHours < 1) {
      setError('Overdue after must be a whole number of hours, at least 1.');
      return;
    }
    setSaving(true); setError('');
    try {
      await setAdjustmentTarget(config.targetSystem, {
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
      <div className="font-medium text-neutral-800">
        {label}
        {config.isDefault && <span className="ml-2 text-xs text-neutral-500">(default)</span>}
      </div>
      <LabelledField label={`${label} fulfilment`} htmlFor={`${id}-mode`}>
        <Select id={`${id}-mode`} value={mode} disabled={!canConfigure} onChange={(e) => setMode(e.target.value)}>
          {modes.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
        </Select>
      </LabelledField>
      <LabelledField label={`${label} owner`} htmlFor={`${id}-owner`}>
        <Input id={`${id}-owner`} value={owner} disabled={!canConfigure} placeholder="e.g. Attendance team" onChange={(e) => setOwner(e.target.value)} />
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
