import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Input, Select, LabelledField, Badge } from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import {
  type CasCase,
  type SponsorReportVersion,
  listSponsorReportVersions, recordSponsorReportVersion,
  approveCas, prepareCas, recordCasNumber, recordEligibilityCheck, reopenCasForCorrection, withdrawCas,
} from '../api/casCases.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { useValueSet } from '../hooks/useValueSet.js';

export const CAS_STATUS_LABELS: Record<string, string> = {
  opened: 'Opened', 'eligibility-checked': 'Eligibility checked', prepared: 'Waiting for approval', approved: 'Approved, not yet sent',
  requested: 'Sent to SMS', assigned: 'CAS assigned', withdrawn: 'Withdrawn',
};
const when = (iso: string) => new Date(iso).toLocaleDateString('en-GB');
function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? (err.detail ?? err.message) : fallback;
}

/**
 * One CAS case (Phase 3 D-16): its eligibility checks and assignment versions,
 * and the next step. Preparing and approving are done by different people;
 * the approved data goes to SMS in the export file from the UKVI page.
 */
export function CasCasePanel({ item, onChanged }: { item: CasCase; onChanged: () => void }) {
  const { roles, user } = useAuth();
  const canPrepare = userHasAnyPermission(roles, ['cas:prepare']);
  const canApprove = userHasAnyPermission(roles, ['cas:approve']);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try { await fn(); onChanged(); } catch (err) { setError(message(err, 'The CAS action failed')); }
  };
  const id = item.casCaseId;
  const latest = item.assignmentVersions.at(-1);
  const open = !['assigned', 'withdrawn'].includes(item.statusCode);
  const preparedByMe = item.preparedBy !== null && item.preparedBy === user?.sub;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge value={item.statusCode === 'assigned' ? 'approved' : item.statusCode === 'withdrawn' ? 'rejected' : 'pending'} label={CAS_STATUS_LABELS[item.statusCode] ?? item.statusCode} />
        {item.casReference && <span className="font-mono">{item.casReference}</span>}
        <span className="text-xs text-neutral-500">opened {when(item.openedAt)}{item.applicationId && !item.enrolmentId ? ' · on the application' : ''}</span>
      </div>
      {error && <p className="text-danger-600" role="alert">{error}</p>}
      {item.attentionReason === 'application-withdrawn' && (
        <p className="rounded bg-warning-50 p-2 text-warning-800" role="status">The applicant has withdrawn. Withdraw this CAS, or report the withdrawal to UKVI if it was assigned.</p>
      )}

      <div>
        <p className="font-medium text-neutral-800">Eligibility checks</p>
        {item.eligibilityChecks.length === 0 ? <p className="text-neutral-600">None recorded.</p> : (
          <ul className="mt-1 text-neutral-700">
            {item.eligibilityChecks.map((c) => <li key={c.checkId}>{c.checkTypeCode}: <strong>{c.resultCode}</strong> · {c.guidanceVersion} · {c.checkedBy}, {when(c.checkedAt)}</li>)}
          </ul>
        )}
        {canPrepare && open && <EligibilityForm id={id} onSubmit={(body) => run(() => recordEligibilityCheck(id, body))} />}
      </div>

      {item.assignmentVersions.length > 0 && (
        <div>
          <p className="font-medium text-neutral-800">Assignment versions</p>
          <ul className="mt-1 text-neutral-700">
            {item.assignmentVersions.map((v) => (
              <li key={v.assignmentVersionId}>
                Version {v.versionNumber}: approved by {v.approvedBy}, {when(v.approvedAt)}
                {v.smsRequestSentAt ? ` · sent to SMS ${when(v.smsRequestSentAt)}` : ' · not yet sent'}
                {v.casNumber ? ` · CAS ${v.casNumber}` : ''}{v.smsReceiptRef ? ` (receipt ${v.smsReceiptRef})` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      <SponsorReports casCaseId={id} canRecord={canPrepare} />

      <div className="flex flex-wrap items-end gap-2">
        {canPrepare && ['eligibility-checked', 'prepared'].includes(item.statusCode) && (
          <Button size="sm" variant="secondary" onClick={() => void run(() => prepareCas(id))}>{item.statusCode === 'prepared' ? 'Prepare again' : 'Prepare CAS data'}</Button>
        )}
        {canApprove && item.statusCode === 'prepared' && (
          preparedByMe
            ? <p className="text-xs text-neutral-600">You prepared this data, so someone else must approve it.</p>
            : <Button size="sm" onClick={() => void run(() => approveCas(id))}>Approve for SMS</Button>
        )}
        {item.statusCode === 'approved' && <p className="text-xs text-neutral-600">Approved. It goes to SMS in the next export file from the UKVI page.</p>}
        {canPrepare && item.statusCode === 'requested' && latest && <CasNumberForm id={id} onSubmit={(body) => run(() => recordCasNumber(id, body))} />}
        {canPrepare && item.statusCode === 'assigned' && <Button size="sm" variant="secondary" onClick={() => void run(() => reopenCasForCorrection(id))}>Correct the CAS</Button>}
        {canPrepare && item.statusCode !== 'withdrawn' && <Button size="sm" variant="ghost" onClick={() => void run(() => withdrawCas(id))}>Withdraw case</Button>}
      </div>
    </div>
  );
}

/** The sponsor reports made to UKVI about this CAS, and recording a new one (D-43a). */
function SponsorReports({ casCaseId, canRecord }: { casCaseId: string; canRecord: boolean }) {
  const [reports, setReports] = useState<SponsorReportVersion[]>([]);
  const [ref, setRef] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => { setReports(await listSponsorReportVersions(casCaseId).catch(() => [])); }, [casCaseId]);
  useEffect(() => { void load(); }, [load]);
  async function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    try { await recordSponsorReportVersion(casCaseId, { reportPayloadRef: ref.trim() }); setRef(''); await load(); }
    catch (err) { setError(message(err, 'Recording the sponsor report failed')); }
  }
  return (
    <div>
      <p className="font-medium text-neutral-800">Sponsor reports</p>
      {reports.length === 0 ? <p className="text-neutral-600">None recorded.</p> : (
        <ul className="mt-1 text-neutral-700">
          {reports.map((r) => <li key={r.reportId}>{r.reportPayloadRef} · {r.generatedBy}, {when(r.generatedAt)}</li>)}
        </ul>
      )}
      {canRecord && (
        <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(e) => void submit(e)}>
          <LabelledField label="SMS report reference" htmlFor={`cas-${casCaseId}-report`} hint="The reference SMS gave the report">
            <Input id={`cas-${casCaseId}-report`} value={ref} onChange={(e) => setRef(e.target.value)} />
          </LabelledField>
          <Button size="sm" type="submit" variant="secondary" disabled={!ref.trim()}>Record sponsor report</Button>
        </form>
      )}
      {error && <p className="text-xs text-danger-600" role="alert">{error}</p>}
    </div>
  );
}

function EligibilityForm({ id, onSubmit }: { id: string; onSubmit: (body: { guidanceVersion: string; checkTypeCode: string; resultCode: string }) => Promise<void> }) {
  const { members: types } = useValueSet('cas_eligibility_check', 'check_type_code');
  const { members: results } = useValueSet('cas_eligibility_check', 'result_code');
  const [form, setForm] = useState({ guidanceVersion: '', checkTypeCode: '', resultCode: '' });
  function submit(e: FormEvent) {
    e.preventDefault();
    void onSubmit({ guidanceVersion: form.guidanceVersion.trim(), checkTypeCode: form.checkTypeCode, resultCode: form.resultCode }).then(() => setForm((f) => ({ ...f, checkTypeCode: '', resultCode: '' })));
  }
  return (
    <form className="mt-2 grid grid-cols-1 items-end gap-2 md:grid-cols-4" onSubmit={submit}>
      <LabelledField label="Guidance version" htmlFor={`cas-${id}-guidance`} required hint="e.g. Student sponsor guidance 10/2026">
        <Input id={`cas-${id}-guidance`} value={form.guidanceVersion} onChange={(e) => setForm((f) => ({ ...f, guidanceVersion: e.target.value }))} />
      </LabelledField>
      <LabelledField label="Check" htmlFor={`cas-${id}-type`} required>
        <Select id={`cas-${id}-type`} value={form.checkTypeCode} onChange={(e) => setForm((f) => ({ ...f, checkTypeCode: e.target.value }))}>
          <option value="">Choose…</option>
          {types.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
        </Select>
      </LabelledField>
      <LabelledField label="Result" htmlFor={`cas-${id}-result`} required>
        <Select id={`cas-${id}-result`} value={form.resultCode} onChange={(e) => setForm((f) => ({ ...f, resultCode: e.target.value }))}>
          <option value="">Choose…</option>
          {results.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
        </Select>
      </LabelledField>
      <Button type="submit" size="sm" variant="secondary" disabled={!form.guidanceVersion.trim() || !form.checkTypeCode || !form.resultCode}>Record check</Button>
    </form>
  );
}

function CasNumberForm({ id, onSubmit }: { id: string; onSubmit: (body: { casNumber: string; smsReceiptRef?: string }) => Promise<void> }) {
  const [casNumber, setCasNumber] = useState('');
  const [receipt, setReceipt] = useState('');
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void onSubmit({ casNumber: casNumber.trim(), ...(receipt.trim() ? { smsReceiptRef: receipt.trim() } : {}) }); }}>
      <LabelledField label="CAS number" htmlFor={`cas-${id}-number`} required hint="14 characters, from SMS">
        <Input id={`cas-${id}-number`} value={casNumber} onChange={(e) => setCasNumber(e.target.value)} />
      </LabelledField>
      <LabelledField label="SMS receipt" htmlFor={`cas-${id}-receipt`}>
        <Input id={`cas-${id}-receipt`} value={receipt} onChange={(e) => setReceipt(e.target.value)} />
      </LabelledField>
      <Button type="submit" size="sm" disabled={casNumber.trim().length !== 14}>Record CAS number</Button>
    </form>
  );
}
