import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardBody, Button, Input, Select, LabelledField, Badge, Spinner } from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import { type RightToStudyCheck, type RightToStudyInput, decideRightToStudy, listRightToStudy, recordRightToStudy } from '../api/registrationChecks.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { useValueSet } from '../hooks/useValueSet.js';

export const RTS_OUTCOME_LABELS: Record<RightToStudyCheck['outcomeCode'], string> = {
  pending: 'Waiting for a check', eligible: 'Eligible', 'not-eligible': 'Not eligible', referred: 'Referred to a regulatory officer', 'recheck-required': 'Recheck needed',
};
const badge = (o: RightToStudyCheck['outcomeCode']) => (o === 'eligible' ? 'approved' : o === 'not-eligible' ? 'rejected' : 'pending');
function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? (err.detail ?? err.message) : fallback;
}

/**
 * Right to study (Phase 3 D-17): separate from identity verification. The
 * most recent check counts; a not-eligible finding is referred to a
 * regulatory officer, who decides it.
 */
export function RightToStudySection({ personId }: { personId: string }) {
  const { roles } = useAuth();
  const canRecord = userHasAnyPermission(roles, ['right-to-study:record']);
  const canDecide = userHasAnyPermission(roles, ['right-to-study:decide']);
  const [checks, setChecks] = useState<RightToStudyCheck[] | null>(null);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const { members: bases } = useValueSet('right_to_study_check', 'basis_code');
  const { members: methods } = useValueSet('right_to_study_check', 'method_code');
  const label = (list: Array<{ code: string; displayLabel: string }>, code: string | null) => (code ? list.find((m) => m.code === code)?.displayLabel ?? code : '—');

  const load = useCallback(async () => {
    try { setChecks(await listRightToStudy(personId)); } catch (err) { setError(message(err, 'Failed to load the right to study')); }
  }, [personId]);
  useEffect(() => { void load(); }, [load]);

  const current = checks?.[0];
  return (
    <Card>
      <CardHeader
        title="Right to study"
        description="Who checked, on what basis, by which method, and when the permission expires. Initial registration needs a current eligible check."
        actions={canRecord && <Button size="sm" variant="secondary" onClick={() => setRecording((v) => !v)}>{recording ? 'Cancel' : 'Record a check'}</Button>}
      />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600" role="alert">{error}</p>}
        {!checks ? <Spinner /> : !current ? <p className="text-sm text-neutral-600">No right-to-study check recorded.</p> : (
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-center gap-2">
              <Badge value={badge(current.outcomeCode)} label={RTS_OUTCOME_LABELS[current.outcomeCode]} />
              {current.shareCodeSubmitted && <span className="text-neutral-600">The student has shared a View and Prove code.</span>}
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 md:grid-cols-3">
              <div><dt className="text-neutral-500">Basis</dt><dd>{label(bases, current.basisCode)}</dd></div>
              <div><dt className="text-neutral-500">Method</dt><dd>{label(methods, current.methodCode)}</dd></div>
              <div><dt className="text-neutral-500">Permission expires</dt><dd>{current.permissionExpiresOn ?? 'Not time-limited'}</dd></div>
              <div><dt className="text-neutral-500">UK entry date</dt><dd>{current.ukEntryDate ?? '—'}</dd></div>
              <div><dt className="text-neutral-500">Checked</dt><dd>{current.checkedBy}, {new Date(current.checkedAt).toLocaleDateString('en-GB')}</dd></div>
            </dl>
            {current.note && <p className="text-neutral-700">{current.note}</p>}
            {current.outcomeCode === 'referred' && canDecide && <DecisionForm check={current} onDone={() => void load()} />}
            {checks.length > 1 && <p className="text-xs text-neutral-500">{checks.length - 1} earlier check(s) kept on record.</p>}
          </div>
        )}
        {recording && canRecord && (
          <RecordForm bases={bases} methods={methods} onSubmit={async (body) => {
            setError('');
            try { await recordRightToStudy(personId, body); setRecording(false); await load(); } catch (err) { setError(message(err, 'Failed to record the check')); }
          }} />
        )}
      </CardBody>
    </Card>
  );
}

function RecordForm({ bases, methods, onSubmit }: { bases: Array<{ code: string; displayLabel: string }>; methods: Array<{ code: string; displayLabel: string }>; onSubmit: (body: RightToStudyInput) => Promise<void> }) {
  const [form, setForm] = useState({ basisCode: '', methodCode: '', outcomeCode: 'eligible' as 'eligible' | 'not-eligible', permissionExpiresOn: '', ukEntryDate: '', evidenceRef: '', note: '' });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  function submit(e: FormEvent) {
    e.preventDefault();
    void onSubmit({
      basisCode: form.basisCode, methodCode: form.methodCode, outcomeCode: form.outcomeCode,
      ...(form.permissionExpiresOn ? { permissionExpiresOn: form.permissionExpiresOn } : {}), ...(form.ukEntryDate ? { ukEntryDate: form.ukEntryDate } : {}),
      ...(form.evidenceRef.trim() ? { evidenceRef: form.evidenceRef.trim() } : {}), ...(form.note.trim() ? { note: form.note.trim() } : {}),
    });
  }
  return (
    <form className="mt-4 grid grid-cols-1 items-end gap-3 md:grid-cols-3" onSubmit={submit}>
      <LabelledField label="Basis" htmlFor="rts-basis" required>
        <Select id="rts-basis" value={form.basisCode} onChange={set('basisCode')}><option value="">Choose…</option>{bases.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}</Select>
      </LabelledField>
      <LabelledField label="Method" htmlFor="rts-method" required>
        <Select id="rts-method" value={form.methodCode} onChange={set('methodCode')}><option value="">Choose…</option>{methods.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}</Select>
      </LabelledField>
      <LabelledField label="Outcome" htmlFor="rts-outcome" required hint="Not eligible is referred to a regulatory officer">
        <Select id="rts-outcome" value={form.outcomeCode} onChange={set('outcomeCode')}><option value="eligible">Eligible</option><option value="not-eligible">Not eligible</option></Select>
      </LabelledField>
      <LabelledField label="Permission expires" htmlFor="rts-expires" hint="Leave blank if not time-limited"><Input id="rts-expires" type="date" value={form.permissionExpiresOn} onChange={set('permissionExpiresOn')} /></LabelledField>
      <LabelledField label="UK entry date" htmlFor="rts-entry" hint="For a sponsored student"><Input id="rts-entry" type="date" value={form.ukEntryDate} onChange={set('ukEntryDate')} /></LabelledField>
      <LabelledField label="Evidence reference" htmlFor="rts-evidence"><Input id="rts-evidence" value={form.evidenceRef} onChange={set('evidenceRef')} /></LabelledField>
      <div className="md:col-span-2"><LabelledField label="Note" htmlFor="rts-note"><Input id="rts-note" value={form.note} onChange={set('note')} /></LabelledField></div>
      <Button type="submit" disabled={!form.basisCode || !form.methodCode}>Record check</Button>
    </form>
  );
}

function DecisionForm({ check, onDone }: { check: RightToStudyCheck; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const decide = async (outcomeCode: 'eligible' | 'not-eligible') => {
    setError('');
    try { await decideRightToStudy(check.checkId, { outcomeCode, note: note.trim() }); onDone(); } catch (err) { setError(message(err, 'The decision failed')); }
  };
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      {error && <p className="w-full text-sm text-danger-600" role="alert">{error}</p>}
      <LabelledField label="Reason for the decision" htmlFor={`rts-decide-${check.checkId}`} required><Input id={`rts-decide-${check.checkId}`} value={note} onChange={(e) => setNote(e.target.value)} /></LabelledField>
      <Button size="sm" disabled={!note.trim()} onClick={() => void decide('eligible')}>Eligible</Button>
      <Button size="sm" variant="secondary" disabled={!note.trim()} onClick={() => void decide('not-eligible')}>Not eligible</Button>
    </div>
  );
}
