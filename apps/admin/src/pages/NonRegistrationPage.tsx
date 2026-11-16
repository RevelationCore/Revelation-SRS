import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, Card, CardHeader, CardBody, Button, Input, Select, Textarea, LabelledField, Badge, Spinner, StatusNotice } from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import {
  type NonRegistrationCase,
  decideNonRegistration, listNonRegistrationCases, recordNonRegistrationContact, recordWrittenNonContinuation, referNonRegistrationCase,
} from '../api/registrationPeriods.js';
import { type StatusCase, listEnrolmentStatusCases } from '../api/statusCases.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { useValueSet } from '../hooks/useValueSet.js';

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB');
function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? (err.detail ?? err.message) : fallback;
}

const FLAG_LABELS: Record<NonRegistrationCase['flags'][number], string> = {
  'results-pending': 'Last year\'s results not ratified',
  'open-status-request': 'Has an open status request',
  'approved-interruption': 'Has an approved interruption',
  sponsored: 'Student visa sponsored',
};
const OUTCOME_LABELS: Record<string, string> = { 'registered-late': 'Registered late', referred: 'Referred to the student\'s own request', 'non-registration': 'Non-registration decided' };

/**
 * Students who did not register (BP-02-011; D-9). Each lapsed registration is
 * a case: record each attempt to reach the student, then resolve it by a late
 * registration (from the Registration page), a referral to the student's own
 * interruption or withdrawal request, or a non-registration decision, which
 * opens a withdrawal case for someone else to decide.
 */
export function NonRegistrationPage() {
  const { roles } = useAuth();
  const canManage = userHasAnyPermission(roles, ['non-registration:manage']);
  const [cases, setCases] = useState<NonRegistrationCase[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setCases(await listNonRegistrationCases(!showAll)); } catch (err) { setError(message(err, 'Failed to load cases')); }
  }, [showAll]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Registration', to: '/registration' }]}
        title="Students who did not register"
        description="Cases opened when a registration period closed. Contact each student before deciding; a non-registration decision opens a withdrawal for another person to approve."
        actions={<Button size="sm" variant="secondary" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show open cases only' : 'Show resolved cases too'}</Button>}
      />
      <div className="mt-6 flex flex-col gap-4">
        {error ? <p className="text-sm text-danger-600" role="alert">{error}</p>
          : !cases ? <div className="flex justify-center py-16"><Spinner /></div>
            : cases.length === 0 ? <p className="text-sm text-neutral-600">No students are waiting to be followed up.</p>
              : cases.map((c) => <CaseCard key={c.caseId} item={c} canManage={canManage} onChanged={() => void load()} />)}
      </div>
    </div>
  );
}

function CaseCard({ item, canManage, onChanged }: { item: NonRegistrationCase; canManage: boolean; onChanged: () => void }) {
  const [error, setError] = useState('');
  const name = item.subject?.studentName ?? item.enrolmentId;
  const open = item.statusCode === 'open' || item.statusCode === 'under-review';
  const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setError('');
    try { await fn(); onChanged(); return true; } catch (err) { setError(message(err, 'The action failed')); return false; }
  };

  return (
    <Card>
      <CardHeader
        title={item.subject?.personId ? <Link to={`/students/${item.subject.personId}`} className="text-primary-600 hover:underline">{name}</Link> : name}
        description={`${[item.subject?.studentNumber, item.subject?.programmeCode].filter(Boolean).join(' · ')} · did not register for ${item.academicYear} (closed ${day(item.periodClosesAt)})`}
        actions={<Badge value={open ? 'pending' : 'approved'} label={open ? (item.statusCode === 'under-review' ? 'Needs review' : 'Open') : (item.outcome ? OUTCOME_LABELS[item.outcome.outcomeCode] ?? item.outcome.outcomeCode : 'Closed')} />}
      />
      <CardBody>
        <div className="flex flex-col gap-4">
          {error && <p className="text-sm text-danger-600" role="alert">{error}</p>}
          {item.ukviReportDueBy && <StatusNotice>Sponsored student: UKVI must be told by {day(item.ukviReportDueBy)} (10 working days after the period ended). A compliance alert has been raised.</StatusNotice>}
          {item.flags.filter((f) => f !== 'sponsored').length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label={`Review points for ${name}`}>
              {item.flags.filter((f) => f !== 'sponsored').map((f) => <li key={f}><Badge value="pending" label={FLAG_LABELS[f]} /></li>)}
            </ul>
          )}
          <div>
            <h3 className="text-sm font-medium text-neutral-800">Contact attempts</h3>
            {item.contactAttempts.length === 0 ? <p className="text-sm text-neutral-600">None yet.</p> : (
              <ul className="mt-1 text-sm text-neutral-700">
                {item.contactAttempts.map((a) => <li key={a.evidenceId}>{day(a.contactedAt)} · {a.channelCode} · {a.reference.startsWith('notification:') ? 'portal notification sent' : a.reference}</li>)}
              </ul>
            )}
            {item.writtenNonContinuation && <p className="mt-1 text-sm text-neutral-700">The student confirmed in writing they will not continue ({item.writtenNonContinuation.reference}).</p>}
            {open && item.decisionAllowedFrom && !item.writtenNonContinuation && <p className="mt-1 text-xs text-neutral-500">A non-registration decision is possible from {day(item.decisionAllowedFrom)}, once enough contact attempts are recorded.</p>}
          </div>
          {item.outcome && (
            <p className="text-sm text-neutral-700">
              {OUTCOME_LABELS[item.outcome.outcomeCode]} on {day(item.outcome.decidedAt)}
              {item.outcome.outcomeCode === 'non-registration' && <> · effective {day(item.outcome.effectiveAt)} · {item.outcome.policyVersion}</>}
              {item.outcome.statusCaseId && <> · <Link to={`/status-cases/${item.outcome.statusCaseId}`} className="text-primary-600 hover:underline">withdrawal case</Link></>}
            </p>
          )}
          {open && canManage && <CaseActions item={item} name={name} run={run} />}
        </div>
      </CardBody>
    </Card>
  );
}

type Action = 'contact' | 'written' | 'refer' | 'decide' | null;

function CaseActions({ item, name, run }: { item: NonRegistrationCase; name: string; run: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const [action, setAction] = useState<Action>(null);
  const id = item.caseId;
  const done = (ok: boolean) => { if (ok) setAction(null); };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={action === 'contact' ? 'primary' : 'secondary'} onClick={() => setAction(action === 'contact' ? null : 'contact')}>Record contact<span className="sr-only"> with {name}</span></Button>
        <Button size="sm" variant={action === 'written' ? 'primary' : 'secondary'} onClick={() => setAction(action === 'written' ? null : 'written')}>Student will not continue<span className="sr-only"> ({name})</span></Button>
        <Button size="sm" variant={action === 'refer' ? 'primary' : 'secondary'} onClick={() => setAction(action === 'refer' ? null : 'refer')}>Refer to their request<span className="sr-only"> ({name})</span></Button>
        <Button size="sm" variant={action === 'decide' ? 'primary' : 'secondary'} onClick={() => setAction(action === 'decide' ? null : 'decide')}>Decide non-registration<span className="sr-only"> ({name})</span></Button>
      </div>
      {action === 'contact' && <ContactForm id={id} onSubmit={(body) => run(() => recordNonRegistrationContact(id, body)).then(done)} />}
      {action === 'written' && <ReferenceForm id={id} label="Reference to the student's written statement" submit="Record statement" onSubmit={(ref) => run(() => recordWrittenNonContinuation(id, ref)).then(done)} />}
      {action === 'refer' && <ReferForm item={item} onSubmit={(statusCaseId) => run(() => referNonRegistrationCase(id, statusCaseId)).then(done)} />}
      {action === 'decide' && <DecideForm item={item} onSubmit={(body) => run(() => decideNonRegistration(id, body)).then(done)} />}
    </div>
  );
}

function ContactForm({ id, onSubmit }: { id: string; onSubmit: (body: { channelCode: string; reference?: string }) => Promise<void> }) {
  const { members } = useValueSet('non_registration_case', 'contact_channel_code');
  const [channel, setChannel] = useState('');
  const [reference, setReference] = useState('');
  const portal = channel === 'portal';
  function submit(e: FormEvent) { e.preventDefault(); void onSubmit({ channelCode: channel, ...(portal ? {} : { reference: reference.trim() }) }); }
  return (
    <form className="grid grid-cols-1 gap-3 items-end md:grid-cols-3" onSubmit={submit}>
      <LabelledField label="How" htmlFor={`nr-${id}-channel`} required>
        <Select id={`nr-${id}-channel`} value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="">Choose…</option>
          {members.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
        </Select>
      </LabelledField>
      {!portal && <LabelledField label="Reference" htmlFor={`nr-${id}-ref`} required hint="Email ID, letter reference or call note"><Input id={`nr-${id}-ref`} value={reference} onChange={(e) => setReference(e.target.value)} /></LabelledField>}
      <Button type="submit" disabled={!channel || (!portal && !reference.trim())}>{portal ? 'Send portal notice' : 'Record contact'}</Button>
    </form>
  );
}

function ReferenceForm({ id, label, submit, onSubmit }: { id: string; label: string; submit: string; onSubmit: (reference: string) => Promise<void> }) {
  const [reference, setReference] = useState('');
  return (
    <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void onSubmit(reference.trim()); }}>
      <LabelledField label={label} htmlFor={`nr-${id}-written`} required><Input id={`nr-${id}-written`} value={reference} onChange={(e) => setReference(e.target.value)} /></LabelledField>
      <Button type="submit" disabled={!reference.trim()}>{submit}</Button>
    </form>
  );
}

function ReferForm({ item, onSubmit }: { item: NonRegistrationCase; onSubmit: (statusCaseId: string) => Promise<void> }) {
  const [requests, setRequests] = useState<StatusCase[] | null>(null);
  const [chosen, setChosen] = useState('');
  useEffect(() => {
    listEnrolmentStatusCases(item.enrolmentId)
      .then((all) => setRequests(all.filter((c) => c.initiatedByCode === 'student' && ['interruption', 'withdrawal'].includes(c.caseTypeCode))))
      .catch(() => setRequests([]));
  }, [item.enrolmentId]);
  if (!requests) return <Spinner />;
  if (requests.length === 0) return <p className="text-sm text-neutral-600">The student has no interruption or withdrawal request of their own to refer to.</p>;
  return (
    <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void onSubmit(chosen); }}>
      <LabelledField label="The student's request" htmlFor={`nr-${item.caseId}-refer`} required>
        <Select id={`nr-${item.caseId}-refer`} value={chosen} onChange={(e) => setChosen(e.target.value)}>
          <option value="">Choose…</option>
          {requests.map((r) => <option key={r.statusCaseId} value={r.statusCaseId}>{r.caseTypeCode} from {r.requestedEffectiveDate} ({r.statusCode})</option>)}
        </Select>
      </LabelledField>
      <Button type="submit" disabled={!chosen}>Refer</Button>
    </form>
  );
}

function DecideForm({ item, onSubmit }: { item: NonRegistrationCase; onSubmit: (body: { reason: string; policyVersion: string; effectiveDate?: string; lastEngagementDate?: string }) => Promise<void> }) {
  const [form, setForm] = useState({ reason: '', policyVersion: '', effectiveDate: item.periodClosesAt.slice(0, 10), lastEngagementDate: '' });
  const id = item.caseId;
  function submit(e: FormEvent) {
    e.preventDefault();
    void onSubmit({
      reason: form.reason.trim(), policyVersion: form.policyVersion.trim(),
      ...(form.effectiveDate ? { effectiveDate: form.effectiveDate } : {}), ...(form.lastEngagementDate ? { lastEngagementDate: form.lastEngagementDate } : {}),
    });
  }
  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      <p className="text-sm text-neutral-600">This opens a withdrawal case. Another person must approve it before the student is withdrawn.</p>
      <LabelledField label="Reason" htmlFor={`nr-${id}-reason`} required><Textarea id={`nr-${id}-reason`} rows={2} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} /></LabelledField>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <LabelledField label="Regulations applied" htmlFor={`nr-${id}-policy`} required hint="Version of the general regulations"><Input id={`nr-${id}-policy`} value={form.policyVersion} onChange={(e) => setForm((f) => ({ ...f, policyVersion: e.target.value }))} /></LabelledField>
        <LabelledField label="Effective date" htmlFor={`nr-${id}-effective`} hint="Defaults to the period's close"><Input id={`nr-${id}-effective`} type="date" value={form.effectiveDate} onChange={(e) => setForm((f) => ({ ...f, effectiveDate: e.target.value }))} /></LabelledField>
        <LabelledField label="Last engagement" htmlFor={`nr-${id}-engagement`} hint="From attendance records; the effective date cannot be earlier"><Input id={`nr-${id}-engagement`} type="date" value={form.lastEngagementDate} onChange={(e) => setForm((f) => ({ ...f, lastEngagementDate: e.target.value }))} /></LabelledField>
      </div>
      <div><Button type="submit" disabled={!form.reason.trim() || !form.policyVersion.trim()}>Decide non-registration</Button></div>
    </form>
  );
}
