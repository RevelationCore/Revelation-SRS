import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Card, CardHeader, CardBody, Button, Input, Select, LabelledField, Spinner,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import { type ProgrammeSummary, listProgrammes } from '../api/applications.js';
import type { Enrolment } from '../api/enrolments.js';
import { type OpenStatusCaseInput, type StatusCase, type StatusCaseType, listEnrolmentStatusCases, openStatusCase } from '../api/statusCases.js';
import { EnrolmentScoped } from '../components/EnrolmentScoped.js';
import { useValueSet } from '../hooks/useValueSet.js';
import { CASE_TYPE_LABELS, CaseStatusBadge } from './StatusCasesPage.js';

/** The enrolment's status cases, and opening one on the student's behalf or the institution's (BP-02-006 to 009, 012). */
export function StatusCasesTab({ personId, canOpen }: { personId: string; canOpen: boolean }) {
  return (
    <EnrolmentScoped personId={personId} idPrefix="status-cases">
      {(enrolment) => <EnrolmentStatusCases enrolment={enrolment} canOpen={canOpen} />}
    </EnrolmentScoped>
  );
}

function EnrolmentStatusCases({ enrolment, canOpen }: { enrolment: Enrolment; canOpen: boolean }) {
  const [cases, setCases] = useState<StatusCase[] | null>(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    try { setCases(await listEnrolmentStatusCases(enrolment.enrolmentId)); } catch (err) { setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to load status cases'); }
  }, [enrolment.enrolmentId]);
  useEffect(() => { void load(); }, [load]);

  if (error) return <p className="text-sm text-danger-600" role="alert">{error}</p>;
  if (!cases) return <div className="flex justify-center py-8"><Spinner /></div>;
  const openCase = cases.find((c) => c.statusCode === 'requested');
  const approvedBreaks = cases.filter((c) => c.statusCode === 'approved' && (c.caseTypeCode === 'interruption' || c.caseTypeCode === 'suspension'));

  return (
    <Card>
      <CardHeader
        title="Status changes"
        description={`Enrolment status: ${enrolment.statusCode}. Interruptions, suspensions, returns, withdrawals, transfers and leaver closures go through a case; the enrolment changes only when the case is approved.`}
      />
      <CardBody>
        <div className="flex flex-col gap-4">
          {actionError && <p className="text-sm text-danger-600" role="alert">{actionError}</p>}
          {cases.length === 0 ? <p className="text-sm text-neutral-600">No status cases for this enrolment.</p> : (
            <Table>
              <TableHead>
                <tr><TableHeaderCell>Case</TableHeaderCell><TableHeaderCell>From</TableHeaderCell><TableHeaderCell>Requested by</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell><TableHeaderCell><span className="sr-only">Open</span></TableHeaderCell></tr>
              </TableHead>
              <TableBody>
                {cases.map((c) => (
                  <TableRow key={c.statusCaseId}>
                    <TableCell>{CASE_TYPE_LABELS[c.caseTypeCode] ?? c.caseTypeCode}{c.decisionReason && <div className="text-xs text-neutral-500">{c.decisionReason}</div>}</TableCell>
                    <TableCell className="text-sm">{c.approvedEffectiveDate ?? c.requestedEffectiveDate}{c.approvedReturnDate ? ` – ${c.approvedReturnDate}` : ''}</TableCell>
                    <TableCell className="text-sm capitalize">{c.initiatedByCode}</TableCell>
                    <TableCell><CaseStatusBadge status={c.statusCode} /></TableCell>
                    <TableCell className="text-right">
                      <Link to={`/status-cases/${c.statusCaseId}`} className="text-sm text-primary-600 hover:underline">View<span className="sr-only"> {CASE_TYPE_LABELS[c.caseTypeCode]} case</span></Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {canOpen && (openCase
            ? <p className="text-sm text-neutral-600">This enrolment has an open case; a new one can be opened once it is decided or closed.</p>
            : <OpenCaseForm approvedBreaks={approvedBreaks} onSubmit={async (body) => {
              setActionError('');
              try { await openStatusCase(enrolment.enrolmentId, body); await load(); return true; } catch (err) { setActionError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to open the case'); return false; }
            }} />)}
        </div>
      </CardBody>
    </Card>
  );
}

function OpenCaseForm({ approvedBreaks, onSubmit }: { approvedBreaks: StatusCase[]; onSubmit: (body: OpenStatusCaseInput) => Promise<boolean> }) {
  const { members: types } = useValueSet('student_status_case', 'case_type_code');
  const { members: reasons } = useValueSet('student_status_case', 'reason_category_code');
  const { members: modes } = useValueSet('enrolment', 'mode_of_study_code');
  const [programmes, setProgrammes] = useState<ProgrammeSummary[]>([]);
  const [type, setType] = useState<StatusCaseType | ''>('');
  const [initiatedBy, setInitiatedBy] = useState<'student' | 'institution'>('student');
  const [reason, setReason] = useState('');
  const [effective, setEffective] = useState('');
  const [expectedReturn, setExpectedReturn] = useState('');
  const [programmeId, setProgrammeId] = useState('');
  const [mode, setMode] = useState('');
  const [relatedCaseId, setRelatedCaseId] = useState(approvedBreaks[0]?.statusCaseId ?? '');
  const [outcomeRef, setOutcomeRef] = useState('');

  useEffect(() => { listProgrammes().then(setProgrammes).catch(() => undefined); }, []);
  const needsOutcome = type === 'suspension' || (type === 'withdrawal' && initiatedBy === 'institution');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!type) return;
    const ok = await onSubmit({
      caseTypeCode: type, initiatedByCode: type === 'suspension' ? 'institution' : initiatedBy, requestedEffectiveDate: effective,
      ...(reason ? { reasonCategoryCode: reason } : {}),
      ...(type === 'interruption' && expectedReturn ? { expectedReturnDate: expectedReturn } : {}),
      ...(type === 'transfer' && programmeId ? { destinationProgrammeId: programmeId } : {}),
      ...(type === 'transfer' && mode ? { destinationModeOfStudyCode: mode } : {}),
      ...(type === 'return' && relatedCaseId ? { relatedCaseId } : {}),
      ...(needsOutcome && outcomeRef.trim() ? { institutionalOutcomeRef: outcomeRef.trim() } : {}),
    });
    if (ok) { setType(''); setReason(''); setEffective(''); setExpectedReturn(''); setProgrammeId(''); setMode(''); setOutcomeRef(''); }
  }

  const incomplete = !type || !effective
    || (type === 'interruption' && !expectedReturn)
    || (type === 'transfer' && !programmeId && !mode)
    || (type === 'return' && !relatedCaseId)
    || (needsOutcome && !outcomeRef.trim());

  return (
    <form className="grid grid-cols-1 gap-3 items-end md:grid-cols-3" onSubmit={(e) => void submit(e)}>
      <p className="text-sm font-medium md:col-span-3">Open a status case</p>
      <LabelledField label="Case" htmlFor="open-case-type" required>
        <Select id="open-case-type" value={type} onChange={(e) => setType(e.target.value as StatusCaseType | '')}>
          <option value="">Choose…</option>
          {types.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
        </Select>
      </LabelledField>
      {type !== 'suspension' && (
        <LabelledField label="Requested by" htmlFor="open-case-initiator">
          <Select id="open-case-initiator" value={initiatedBy} onChange={(e) => setInitiatedBy(e.target.value as 'student' | 'institution')}>
            <option value="student">The student (recorded on their behalf)</option>
            <option value="institution">The institution</option>
          </Select>
        </LabelledField>
      )}
      <LabelledField label="Reason" htmlFor="open-case-reason">
        <Select id="open-case-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="">Not given</option>
          {reasons.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
        </Select>
      </LabelledField>
      <LabelledField label="From" htmlFor="open-case-effective" required>
        <Input id="open-case-effective" type="date" value={effective} onChange={(e) => setEffective(e.target.value)} />
      </LabelledField>
      {type === 'interruption' && (
        <LabelledField label="Expected return" htmlFor="open-case-return" required hint="An interruption is time-bound">
          <Input id="open-case-return" type="date" value={expectedReturn} onChange={(e) => setExpectedReturn(e.target.value)} />
        </LabelledField>
      )}
      {type === 'transfer' && (
        <>
          <LabelledField label="Destination programme" htmlFor="open-case-programme">
            <Select id="open-case-programme" value={programmeId} onChange={(e) => setProgrammeId(e.target.value)}>
              <option value="">Unchanged</option>
              {programmes.map((p) => <option key={p.programmeId} value={p.programmeId}>{p.code} — {p.title}</option>)}
            </Select>
          </LabelledField>
          <LabelledField label="Destination mode of study" htmlFor="open-case-mode">
            <Select id="open-case-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="">Unchanged</option>
              {modes.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
            </Select>
          </LabelledField>
        </>
      )}
      {type === 'return' && (
        <LabelledField label="Returning from" htmlFor="open-case-related" required>
          {approvedBreaks.length > 0 ? (
            <Select id="open-case-related" value={relatedCaseId} onChange={(e) => setRelatedCaseId(e.target.value)}>
              {approvedBreaks.map((c) => <option key={c.statusCaseId} value={c.statusCaseId}>{CASE_TYPE_LABELS[c.caseTypeCode]} from {c.approvedEffectiveDate}</option>)}
            </Select>
          ) : <p id="open-case-related" className="text-sm text-neutral-600">No approved interruption or suspension to return from.</p>}
        </LabelledField>
      )}
      {needsOutcome && (
        <LabelledField label="Authorising outcome" htmlFor="open-case-outcome" required hint="e.g. the misconduct, fitness-to-study or non-engagement outcome reference">
          <Input id="open-case-outcome" value={outcomeRef} onChange={(e) => setOutcomeRef(e.target.value)} />
        </LabelledField>
      )}
      <Button type="submit" disabled={incomplete}>Open case</Button>
    </form>
  );
}
