import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PageHeader, Card, CardHeader, CardBody, Button, Select, Textarea, LabelledField, Badge, StatCard,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, Spinner,
} from '@revelation-srs/ui';

import {
  type EarlyWarningAlert, type MentalHealthCase, type WellbeingSummary,
  getWellbeingSummary, listAlertQueue, listMentalHealthCasesForPerson, raiseConcern, triageAlert,
} from '../api/wellbeingCases.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import {
  PersonCell, StudentPicker, errorText, formatDate, labelFor, usePersonNames, useWellbeingCodes,
} from './WellbeingShared.js';

/** Wellbeing overview: counts, and the early-warning triage queue. */
export function WellbeingPage() {
  const { roles } = useAuth();
  const canTriage = userHasAnyPermission(roles, ['early-warning:triage']);
  const canReadDisability = userHasAnyPermission(roles, ['disability:read']);
  const canReadMh = userHasAnyPermission(roles, ['mental-health-case:read']);
  const canReadAlerts = userHasAnyPermission(roles, ['early-warning:read']);

  const [summary, setSummary] = useState<WellbeingSummary | null>(null);
  const [queue, setQueue] = useState<'pending' | 'open'>('pending');
  const [alerts, setAlerts] = useState<EarlyWarningAlert[] | null>(null);
  const [error, setError] = useState('');
  const [showRaise, setShowRaise] = useState(false);

  const alertTypes = useWellbeingCodes('early_warning_alert', 'alert_type_code');
  const alertSources = useWellbeingCodes('early_warning_alert', 'alert_source_code');
  const triageStatuses = useWellbeingCodes('early_warning_alert', 'triage_status_code');
  const names = usePersonNames((alerts ?? []).map((a) => a.personId));

  const load = useCallback(async () => {
    if (!canReadAlerts) return;
    setError('');
    try {
      const [s, q] = await Promise.all([getWellbeingSummary(), listAlertQueue(queue)]);
      setSummary(s);
      setAlerts(q.items);
    } catch (err) {
      setError(errorText(err, 'Failed to load wellbeing overview'));
    }
  }, [queue, canReadAlerts]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <PageHeader
        title="Wellbeing"
        description="Early-warning concerns waiting for triage, and the wellbeing caseloads. Case detail stays in the wellbeing service; the student record only ever sees approved adjustments."
        actions={canTriage ? <Button size="sm" onClick={() => setShowRaise((v) => !v)}>{showRaise ? 'Cancel' : 'Raise a concern'}</Button> : undefined}
      />

      <nav aria-label="Wellbeing caseloads" className="mt-4 flex flex-wrap gap-4 text-sm">
        {canReadDisability && <Link className="text-primary-600 hover:underline" to="/wellbeing/disability-cases">Disability support cases</Link>}
        {canReadMh && <Link className="text-primary-600 hover:underline" to="/wellbeing/mental-health-cases">Mental health cases</Link>}
        {userHasAnyPermission(roles, ['adjustment-case:read:all']) && <Link className="text-primary-600 hover:underline" to="/governance/adjustment-cases">Adjustment cases</Link>}
      </nav>

      {showRaise && (
        <div className="mt-4">
          <RaiseConcernForm alertTypes={alertTypes} onRaised={() => { setShowRaise(false); setQueue('pending'); void load(); }} />
        </div>
      )}

      {canReadAlerts && summary && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Concerns awaiting triage" value={summary.pendingAlerts} />
          <StatCard label="Open mental health cases" value={summary.openMentalHealthCases} />
          <StatCard label="Active intervention plans" value={summary.activeInterventionPlans} />
        </div>
      )}

      {canReadAlerts && (
        <Card className="mt-6">
          <CardHeader
            title="Early-warning concerns"
            description="UKVI compliance alerts arrive from the student record; tutors' and staff concerns are raised here. Assign a concern to the student's mental health case, or resolve or dismiss it."
            actions={
              <div className="flex items-center gap-2">
                <label htmlFor="alert-queue" className="text-sm text-neutral-500">Show:</label>
                <Select id="alert-queue" value={queue} onChange={(e) => setQueue(e.target.value as 'pending' | 'open')} className="w-auto">
                  <option value="pending">Awaiting triage</option>
                  <option value="open">All open</option>
                </Select>
              </div>
            }
          />
          <CardBody>
            {error ? <p className="text-sm text-danger-600">{error}</p>
              : alerts === null ? <div className="flex justify-center py-8"><Spinner /></div>
              : alerts.length === 0 ? <p className="text-sm text-neutral-600">No concerns in this queue.</p>
              : (
                <Table>
                  <TableHead>
                    <tr>
                      <TableHeaderCell>Student</TableHeaderCell>
                      <TableHeaderCell>Concern</TableHeaderCell>
                      <TableHeaderCell>Received</TableHeaderCell>
                      <TableHeaderCell>Triage</TableHeaderCell>
                      {canTriage && <TableHeaderCell><span className="sr-only">Action</span></TableHeaderCell>}
                    </tr>
                  </TableHead>
                  <TableBody>
                    {alerts.map((a) => (
                      <AlertRow key={a.id} alert={a} names={names} canTriage={canTriage}
                        alertTypes={alertTypes} alertSources={alertSources} triageStatuses={triageStatuses} onChanged={() => void load()} />
                    ))}
                  </TableBody>
                </Table>
              )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

type Members = Array<{ code: string; displayLabel: string }>;

function AlertRow({ alert, names, canTriage, alertTypes, alertSources, triageStatuses, onChanged }: {
  alert: EarlyWarningAlert; names: Record<string, string>; canTriage: boolean;
  alertTypes: Members; alertSources: Members; triageStatuses: Members; onChanged: () => void;
}) {
  const [next, setNext] = useState(alert.allowedNextStatuses[0] ?? '');
  const [cases, setCases] = useState<MentalHealthCase[] | null>(null);
  const [caseId, setCaseId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const summary = typeof alert.alertPayload['summary'] === 'string' ? alert.alertPayload['summary'] : null;

  useEffect(() => {
    if (next !== 'assigned' || cases !== null) return;
    listMentalHealthCasesForPerson(alert.personId)
      .then((r) => { const open = r.items.filter((c) => c.statusCode !== 'closed'); setCases(open); setCaseId(open[0]?.id ?? ''); })
      .catch((err) => setError(errorText(err, 'Could not load the student\'s cases')));
  }, [next, cases, alert.personId]);

  async function apply() {
    setBusy(true); setError('');
    try {
      await triageAlert(alert.id, next, next === 'assigned' ? caseId : undefined);
      onChanged();
    } catch (err) {
      setError(errorText(err, 'Triage failed'));
    } finally {
      setBusy(false);
    }
  }

  const selectId = `triage-${alert.id}`;
  return (
    <TableRow>
      <TableCell><PersonCell personId={alert.personId} names={names} /></TableCell>
      <TableCell>
        <div>{labelFor(alertTypes, alert.alertTypeCode)}</div>
        <div className="text-xs text-neutral-500">{labelFor(alertSources, alert.alertSourceCode)}{summary ? ` — ${summary}` : ''}</div>
      </TableCell>
      <TableCell className="text-xs text-neutral-600">{formatDate(alert.receivedAt)}</TableCell>
      <TableCell>
        <Badge value={alert.triageStatusCode} label={labelFor(triageStatuses, alert.triageStatusCode)} />
        {alert.assignedCaseId && (
          <div className="mt-1 text-xs"><Link className="text-primary-600 hover:underline" to={`/wellbeing/mental-health-cases/${alert.assignedCaseId}`}>Open case</Link></div>
        )}
      </TableCell>
      {canTriage && (
        <TableCell>
          {alert.allowedNextStatuses.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={selectId} className="sr-only">Triage outcome for this concern</label>
              <Select id={selectId} value={next} onChange={(e) => setNext(e.target.value)} className="w-auto">
                {alert.allowedNextStatuses.map((s) => <option key={s} value={s}>{labelFor(triageStatuses, s)}</option>)}
              </Select>
              {next === 'assigned' && cases !== null && (cases.length > 0 ? (
                <>
                  <label htmlFor={`${selectId}-case`} className="sr-only">Mental health case</label>
                  <Select id={`${selectId}-case`} value={caseId} onChange={(e) => setCaseId(e.target.value)} className="w-auto">
                    {cases.map((c) => <option key={c.id} value={c.id}>Case opened {formatDate(c.validFrom)}</option>)}
                  </Select>
                </>
              ) : (
                <Link className="text-xs text-primary-600 hover:underline" to={`/wellbeing/mental-health-cases?personId=${alert.personId}`}>
                  No open case — open one first
                </Link>
              ))}
              <Button size="sm" onClick={() => void apply()} disabled={busy || !next || (next === 'assigned' && !caseId)}>
                {busy ? 'Saving…' : 'Apply'}
              </Button>
            </div>
          )}
          {error && <p className="mt-1 text-xs text-danger-600">{error}</p>}
        </TableCell>
      )}
    </TableRow>
  );
}

function RaiseConcernForm({ alertTypes, onRaised }: { alertTypes: Members; onRaised: () => void }) {
  const raisable = alertTypes.filter((m) => m.code === 'staff-referral' || m.code === 'tutor-concern');
  const [personId, setPersonId] = useState('');
  const [alertTypeCode, setAlertTypeCode] = useState('staff-referral');
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await raiseConcern({ personId, alertTypeCode, summary: summary.trim() });
      onRaised();
    } catch (err) {
      setError(errorText(err, 'Could not raise the concern'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Raise a concern" description="A short, factual description of what was seen. Clinical detail belongs in a case, not here." />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <form onSubmit={(e) => void submit(e)} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <LabelledField label="Student" htmlFor="concern-student" required>
            <StudentPicker id="concern-student" value={personId} onChange={(id) => setPersonId(id)} />
          </LabelledField>
          <LabelledField label="Kind of concern" htmlFor="concern-type">
            <Select id="concern-type" value={alertTypeCode} onChange={(e) => setAlertTypeCode(e.target.value)}>
              {raisable.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
            </Select>
          </LabelledField>
          <div className="md:col-span-2">
            <LabelledField label="What was seen" htmlFor="concern-summary" required>
              <Textarea id="concern-summary" rows={3} maxLength={500} value={summary} onChange={(e) => setSummary(e.target.value)} />
            </LabelledField>
          </div>
          <div className="md:col-span-2">
            <Button type="submit" disabled={busy || !personId || !summary.trim()}>{busy ? 'Raising…' : 'Raise concern'}</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
