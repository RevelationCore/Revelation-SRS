import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Card, CardHeader, CardBody, Button, Input, Select, LabelledField, Badge, Spinner, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, CodeBadge, CodeLabel, CodeSelect,
} from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import {
  type FeeStatusReassessment, type FinancialRegistration, type FinancialStatusInput,
  decideFeeStatus, listFeeStatusReassessments, listFinancialRegistration, proposeFeeStatus, updateFinancialStatus,
} from '../api/registrationChecks.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { useValueSet } from '../hooks/useValueSet.js';

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? (err.detail ?? err.message) : fallback;
}

/**
 * Financial registration for one enrolment (Phase 3 D-18): each year's
 * financial status, separate from academic registration, and the fee status
 * the institution determined, which changes only through a reassessment
 * decided by someone other than the proposer.
 */
export function FinancialRegistrationSection({ enrolmentId, feeStatusCode }: { enrolmentId: string; feeStatusCode: string | null }) {
  const { roles } = useAuth();
  const canRead = userHasAnyPermission(roles, ['financial-registration:read']);
  const canWrite = userHasAnyPermission(roles, ['financial-registration:write']);
  const canPropose = userHasAnyPermission(roles, ['fee-status:propose']);
  const [years, setYears] = useState<FinancialRegistration[] | null>(null);
  const [reassessments, setReassessments] = useState<FeeStatusReassessment[]>([]);
  const [error, setError] = useState('');
  const { members: feeStatuses } = useValueSet('enrolment', 'fee_status_code');
  const feeLabel = (code: string | null) => (code ? feeStatuses.find((m) => m.code === code)?.displayLabel ?? code : 'Not recorded');

  const load = useCallback(async () => {
    try {
      if (canRead) setYears(await listFinancialRegistration(enrolmentId));
      if (canPropose) setReassessments(await listFeeStatusReassessments({ enrolmentId }));
    } catch (err) { setError(message(err, 'Failed to load financial registration')); }
  }, [enrolmentId, canRead, canPropose]);
  useEffect(() => { void load(); }, [load]);
  if (!canRead && !canPropose) return null;

  const open = reassessments.find((r) => r.statusCode === 'open');
  return (
    <Card>
      <CardHeader title="Fees and financial registration" description={`Fee status: ${feeLabel(feeStatusCode)}. Financial registration is separate from academic registration and does not block it unless the institution has chosen to block on a tuition hold.`} />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600" role="alert">{error}</p>}
        {canRead && (!years ? <Spinner /> : years.length === 0 ? <p className="text-sm text-neutral-600">No fee liabilities yet.</p> : (
          <Table>
            <TableHead><tr><TableHeaderCell>Year</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell><TableHeaderCell>Payer</TableHeaderCell><TableHeaderCell>Source</TableHeaderCell>{canWrite && <TableHeaderCell><span className="sr-only">Change</span></TableHeaderCell>}</tr></TableHead>
            <TableBody>
              {years.map((y) => (
                <TableRow key={y.liabilityId}>
                  <TableCell>{y.academicYear}</TableCell>
                  <TableCell><CodeBadge entity="fee_liability" field="financial_status_code" code={y.financialStatusCode} />{y.holdReasonCode && <div className="text-xs text-neutral-500"><CodeLabel entity="fee_liability" field="hold_reason_code" code={y.holdReasonCode} /></div>}</TableCell>
                  <TableCell className="text-sm"><CodeLabel entity="fee_liability" field="payer_arrangement_code" code={y.payerArrangementCode} />{y.financeReference ? <div className="text-xs text-neutral-500">{y.financeReference}</div> : null}</TableCell>
                  <TableCell className="text-xs"><CodeLabel entity="fee_liability" field="status_source_code" code={y.statusSourceCode} />{y.statusUpdatedAt ? `, ${new Date(y.statusUpdatedAt).toLocaleDateString('en-GB')}` : ''}</TableCell>
                  {canWrite && <TableCell><StatusForm item={y} onSaved={() => void load()} /></TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ))}
        {canPropose && (
          <div className="mt-4">
            {open ? <p className="text-sm text-neutral-700">A fee-status reassessment to {feeLabel(open.proposedFeeStatusCode)} is waiting for a decision (proposed by {open.proposedBy}).</p>
              : <ReassessmentForm enrolmentId={enrolmentId} current={feeStatusCode} options={feeStatuses} onDone={() => void load()} />}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function StatusForm({ item, onSaved }: { item: FinancialRegistration; onSaved: () => void }) {
  const { members: payers } = useValueSet('fee_liability', 'payer_arrangement_code');
  const { members: reasons } = useValueSet('fee_liability', 'hold_reason_code');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FinancialStatusInput>({ financialStatusCode: item.financialStatusCode });
  const [error, setError] = useState('');
  const id = item.liabilityId;
  if (!open) return <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Change<span className="sr-only"> {item.academicYear} financial status</span></Button>;
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try { await updateFinancialStatus(id, form); setOpen(false); onSaved(); } catch (err) { setError(message(err, 'Failed to save')); }
  }
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => void submit(e)}>
      {error && <p className="text-xs text-danger-600" role="alert">{error}</p>}
      <LabelledField label="Status" htmlFor={`fin-${id}-status`}>
        <CodeSelect entity="fee_liability" field="financial_status_code" id={`fin-${id}-status`} value={form.financialStatusCode} onChange={(v) => setForm({ financialStatusCode: v as FinancialStatusInput['financialStatusCode'] })} />
      </LabelledField>
      {form.financialStatusCode === 'hold' && (
        <LabelledField label="Hold reason" htmlFor={`fin-${id}-reason`}>
          <Select id={`fin-${id}-reason`} value={form.holdReasonCode ?? ''} onChange={(e) => setForm((f) => ({ ...f, holdReasonCode: e.target.value }))}><option value="">Choose…</option>{reasons.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}</Select>
        </LabelledField>
      )}
      {form.financialStatusCode === 'arranged' && (
        <LabelledField label="Payer" htmlFor={`fin-${id}-payer`}>
          <Select id={`fin-${id}-payer`} value={form.payerArrangementCode ?? ''} onChange={(e) => setForm((f) => ({ ...f, payerArrangementCode: e.target.value }))}><option value="">Choose…</option>{payers.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}</Select>
        </LabelledField>
      )}
      <div className="flex gap-2"><Button size="sm" type="submit" disabled={form.financialStatusCode === 'hold' && !form.holdReasonCode}>Save</Button><Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
    </form>
  );
}

function ReassessmentForm({ enrolmentId, current, options, onDone }: { enrolmentId: string; current: string | null; options: Array<{ code: string; displayLabel: string }>; onDone: () => void }) {
  const [feeStatusCode, setFeeStatusCode] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try { await proposeFeeStatus(enrolmentId, { feeStatusCode, reason: reason.trim() }); setFeeStatusCode(''); setReason(''); onDone(); } catch (err) { setError(message(err, 'Failed to propose the change')); }
  }
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => void submit(e)}>
      {error && <p className="w-full text-sm text-danger-600" role="alert">{error}</p>}
      <LabelledField label="Reassess fee status to" htmlFor={`fs-${enrolmentId}`}>
        <Select id={`fs-${enrolmentId}`} value={feeStatusCode} onChange={(e) => setFeeStatusCode(e.target.value)}><option value="">Choose…</option>{options.filter((m) => m.code !== current).map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}</Select>
      </LabelledField>
      <LabelledField label="Reason" htmlFor={`fs-${enrolmentId}-reason`}><Input id={`fs-${enrolmentId}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} /></LabelledField>
      <Button size="sm" variant="secondary" type="submit" disabled={!feeStatusCode || !reason.trim()}>Propose</Button>
    </form>
  );
}

/** A finance administrator decides a proposed fee-status change (not their own). */
export function FeeStatusDecision({ item, onDone }: { item: FeeStatusReassessment; onDone: () => void }) {
  const { user } = useAuth();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  if (item.proposedBy === user?.sub) return <p className="text-xs text-neutral-600">You proposed this change, so someone else must decide it.</p>;
  const decide = async (outcome: 'approved' | 'rejected') => {
    setError('');
    try { await decideFeeStatus(item.caseId, { outcome, ...(note.trim() ? { note: note.trim() } : {}) }); onDone(); } catch (err) { setError(message(err, 'The decision failed')); }
  };
  return (
    <div className="flex flex-wrap items-end gap-2">
      {error && <p className="w-full text-sm text-danger-600" role="alert">{error}</p>}
      <LabelledField label="Note" htmlFor={`fsd-${item.caseId}`}><Input id={`fsd-${item.caseId}`} value={note} onChange={(e) => setNote(e.target.value)} /></LabelledField>
      <Button size="sm" onClick={() => void decide('approved')}>Approve</Button>
      <Button size="sm" variant="secondary" onClick={() => void decide('rejected')}>Reject</Button>
    </div>
  );
}
