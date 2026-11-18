import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Card, CardHeader, CardBody, Button, Input, Select, LabelledField, Spinner, StatusNotice, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, CodeLabel,
} from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import { type Enrolment, listStudentEnrolments } from '../api/enrolments.js';
import { type MisconductOutcome, listMisconductOutcomes, recordMisconductOutcome } from '../api/misconduct.js';
import { type ModuleRegistration, listAllModuleRegistrations } from '../api/registrations.js';
import { useValueSet } from '../hooks/useValueSet.js';

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? (err.detail ?? err.message) : fallback;
}

/**
 * Academic misconduct outcomes (BP-05-006; D-5). The investigation is held
 * by the case system; the record keeps only its reference, the penalty and
 * the penalty's effect on marks and registrations, never the allegation or
 * evidence (ADR-017).
 */
export function MisconductTab({ personId, canRecord }: { personId: string; canRecord: boolean }) {
  const [outcomes, setOutcomes] = useState<MisconductOutcome[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setOutcomes(await listMisconductOutcomes(personId)); } catch (err) { setError(message(err, 'Failed to load misconduct outcomes')); }
  }, [personId]);
  useEffect(() => { void load(); }, [load]);

  if (error) return <p className="text-sm text-danger-600" role="alert">{error}</p>;
  if (!outcomes) return <div className="flex justify-center py-8"><Spinner /></div>;

  return (
    <Card>
      <CardHeader title="Misconduct outcomes" description="Confirmed outcomes from the academic integrity process and their authorised effects. Allegations and evidence stay in the case system." />
      <CardBody>
        <div className="flex flex-col gap-4">
          {outcomes.length === 0 ? <p className="text-sm text-neutral-600">No misconduct outcomes.</p> : (
            <Table>
              <TableHead><tr><TableHeaderCell>Case</TableHeaderCell><TableHeaderCell>Penalty</TableHeaderCell><TableHeaderCell>From</TableHeaderCell><TableHeaderCell>Effects</TableHeaderCell></tr></TableHead>
              <TableBody>
                {outcomes.map((o) => (
                  <TableRow key={o.misconductOutcomeId}>
                    <TableCell className="font-mono text-xs">{o.caseReference}<div className="font-sans text-neutral-500"><CodeLabel entity="misconduct_case_reference" field="case_status_code" code={o.caseStatusCode} /></div></TableCell>
                    <TableCell><CodeLabel entity="misconduct_outcome" field="penalty_code" code={o.penaltyCode} /></TableCell>
                    <TableCell className="text-sm">{o.effectiveDate}</TableCell>
                    <TableCell className="text-xs">
                      {o.penaltyEffects.length === 0 ? 'None' : o.penaltyEffects.map((e, i) => (
                        <div key={i}>{e.targetEntityType === 'mark' ? 'Mark' : 'Module registration'}{e.penaltyDetail ? `: ${e.penaltyDetail}` : ''}</div>
                      ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {canRecord && <RecordOutcomeForm personId={personId} onRecorded={() => void load()} />}
        </div>
      </CardBody>
    </Card>
  );
}

function RecordOutcomeForm({ personId, onRecorded }: { personId: string; onRecorded: () => void }) {
  const { members: penalties } = useValueSet('misconduct_outcome', 'penalty_code');
  const [enrolments, setEnrolments] = useState<Enrolment[]>([]);
  const [registrations, setRegistrations] = useState<ModuleRegistration[]>([]);
  const [enrolmentId, setEnrolmentId] = useState('');
  const [caseReference, setCaseReference] = useState('');
  const [caseStatus, setCaseStatus] = useState('closed');
  const [penalty, setPenalty] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [registrationId, setRegistrationId] = useState('');
  const [effectDetail, setEffectDetail] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    listStudentEnrolments(personId).then((list) => { setEnrolments(list); setEnrolmentId(list[0]?.enrolmentId ?? ''); }).catch(() => undefined);
  }, [personId]);
  useEffect(() => {
    if (!enrolmentId) return;
    listAllModuleRegistrations(enrolmentId).then(setRegistrations).catch(() => setRegistrations([]));
  }, [enrolmentId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await recordMisconductOutcome(personId, {
        enrolmentId, caseReference: caseReference.trim(), penaltyCode: penalty, effectiveDate,
        ...(caseStatus.trim() ? { caseStatusCode: caseStatus.trim() } : {}),
        ...(registrationId ? { penaltyEffects: [{ targetEntityType: 'module_registration' as const, targetEntityId: registrationId, ...(effectDetail.trim() ? { penaltyDetail: effectDetail.trim() } : {}) }] } : {}),
      });
      setCaseReference(''); setPenalty(''); setEffectiveDate(''); setRegistrationId(''); setEffectDetail('');
      onRecorded();
    } catch (err) { setError(message(err, 'Failed to record the outcome')); }
  }

  return (
    <form className="grid grid-cols-1 gap-3 items-end md:grid-cols-3" onSubmit={(e) => void submit(e)}>
      <p className="text-sm font-medium md:col-span-3">Record an outcome</p>
      <div className="md:col-span-3"><StatusNotice>Record only the outcome and its authorised effect. Do not enter allegation details or evidence.</StatusNotice></div>
      {error && <p className="text-sm text-danger-600 md:col-span-3" role="alert">{error}</p>}
      <LabelledField label="Enrolment" htmlFor="mc-enrolment" required>
        <Select id="mc-enrolment" value={enrolmentId} onChange={(e) => setEnrolmentId(e.target.value)}>
          {enrolments.map((en) => <option key={en.enrolmentId} value={en.enrolmentId}>{en.programmeCode ?? 'Programme'} — {en.academicYearOfEntry}</option>)}
        </Select>
      </LabelledField>
      <LabelledField label="Case reference" htmlFor="mc-case" required hint="From the integrity case system">
        <Input id="mc-case" value={caseReference} onChange={(e) => setCaseReference(e.target.value)} />
      </LabelledField>
      <LabelledField label="Case status" htmlFor="mc-status">
        <Input id="mc-status" value={caseStatus} onChange={(e) => setCaseStatus(e.target.value)} />
      </LabelledField>
      <LabelledField label="Penalty" htmlFor="mc-penalty" required>
        <Select id="mc-penalty" value={penalty} onChange={(e) => setPenalty(e.target.value)}>
          <option value="">Choose…</option>
          {penalties.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
        </Select>
      </LabelledField>
      <LabelledField label="Effective from" htmlFor="mc-date" required>
        <Input id="mc-date" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
      </LabelledField>
      <LabelledField label="Module affected" htmlFor="mc-module">
        <Select id="mc-module" value={registrationId} onChange={(e) => setRegistrationId(e.target.value)}>
          <option value="">None</option>
          {registrations.map((r) => <option key={r.moduleRegistrationId} value={r.moduleRegistrationId}>{r.moduleCode} {r.moduleTitle} ({r.periodCode})</option>)}
        </Select>
      </LabelledField>
      {registrationId && (
        <LabelledField label="Effect on the module" htmlFor="mc-effect" hint="e.g. Cap module mark at 40">
          <Input id="mc-effect" value={effectDetail} onChange={(e) => setEffectDetail(e.target.value)} />
        </LabelledField>
      )}
      <Button type="submit" disabled={!enrolmentId || !caseReference.trim() || !penalty || !effectiveDate}>Record outcome</Button>
    </form>
  );
}
