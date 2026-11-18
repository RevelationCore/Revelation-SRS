import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  PageHeader, Card, CardHeader, CardBody, Button, Input, Select, LabelledField, Badge, Spinner, StatusNotice, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, CodeBadge, CodeSelect, useCodes,
} from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import { type ProgrammeSummary, listProgrammes } from '../api/applications.js';
import {
  type RegistrationConfirmation, type RegistrationPeriod,
  closeRegistrationPeriod, confirmRegistrationAssisted, getRegistrationPeriod, listRegistrationConfirmations, listRegistrationPeriods,
  openRegistrationPeriod, refreshRegistrationPeriod,
} from '../api/registrationPeriods.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { useValueSet } from '../hooks/useValueSet.js';

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? (err.detail ?? err.message) : fallback;
}
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB');

/**
 * Registration periods (BP-02-010; D-8): open a period for a year, follow
 * who has registered, register a student on their behalf, and close the
 * period once it ends, which lapses everyone still unregistered.
 */
export function RegistrationPeriodsPage() {
  const { roles } = useAuth();
  const canManage = userHasAnyPermission(roles, ['registration-period:manage']);
  const [periods, setPeriods] = useState<RegistrationPeriod[] | null>(null);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);

  const load = useCallback(async () => {
    try { setPeriods(await listRegistrationPeriods()); } catch (err) { setError(message(err, 'Failed to load registration periods')); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const terms = periods?.[0]?.termsVersion ?? null;

  return (
    <div>
      <PageHeader
        title="Registration"
        description="Annual re-registration of continuing students. Students confirm in the portal by accepting the current terms; the registry can register a student on their behalf."
        actions={
          <div className="flex gap-2">
            <Link to="/registration/checks" className="inline-flex items-center rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50">Registration checks</Link>
            <Link to="/registration/non-registration" className="inline-flex items-center rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50">Students who did not register</Link>
            {canManage && <Button size="sm" onClick={() => setOpening((v) => !v)}>{opening ? 'Cancel' : 'Open a period'}</Button>}
          </div>
        }
      />
      {periods && !terms && <div className="mt-4"><StatusNotice>No registration terms version is set. A tenant administrator must set registrationTermsVersion in tenant configuration before a period can open.</StatusNotice></div>}
      {opening && <div className="mt-4"><OpenPeriodForm onOpened={() => { setOpening(false); void load(); }} /></div>}
      <div className="mt-6">
        {error ? <p className="text-sm text-danger-600" role="alert">{error}</p>
          : !periods ? <div className="flex justify-center py-16"><Spinner /></div>
            : periods.length === 0 ? <p className="text-sm text-neutral-600">No registration periods yet.</p>
              : (
                <Card>
                  <Table>
                    <TableHead><tr><TableHeaderCell>Year</TableHeaderCell><TableHeaderCell>Open</TableHeaderCell><TableHeaderCell>Registered</TableHeaderCell><TableHeaderCell>Outstanding</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell><TableHeaderCell><span className="sr-only">Open</span></TableHeaderCell></tr></TableHead>
                    <TableBody>
                      {periods.map((p) => (
                        <TableRow key={p.periodId}>
                          <TableCell>{p.academicYear}<div className="text-xs text-neutral-500">{p.periodTypeCode === 'initial' ? 'New entrants' : 'Continuing students'}</div></TableCell>
                          <TableCell className="text-sm">{day(p.opensAt)} – {day(p.closesAt)}</TableCell>
                          <TableCell>{p.counts.confirmed}</TableCell>
                          <TableCell>{p.counts.pending}{p.counts.lapsed ? <div className="text-xs text-neutral-500"><Link to="/registration/non-registration" className="hover:underline">{p.counts.lapsed} lapsed</Link></div> : null}</TableCell>
                          <TableCell><Badge value={p.closedAt ? 'ratified' : 'pending'} label={p.closedAt ? 'Closed' : 'Open'} /></TableCell>
                          <TableCell className="text-right"><Link to={`/registration/${p.periodId}`} className="text-sm text-primary-600 hover:underline">View<span className="sr-only"> {p.academicYear} registration</span></Link></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              )}
      </div>
    </div>
  );
}

function OpenPeriodForm({ onOpened }: { onOpened: () => void }) {
  const [programmes, setProgrammes] = useState<ProgrammeSummary[]>([]);
  const [form, setForm] = useState({ academicYear: '', programmeId: '', opensAt: '', closesAt: '' });
  const [error, setError] = useState('');
  useEffect(() => { listProgrammes().then(setProgrammes).catch(() => undefined); }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await openRegistrationPeriod({
        academicYear: form.academicYear.trim(), opensAt: new Date(form.opensAt).toISOString(), closesAt: new Date(form.closesAt).toISOString(),
        ...(form.programmeId ? { programmeId: form.programmeId } : {}),
      });
      onOpened();
    } catch (err) { setError(message(err, 'Failed to open the period')); }
  }
  return (
    <Card>
      <CardHeader title="Open a registration period" description="Every continuing enrolled student on the chosen programme (or all programmes) is asked to register." />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600" role="alert">{error}</p>}
        <form className="grid grid-cols-1 gap-3 items-end md:grid-cols-5" onSubmit={(e) => void submit(e)}>
          <LabelledField label="Academic year" htmlFor="rp-year" required hint="e.g. 2027-28"><Input id="rp-year" value={form.academicYear} onChange={(e) => setForm((f) => ({ ...f, academicYear: e.target.value }))} /></LabelledField>
          <LabelledField label="Programme" htmlFor="rp-programme">
            <Select id="rp-programme" value={form.programmeId} onChange={(e) => setForm((f) => ({ ...f, programmeId: e.target.value }))}>
              <option value="">All programmes</option>
              {programmes.map((p) => <option key={p.programmeId} value={p.programmeId}>{p.code} — {p.title}</option>)}
            </Select>
          </LabelledField>
          <LabelledField label="Opens" htmlFor="rp-opens" required><Input id="rp-opens" type="datetime-local" value={form.opensAt} onChange={(e) => setForm((f) => ({ ...f, opensAt: e.target.value }))} /></LabelledField>
          <LabelledField label="Closes" htmlFor="rp-closes" required><Input id="rp-closes" type="datetime-local" value={form.closesAt} onChange={(e) => setForm((f) => ({ ...f, closesAt: e.target.value }))} /></LabelledField>
          <Button type="submit" disabled={!/^\d{4}-\d{2}$/.test(form.academicYear.trim()) || !form.opensAt || !form.closesAt}>Open period</Button>
        </form>
      </CardBody>
    </Card>
  );
}

export function RegistrationPeriodDetailPage() {
  const assistedReasons = useCodes('reenrolment_confirmation', 'assisted_reason_code');
  const { periodId } = useParams<{ periodId: string }>();
  const { roles } = useAuth();
  const canManage = userHasAnyPermission(roles, ['registration-period:manage']);
  const canAssist = userHasAnyPermission(roles, ['registration:confirm:assisted']);
  const canOpenRecord = userHasAnyPermission(roles, ['student:read:all']);
  const [period, setPeriod] = useState<RegistrationPeriod | null>(null);
  const [rows, setRows] = useState<RegistrationConfirmation[]>([]);
  const [status, setStatus] = useState('pending');
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!periodId) return;
    try {
      const [p, c] = await Promise.all([getRegistrationPeriod(periodId), listRegistrationConfirmations(periodId, status || undefined)]);
      setPeriod(p); setRows(c);
    } catch (err) { setError(message(err, 'Failed to load the period')); }
  }, [periodId, status]);
  useEffect(() => { void load(); }, [load]);

  const act = useCallback(async (run: () => Promise<string | void>): Promise<boolean> => {
    setActionError(''); setNotice('');
    try { const note = await run(); if (note) setNotice(note); await load(); return true; } catch (err) { setActionError(message(err, 'The action failed')); return false; }
  }, [load]);

  if (error) return <p className="text-sm text-danger-600" role="alert">{error}</p>;
  if (!period) return <div className="flex justify-center py-16"><Spinner /></div>;
  const ended = new Date() >= new Date(period.closesAt);

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Registration', to: '/registration' }]}
        title={`Registration ${period.academicYear}`}
        description={`${period.periodTypeCode === 'initial' ? 'New entrants' : 'Continuing students'} · ${day(period.opensAt)} – ${day(period.closesAt)} · terms version ${period.termsVersion ?? 'not set'}`}
        actions={canManage && !period.closedAt && (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => void act(async () => `${(await refreshRegistrationPeriod(period.periodId)).added} students added.`)}>Add newly eligible students</Button>
            <Button size="sm" disabled={!ended} onClick={() => void act(async () => `${(await closeRegistrationPeriod(period.periodId)).lapsedCount} registrations lapsed.`)}>Close period</Button>
          </div>
        )}
      />
      {actionError && <p className="mb-4 text-sm text-danger-600" role="alert">{actionError}</p>}
      {notice && <p className="mb-4 text-sm text-success-700" role="status">{notice}</p>}
      <p className="mb-4 text-sm text-neutral-700">{period.counts.confirmed} registered · {period.counts.pending} not yet registered · {period.counts.lapsed} lapsed{period.closedAt ? ` · closed ${day(period.closedAt)}` : !ended ? ' · can be closed once it ends' : ''}</p>
      <Card>
        <CardHeader title="Students" actions={
          <div className="flex items-center gap-2">
            <label htmlFor="rp-status" className="text-sm text-neutral-500">Show:</label>
            <CodeSelect entity="reenrolment_confirmation" field="status_code" id="rp-status" value={status} onChange={setStatus} className="w-auto" emptyLabel="Everyone" />
          </div>
        } />
        {rows.length === 0 ? <p className="px-6 pb-6 text-sm text-neutral-600">No students.</p> : (
          <Table>
            <TableHead><tr><TableHeaderCell>Student</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell><TableHeaderCell>Registered</TableHeaderCell><TableHeaderCell><span className="sr-only">Register</span></TableHeaderCell></tr></TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.confirmationId}>
                  <TableCell>
                    {canOpenRecord && r.subject?.personId ? <Link to={`/students/${r.subject.personId}`} className="text-primary-600 hover:underline">{r.subject.studentName}</Link> : r.subject?.studentName ?? r.enrolmentId}
                    <div className="text-xs text-neutral-500">{[r.subject?.studentNumber, r.subject?.programmeCode].filter(Boolean).join(' · ')}</div>
                  </TableCell>
                  <TableCell><CodeBadge entity="reenrolment_confirmation" field="status_code" code={r.statusCode} /></TableCell>
                  <TableCell className="text-xs">{r.confirmedAt ? `${day(r.confirmedAt)} (${r.channelCode === 'assisted' ? `by registry: ${assistedReasons.label(r.assistedReasonCode)}` : 'student'})` : '—'}</TableCell>
                  <TableCell className="text-right">
                    {canAssist && period.termsVersion && r.statusCode !== 'confirmed' && (
                      <AssistControl row={r} lapsed={r.statusCode === 'lapsed'} onConfirm={(reason) => act(async () => { await confirmRegistrationAssisted(r.confirmationId, period.termsVersion!, reason); })} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function AssistControl({ row, lapsed, onConfirm }: { row: RegistrationConfirmation; lapsed: boolean; onConfirm: (reason: string) => Promise<boolean> }) {
  const { members: reasons } = useValueSet('reenrolment_confirmation', 'assisted_reason_code');
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(lapsed ? 'late' : '');
  const id = `assist-${row.confirmationId}`;
  const name = row.subject?.studentName ?? 'student';
  if (!open) return <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Register on their behalf<span className="sr-only"> ({name})</span></Button>;
  return (
    <div className="inline-flex items-end gap-2">
      <LabelledField label={`Reason for ${name}`} htmlFor={id}>
        <Select id={id} value={reason} onChange={(e) => setReason(e.target.value)} disabled={lapsed}>
          <option value="">Choose…</option>
          {reasons.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
        </Select>
      </LabelledField>
      <Button size="sm" disabled={!reason} onClick={() => void onConfirm(reason).then((ok) => { if (ok) setOpen(false); })}>Register</Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  );
}
