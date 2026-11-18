import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Card, CardHeader, CardBody, Button, Input, Select, LabelledField, Badge, Spinner, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, CodeBadge, CodeLabel, useCodes,
} from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import {
  type EmploymentLink, type SupportAward, type WorkLimit, type WorkLimitWarning,
  addSupportInstalment, approveSupportAward, approveSupportInstalment, cancelSupportInstalment,
  createSupportAward, listEmploymentLinks, listSupportAwards, listWorkLimits, saveEmploymentLink, setWorkLimit,
} from '../api/support.js';
import { listStudentEnrolments } from '../api/enrolments.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { useValueSet } from '../hooks/useValueSet.js';

const pounds = (p: number) => `£${(p / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? (err.detail ?? err.message) : fallback);

/**
 * Student support (studentships, bursaries) and university employment for
 * one student (AJ-32): separate entitlements with separate authorities.
 * Approving an instalment instructs payroll; it shows as paid only when
 * payroll confirms. Employment is HR's: this holds only what the SRS needs to
 * check visa and funder limits.
 */
export function SupportEmploymentTab({ personId }: { personId: string }) {
  const { roles } = useAuth();
  const [enrolmentIds, setEnrolmentIds] = useState<string[]>([]);
  useEffect(() => {
    listStudentEnrolments(personId).then((e) => setEnrolmentIds(e.map((x) => x.enrolmentId))).catch(() => setEnrolmentIds([]));
  }, [personId]);
  const can = (...p: Parameters<typeof userHasAnyPermission>[1]) => userHasAnyPermission(roles, p);
  return (
    <div className="flex flex-col gap-6">
      {can('support:read') && (
        <SupportSection personId={personId} enrolmentIds={enrolmentIds} canWrite={can('support:write')} canApprove={can('support:approve')} />
      )}
      {can('employment-link:read') && (
        <EmploymentSection personId={personId} canWrite={can('employment-link:write')} canConfigure={can('config:write')} />
      )}
    </div>
  );
}

function SupportSection({ personId, enrolmentIds, canWrite, canApprove }: { personId: string; enrolmentIds: string[]; canWrite: boolean; canApprove: boolean }) {
  const paymentTypes = useCodes('support_instalment', 'payment_type_code');
  const supportAwardTypes = useCodes('support_award', 'award_type_code');
  const [awards, setAwards] = useState<SupportAward[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setAwards(await listSupportAwards(personId)); } catch (err) { setError(errorText(err, 'Failed to load support')); }
  }, [personId]);
  useEffect(() => { void load(); }, [load]);

  async function act(action: () => Promise<unknown>) {
    setError('');
    try { await action(); await load(); } catch (err) { setError(errorText(err, 'Action failed')); }
  }

  return (
    <Card>
      <CardHeader title="Student support" />
      <CardBody>
        <p className="mb-3 text-sm text-neutral-600">
          Approving an instalment sends payroll the instruction. It shows as paid only when payroll confirms. Whoever records an award or instalment cannot approve it.
        </p>
        {error && <p className="mb-3 text-sm text-danger-600" role="alert">{error}</p>}
        {awards === null ? <Spinner /> : awards.length === 0 ? <p className="text-sm text-neutral-500">No support awards.</p> : (
          <div className="flex flex-col gap-5">
            {awards.map((award) => (
              <div key={award.awardId}>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="font-medium text-neutral-800">{award.awardReference}</span>
                  <span className="text-sm text-neutral-600">{supportAwardTypes.label(award.awardTypeCode)} · {award.funder} · {award.startDate}{award.endDate ? ` to ${award.endDate}` : ''}</span>
                  <CodeBadge entity="support_award" field="status_code" code={award.statusCode} />
                  {canApprove && award.statusCode === 'draft' && (
                    <Button size="sm" onClick={() => void act(() => approveSupportAward(award.awardId))}>Approve award</Button>
                  )}
                </div>
                {award.instalments.length > 0 && (
                  <Table>
                    <TableHead>
                      <tr>
                        <TableHeaderCell>Payment</TableHeaderCell>
                        <TableHeaderCell>Period</TableHeaderCell>
                        <TableHeaderCell>Due</TableHeaderCell>
                        <TableHeaderCell>Status</TableHeaderCell>
                        <TableHeaderCell>Actions</TableHeaderCell>
                      </tr>
                    </TableHead>
                    <TableBody>
                      {award.instalments.map((i) => (
                        <TableRow key={i.instalmentId}>
                          <TableCell>{paymentTypes.label(i.paymentTypeCode)} {pounds(i.amountMinorUnits)}</TableCell>
                          <TableCell>{i.periodStart} to {i.periodEnd}</TableCell>
                          <TableCell>{i.dueDate}</TableCell>
                          <TableCell>
                            <CodeBadge entity="support_instalment" field="status_code" code={i.statusCode} />
                            {i.statusCode === 'approved' && <div className="text-xs text-neutral-500">Instructed; awaiting payroll</div>}
                            {i.statusCode === 'paid' && <div className="text-xs text-neutral-500">{i.paymentReference} on {i.paidOn ?? '—'}</div>}
                            {i.statusCode === 'rejected' && <div className="text-xs text-danger-600">{i.rejectionReason}</div>}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              {canApprove && i.statusCode === 'planned' && award.statusCode === 'approved' && (
                                <Button size="sm" onClick={() => void act(() => approveSupportInstalment(i.instalmentId))}>Approve and instruct payroll</Button>
                              )}
                              {canWrite && i.statusCode === 'planned' && (
                                <Button size="sm" variant="secondary" onClick={() => void act(() => cancelSupportInstalment(i.instalmentId))}>Cancel</Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                {canWrite && award.statusCode !== 'ended' && <InstalmentForm awardId={award.awardId} onSaved={() => void load()} />}
              </div>
            ))}
          </div>
        )}
        {canWrite && <AwardForm personId={personId} enrolmentIds={enrolmentIds} onSaved={() => void load()} />}
      </CardBody>
    </Card>
  );
}

function AwardForm({ personId, enrolmentIds, onSaved }: { personId: string; enrolmentIds: string[]; onSaved: () => void }) {
  const { members: types } = useValueSet('support_award', 'award_type_code');
  const [v, setV] = useState({ awardTypeCode: '', awardReference: '', funder: '', startDate: '', endDate: '', enrolmentId: enrolmentIds[0] ?? '' });
  const [message, setMessage] = useState('');
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault(); setMessage('');
    try {
      await createSupportAward(personId, { ...v, ...(v.endDate ? { endDate: v.endDate } : { endDate: undefined }) });
      setV((p) => ({ ...p, awardReference: '', funder: '' }));
      onSaved();
    } catch (err) { setMessage(errorText(err, 'Could not record the award')); }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-5 grid grid-cols-1 items-end gap-3 border-t border-neutral-100 pt-4 md:grid-cols-6">
      <LabelledField label="Award type" htmlFor="award-type" required>
        <Select id="award-type" value={v.awardTypeCode} onChange={set('awardTypeCode')}>
          <option value="">Choose…</option>
          {types.map((t) => <option key={t.code} value={t.code}>{t.displayLabel}</option>)}
        </Select>
      </LabelledField>
      <LabelledField label="Award reference" htmlFor="award-ref" required><Input id="award-ref" value={v.awardReference} onChange={set('awardReference')} /></LabelledField>
      <LabelledField label="Funder" htmlFor="award-funder" required><Input id="award-funder" value={v.funder} onChange={set('funder')} /></LabelledField>
      <LabelledField label="Award from" htmlFor="award-start" required><Input id="award-start" type="date" value={v.startDate} onChange={set('startDate')} /></LabelledField>
      <LabelledField label="Award to" htmlFor="award-end"><Input id="award-end" type="date" value={v.endDate} onChange={set('endDate')} /></LabelledField>
      <div>
        <Button type="submit" size="sm" disabled={!v.awardTypeCode || !v.awardReference || !v.funder || !v.startDate || !v.enrolmentId}>Record award</Button>
        {message && <p className="mt-1 text-xs text-danger-600" role="alert">{message}</p>}
      </div>
    </form>
  );
}

function InstalmentForm({ awardId, onSaved }: { awardId: string; onSaved: () => void }) {
  const { members: types } = useValueSet('support_instalment', 'payment_type_code');
  const [v, setV] = useState({ paymentTypeCode: '', amount: '', periodStart: '', periodEnd: '', dueDate: '' });
  const [message, setMessage] = useState('');
  const id = (n: string) => `inst-${awardId}-${n}`;
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault(); setMessage('');
    const amountMinorUnits = Math.round(Number(v.amount) * 100);
    if (!(amountMinorUnits > 0)) { setMessage('Enter an amount in pounds greater than 0.'); return; }
    try {
      await addSupportInstalment(awardId, { paymentTypeCode: v.paymentTypeCode, amountMinorUnits, periodStart: v.periodStart, periodEnd: v.periodEnd, dueDate: v.dueDate });
      setV({ paymentTypeCode: '', amount: '', periodStart: '', periodEnd: '', dueDate: '' });
      onSaved();
    } catch (err) { setMessage(errorText(err, 'Could not add the instalment')); }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-3 grid grid-cols-1 items-end gap-3 md:grid-cols-6">
      <LabelledField label="Payment type" htmlFor={id('type')} required>
        <Select id={id('type')} value={v.paymentTypeCode} onChange={set('paymentTypeCode')}>
          <option value="">Choose…</option>
          {types.filter((t) => t.code !== 'gta-pay').map((t) => <option key={t.code} value={t.code}>{t.displayLabel}</option>)}
        </Select>
      </LabelledField>
      <LabelledField label="Amount (£)" htmlFor={id('amount')} required><Input id={id('amount')} type="number" min="0.01" step="0.01" value={v.amount} onChange={set('amount')} /></LabelledField>
      <LabelledField label="Period from" htmlFor={id('from')} required><Input id={id('from')} type="date" value={v.periodStart} onChange={set('periodStart')} /></LabelledField>
      <LabelledField label="Period to" htmlFor={id('to')} required><Input id={id('to')} type="date" value={v.periodEnd} onChange={set('periodEnd')} /></LabelledField>
      <LabelledField label="Due" htmlFor={id('due')} required><Input id={id('due')} type="date" value={v.dueDate} onChange={set('dueDate')} /></LabelledField>
      <div>
        <Button type="submit" size="sm" variant="secondary" disabled={!v.paymentTypeCode || !v.amount || !v.periodStart || !v.periodEnd || !v.dueDate}>Add instalment</Button>
        {message && <p className="mt-1 text-xs text-danger-600" role="alert">{message}</p>}
      </div>
    </form>
  );
}

function EmploymentSection({ personId, canWrite, canConfigure }: { personId: string; canWrite: boolean; canConfigure: boolean }) {
  const [links, setLinks] = useState<EmploymentLink[] | null>(null);
  const [warnings, setWarnings] = useState<WorkLimitWarning[]>([]);
  const [limits, setLimits] = useState<WorkLimit[]>([]);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const [l, w] = await Promise.all([listEmploymentLinks(personId), listWorkLimits()]);
      setLinks(l.links); setWarnings(l.warnings); setLimits(w);
    } catch (err) { setError(errorText(err, 'Failed to load employment')); }
  }, [personId]);
  useEffect(() => { void load(); }, [load]);

  return (
    <Card>
      <CardHeader title="University employment" />
      <CardBody>
        <p className="mb-3 text-sm text-neutral-600">
          HR holds the appointment, contract and pay. This records only what the SRS needs to check visa and funder working limits, and to tell HR when the student's study status changes. Hours cover university employment only.
        </p>
        {error && <p className="mb-3 text-sm text-danger-600" role="alert">{error}</p>}
        {warnings.length > 0 && (
          <ul className="mb-4 flex flex-col gap-1" aria-label="Work limit warnings">
            {warnings.map((w, i) => <li key={i} className="text-sm text-warning-700">⚠ {w.message}</li>)}
          </ul>
        )}
        {links === null ? <Spinner /> : links.length === 0 ? <p className="text-sm text-neutral-500">No university employment recorded.</p> : (
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>HR reference</TableHeaderCell>
                <TableHeaderCell>Role</TableHeaderCell>
                <TableHeaderCell>Dates</TableHeaderCell>
                <TableHeaderCell>Hours / week</TableHeaderCell>
                <TableHeaderCell>Supervisor agreed</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {links.map((l) => (
                <TableRow key={l.linkId}>
                  <TableCell>{l.hrEmploymentReference}</TableCell>
                  <TableCell><CodeLabel entity="student_employment_link" field="role_type_code" code={l.roleTypeCode} /></TableCell>
                  <TableCell>{l.startDate}{l.endDate ? ` to ${l.endDate}` : ''}</TableCell>
                  <TableCell>{l.weeklyHours}</TableCell>
                  <TableCell>{l.supervisorAgreedAt ? new Date(l.supervisorAgreedAt).toLocaleDateString('en-GB') : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {canWrite && <LinkForm personId={personId} onSaved={() => void load()} />}
        <LimitsView limits={limits} canConfigure={canConfigure} onSaved={() => void load()} />
      </CardBody>
    </Card>
  );
}

function LinkForm({ personId, onSaved }: { personId: string; onSaved: () => void }) {
  const { members: roles } = useValueSet('student_employment_link', 'role_type_code');
  const [v, setV] = useState({ ref: '', roleTypeCode: '', startDate: '', endDate: '', weeklyHours: '', supervisorAgreed: false });
  const [message, setMessage] = useState('');
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault(); setMessage('');
    try {
      await saveEmploymentLink(personId, v.ref.trim(), {
        roleTypeCode: v.roleTypeCode, startDate: v.startDate, endDate: v.endDate || null, weeklyHours: Number(v.weeklyHours),
        supervisorAgreedAt: v.supervisorAgreed ? new Date().toISOString() : null,
      });
      setV({ ref: '', roleTypeCode: '', startDate: '', endDate: '', weeklyHours: '', supervisorAgreed: false });
      onSaved();
    } catch (err) { setMessage(errorText(err, 'Could not save')); }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-5 grid grid-cols-1 items-end gap-3 border-t border-neutral-100 pt-4 md:grid-cols-7">
      <LabelledField label="HR reference" htmlFor="emp-ref" required><Input id="emp-ref" value={v.ref} onChange={set('ref')} /></LabelledField>
      <LabelledField label="Role" htmlFor="emp-role" required>
        <Select id="emp-role" value={v.roleTypeCode} onChange={set('roleTypeCode')}>
          <option value="">Choose…</option>
          {roles.map((r) => <option key={r.code} value={r.code}>{r.displayLabel}</option>)}
        </Select>
      </LabelledField>
      <LabelledField label="From" htmlFor="emp-start" required><Input id="emp-start" type="date" value={v.startDate} onChange={set('startDate')} /></LabelledField>
      <LabelledField label="To" htmlFor="emp-end"><Input id="emp-end" type="date" value={v.endDate} onChange={set('endDate')} /></LabelledField>
      <LabelledField label="Hours per week" htmlFor="emp-hours" required><Input id="emp-hours" type="number" min="0" step="0.5" value={v.weeklyHours} onChange={set('weeklyHours')} /></LabelledField>
      <label className="flex items-center gap-2 text-sm text-neutral-700">
        <input type="checkbox" checked={v.supervisorAgreed} onChange={(e) => setV((p) => ({ ...p, supervisorAgreed: e.target.checked }))} />
        Supervisor agreed
      </label>
      <div>
        <Button type="submit" size="sm" disabled={!v.ref.trim() || !v.roleTypeCode || !v.startDate || v.weeklyHours === ''}>Save</Button>
        {message && <p className="mt-1 text-xs text-danger-600" role="alert">{message}</p>}
      </div>
    </form>
  );
}

function LimitsView({ limits, canConfigure, onSaved }: { limits: WorkLimit[]; canConfigure: boolean; onSaved: () => void }) {
  return (
    <div className="mt-5 border-t border-neutral-100 pt-4">
      <h3 className="mb-2 text-sm font-semibold text-neutral-800">Working limits checked</h3>
      <div className="flex flex-col gap-2">
        {limits.map((l) => <LimitRow key={l.ruleCode} limit={l} canConfigure={canConfigure} onSaved={onSaved} />)}
      </div>
    </div>
  );
}

function LimitRow({ limit, canConfigure, onSaved }: { limit: WorkLimit; canConfigure: boolean; onSaved: () => void }) {
  const [value, setValue] = useState(String(limit.maxWeeklyHours));
  const [message, setMessage] = useState('');
  const id = `limit-${limit.ruleCode}`;
  async function save(e: FormEvent) {
    e.preventDefault(); setMessage('');
    try { await setWorkLimit(limit.ruleCode, Number(value)); setMessage('Saved'); onSaved(); } catch (err) { setMessage(errorText(err, 'Save failed')); }
  }
  return (
    <form onSubmit={(e) => void save(e)} className="flex flex-wrap items-end gap-2">
      <LabelledField label={`${limit.description} (hours per week)`} htmlFor={id}>
        <Input id={id} type="number" min="0" step="0.5" value={value} disabled={!canConfigure} onChange={(e) => setValue(e.target.value)} />
      </LabelledField>
      {limit.isDefault && <span className="text-xs text-neutral-500">starting value — confirm against your policy</span>}
      {canConfigure && <Button type="submit" size="sm" variant="secondary">Save</Button>}
      {message && <span className="text-xs text-neutral-600" role="status">{message}</span>}
    </form>
  );
}
