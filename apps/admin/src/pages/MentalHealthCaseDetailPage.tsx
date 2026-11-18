import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  PageHeader, Card, CardHeader, CardBody, Button, Input, Select, Textarea, LabelledField, Badge, Checkbox,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, Spinner,
} from '@revelation-srs/ui';

import {
  type EarlyWarningAlert, type MentalHealthCaseDetail, type SessionNote,
  addSessionNote, changeMentalHealthCaseStatus, changePlanStatus, changeRiskLevel, createInterventionPlan,
  getMentalHealthCase, listAlertsForPerson, listSessionNotes, recordConsent,
} from '../api/wellbeingCases.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import {
  PersonCell, StatusChanger, errorText, formatDate, labelFor, usePersonNames, useWellbeingCodes,
} from './WellbeingShared.js';

export function MentalHealthCaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const { roles, user } = useAuth();
  const canManage = userHasAnyPermission(roles, ['mental-health-case:manage']);
  const canReadNotes = userHasAnyPermission(roles, ['mh-session-note:read']);
  const canWriteNotes = userHasAnyPermission(roles, ['mh-session-note:write']);
  const canReadAlerts = userHasAnyPermission(roles, ['early-warning:read']);

  const [c, setC] = useState<MentalHealthCaseDetail | null>(null);
  const [alerts, setAlerts] = useState<EarlyWarningAlert[]>([]);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);

  const statuses = useWellbeingCodes('mental_health_case', 'status_code');
  const risks = useWellbeingCodes('mental_health_case', 'risk_level_code');
  const concerns = useWellbeingCodes('mental_health_case', 'presenting_concern_code');
  const planTypes = useWellbeingCodes('intervention_plan', 'plan_type_code');
  const planStatuses = useWellbeingCodes('intervention_plan', 'status_code');
  const frequencies = useWellbeingCodes('intervention_plan', 'session_frequency_code');
  const alertTypes = useWellbeingCodes('early_warning_alert', 'alert_type_code');
  const names = usePersonNames(c ? [c.personId] : []);

  const load = useCallback(async () => {
    if (!caseId) return;
    setError('');
    try {
      const detail = await getMentalHealthCase(caseId);
      setC(detail);
      if (canReadAlerts) {
        const { items } = await listAlertsForPerson(detail.personId);
        setAlerts(items.filter((a) => a.assignedCaseId === caseId));
      }
    } catch (err) {
      setError(errorText(err, 'Failed to load the case'));
    }
  }, [caseId, canReadAlerts]);

  useEffect(() => { void load(); }, [load]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setActionError('');
    try {
      await action();
      await load();
    } catch (err) {
      setActionError(errorText(err, 'The change was not saved'));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="py-8 text-sm text-danger-600">{error}</p>;
  if (!c || !caseId) return <div className="flex justify-center py-20"><Spinner /></div>;

  const isClosed = c.allowedNextStatuses.length === 0;

  return (
    <div>
      <PageHeader
        title="Mental health case"
        description="Special-category data. Every view of this case and its notes is recorded in the wellbeing audit log, and none of it reaches the student record."
      />
      <p className="mt-2 text-sm"><Link to="/wellbeing/mental-health-cases" className="text-primary-600 hover:underline">Back to the caseload</Link></p>

      {actionError && <p role="alert" className="mt-4 text-sm text-danger-600">{actionError}</p>}

      <Card className="mt-4">
        <CardHeader title="Case" />
        <CardBody>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
            <div><dt className="text-neutral-500">Student</dt><dd><PersonCell personId={c.personId} names={names} /></dd></div>
            <div><dt className="text-neutral-500">Status</dt><dd><Badge value={c.statusCode} label={labelFor(statuses, c.statusCode)} /></dd></div>
            <div><dt className="text-neutral-500">Risk level</dt><dd><Badge value={`risk-${c.riskLevelCode}`} label={labelFor(risks, c.riskLevelCode)} /></dd></div>
            <div><dt className="text-neutral-500">Presenting concern</dt><dd>{labelFor(concerns, c.presentingConcernCode)}</dd></div>
            <div><dt className="text-neutral-500">Consent to share</dt><dd>{c.consentGiven ? `Given ${formatDate(c.consentDate)}` : 'Not recorded'}</dd></div>
            <div><dt className="text-neutral-500">Current since</dt><dd>{formatDate(c.validFrom)}</dd></div>
          </dl>
          {canManage && (
            <div className="mt-4 flex flex-wrap items-end gap-6">
              <StatusChanger id="mh-status" allowed={c.allowedNextStatuses} members={statuses} busy={busy}
                onChange={(s) => void run(() => changeMentalHealthCaseStatus(caseId, s))} />
              {!isClosed && (
                <StatusChanger id="mh-risk" label="Change risk level to" allowed={risks.map((r) => r.code).filter((r) => r !== c.riskLevelCode)} members={risks} busy={busy}
                  onChange={(r) => void run(() => changeRiskLevel(caseId, r))} />
              )}
              {!isClosed && !c.consentGiven && <ConsentForm busy={busy} onSubmit={(d) => void run(() => recordConsent(caseId, d))} />}
              {isClosed && <p className="text-sm text-neutral-600">This case is closed and can no longer change.</p>}
            </div>
          )}
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Intervention plans" />
        <CardBody>
          {c.interventionPlans.length === 0 ? <p className="text-sm text-neutral-600">No intervention plans.</p> : (
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Plan</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Practitioner</TableHeaderCell>
                  <TableHeaderCell>Sessions</TableHeaderCell>
                  <TableHeaderCell>Goals</TableHeaderCell>
                  <TableHeaderCell>Review</TableHeaderCell>
                  {canManage && <TableHeaderCell><span className="sr-only">Change status</span></TableHeaderCell>}
                </tr>
              </TableHead>
              <TableBody>
                {c.interventionPlans.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      {labelFor(planTypes, p.planTypeCode)}
                      {p.externalReferral && <div className="text-xs text-neutral-500">External referral{p.externalReferralDetails ? `: ${p.externalReferralDetails}` : ''}</div>}
                    </TableCell>
                    <TableCell><Badge value={p.statusCode} label={labelFor(planStatuses, p.statusCode)} /></TableCell>
                    <TableCell>{p.practitionerId}</TableCell>
                    <TableCell>{[p.plannedSessionCount, p.sessionFrequencyCode ? labelFor(frequencies, p.sessionFrequencyCode) : null].filter(Boolean).join(' · ') || '—'}</TableCell>
                    <TableCell>
                      {(p.goals ?? []).length === 0 ? '—' : (
                        <ul className="list-disc pl-4 text-xs">{(p.goals ?? []).map((g, i) => <li key={i}>{g.goal}{g.targetDate ? ` (by ${formatDate(g.targetDate)})` : ''}</li>)}</ul>
                      )}
                    </TableCell>
                    <TableCell>{formatDate(p.reviewDate)}</TableCell>
                    {canManage && (
                      <TableCell>
                        <StatusChanger id={`plan-${p.id}`} label="Move to" allowed={p.allowedNextStatuses} members={planStatuses} busy={busy}
                          onChange={(s) => void run(() => changePlanStatus(caseId, p.id, s))} />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {canManage && !isClosed && (
            <PlanForm planTypes={planTypes} frequencies={frequencies} busy={busy} practitionerId={user?.sub ?? ''}
              onSubmit={(input) => void run(() => createInterventionPlan(caseId, input))} />
          )}
        </CardBody>
      </Card>

      {canReadNotes && <SessionNotesCard caseId={caseId} canWrite={canWriteNotes && !isClosed} practitionerId={user?.sub ?? ''} />}

      {canReadAlerts && alerts.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Concerns assigned to this case" />
          <CardBody>
            <ul className="space-y-1 text-sm">
              {alerts.map((a) => (
                <li key={a.id}>
                  {labelFor(alertTypes, a.alertTypeCode)} — received {formatDate(a.receivedAt)}
                  {typeof a.alertPayload['summary'] === 'string' ? `: ${a.alertPayload['summary']}` : ''}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

type Members = Array<{ code: string; displayLabel: string }>;

function ConsentForm({ busy, onSubmit }: { busy: boolean; onSubmit: (date: string) => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  return (
    <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); onSubmit(date); }}>
      <LabelledField label="Consent given on" htmlFor="mh-consent">
        <Input id="mh-consent" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </LabelledField>
      <Button size="sm" type="submit" disabled={busy || !date}>Record consent</Button>
    </form>
  );
}

function PlanForm({ planTypes, frequencies, busy, practitionerId, onSubmit }: {
  planTypes: Members; frequencies: Members; busy: boolean; practitionerId: string;
  onSubmit: (input: Parameters<typeof createInterventionPlan>[1]) => void;
}) {
  const [planTypeCode, setPlanType] = useState('');
  const [sessionFrequencyCode, setFrequency] = useState('');
  const [plannedSessionCount, setCount] = useState('');
  const [goals, setGoals] = useState('');
  const [reviewDate, setReviewDate] = useState('');
  const [externalReferral, setExternal] = useState(false);
  const [externalReferralDetails, setExternalDetails] = useState('');
  useEffect(() => { if (!planTypeCode && planTypes[0]) setPlanType(planTypes[0].code); }, [planTypes, planTypeCode]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const goalList = goals.split('\n').map((g) => g.trim()).filter(Boolean).map((goal) => ({ goal }));
    onSubmit({
      planTypeCode, practitionerId,
      ...(sessionFrequencyCode ? { sessionFrequencyCode } : {}),
      ...(plannedSessionCount.trim() ? { plannedSessionCount: plannedSessionCount.trim() } : {}),
      ...(goalList.length > 0 ? { goals: goalList } : {}),
      ...(reviewDate ? { reviewDate } : {}),
      ...(externalReferral ? { externalReferral: true, ...(externalReferralDetails.trim() ? { externalReferralDetails: externalReferralDetails.trim() } : {}) } : {}),
    });
  }

  return (
    <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-3 border-t border-neutral-100 pt-4 md:grid-cols-3">
      <LabelledField label="Plan type" htmlFor="plan-type">
        <Select id="plan-type" value={planTypeCode} onChange={(e) => setPlanType(e.target.value)}>
          {planTypes.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
        </Select>
      </LabelledField>
      <LabelledField label="Session frequency" htmlFor="plan-frequency">
        <Select id="plan-frequency" value={sessionFrequencyCode} onChange={(e) => setFrequency(e.target.value)}>
          <option value="">Not set</option>
          {frequencies.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
        </Select>
      </LabelledField>
      <LabelledField label="Planned sessions" htmlFor="plan-count">
        <Input id="plan-count" value={plannedSessionCount} onChange={(e) => setCount(e.target.value)} />
      </LabelledField>
      <div className="md:col-span-2">
        <LabelledField label="Goals" htmlFor="plan-goals" hint="One per line">
          <Textarea id="plan-goals" rows={3} value={goals} onChange={(e) => setGoals(e.target.value)} />
        </LabelledField>
      </div>
      <LabelledField label="Review date" htmlFor="plan-review">
        <Input id="plan-review" type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} />
      </LabelledField>
      <label htmlFor="plan-external-flag" className="flex items-center gap-2 text-sm text-neutral-700">
        <Checkbox id="plan-external-flag" checked={externalReferral} onChange={(e) => setExternal(e.target.checked)} /> Referred to an external service
      </label>
      {externalReferral && (
        <div className="md:col-span-2">
          <LabelledField label="External service" htmlFor="plan-external">
            <Input id="plan-external" value={externalReferralDetails} onChange={(e) => setExternalDetails(e.target.value)} />
          </LabelledField>
        </div>
      )}
      <div className="md:col-span-3">
        <Button type="submit" size="sm" disabled={busy || !planTypeCode || !practitionerId}>Add intervention plan</Button>
      </div>
    </form>
  );
}

/** Session notes are fetched only when asked for: the module audits each read. */
function SessionNotesCard({ caseId, canWrite, practitionerId }: { caseId: string; canWrite: boolean; practitionerId: string }) {
  const sessionTypes = useWellbeingCodes('mh_session_note', 'session_type_code');
  const [notes, setNotes] = useState<SessionNote[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().slice(0, 10));
  const [sessionTypeCode, setSessionType] = useState('');
  const [content, setContent] = useState('');
  useEffect(() => { if (!sessionTypeCode && sessionTypes[0]) setSessionType(sessionTypes[0].code); }, [sessionTypes, sessionTypeCode]);

  async function show() {
    setError('');
    try {
      setNotes((await listSessionNotes(caseId)).items);
    } catch (err) {
      setError(errorText(err, 'Could not load session notes'));
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await addSessionNote(caseId, { practitionerId, sessionDate, sessionTypeCode, content: content.trim() });
      setContent('');
      await show();
    } catch (err) {
      setError(errorText(err, 'The note was not saved'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader title="Session notes" description="Clinical notes. Opening them is recorded against your name." />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        {notes === null ? (
          <Button size="sm" variant="secondary" onClick={() => void show()}>Show session notes</Button>
        ) : notes.length === 0 ? <p className="text-sm text-neutral-600">No session notes.</p> : (
          <ul className="space-y-3">
            {notes.map((n) => (
              <li key={n.id} className="rounded border border-neutral-200 p-3 text-sm">
                <p className="text-xs text-neutral-500">{formatDate(n.sessionDate)} · {labelFor(sessionTypes, n.sessionTypeCode)} · {n.practitionerId}</p>
                <p className="mt-1 whitespace-pre-wrap">{n.content}</p>
              </li>
            ))}
          </ul>
        )}
        {canWrite && (
          <form onSubmit={(e) => void add(e)} className="mt-4 grid grid-cols-1 gap-3 border-t border-neutral-100 pt-4 md:grid-cols-2">
            <LabelledField label="Session date" htmlFor="note-date">
              <Input id="note-date" type="date" value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} />
            </LabelledField>
            <LabelledField label="Session type" htmlFor="note-type">
              <Select id="note-type" value={sessionTypeCode} onChange={(e) => setSessionType(e.target.value)}>
                {sessionTypes.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
              </Select>
            </LabelledField>
            <div className="md:col-span-2">
              <LabelledField label="Note" htmlFor="note-content" required>
                <Textarea id="note-content" rows={4} value={content} onChange={(e) => setContent(e.target.value)} />
              </LabelledField>
            </div>
            <div className="md:col-span-2">
              <Button type="submit" size="sm" disabled={busy || !content.trim() || !sessionTypeCode}>Add session note</Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
