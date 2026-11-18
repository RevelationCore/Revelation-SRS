import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  PageHeader, Card, CardHeader, CardBody, Button, Input, Select, LabelledField, Badge, Spinner, StatusNotice, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, CodeLabel, CodeSelect, useCodes,
} from '@revelation-srs/ui';
import type { Permission } from '@revelation-srs/domain';

import { ApiError } from '../api/client.js';
import {
  type StatusCase, type StatusCaseCondition,
  getStatusCase, assessStatusCase, addStatusCaseCondition, resolveStatusCaseCondition, decideStatusCase, withdrawStatusCase,
} from '../api/statusCases.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { useValueSet } from '../hooks/useValueSet.js';
import { CaseStatusBadge } from './StatusCasesPage.js';

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? (err.detail ?? err.message) : fallback;
}

/**
 * One status case: reviewers' advice, conditions, and the registry's
 * decision. Whoever opened the case cannot decide it; a return cannot be
 * approved while the interruption's return conditions are open; a leaver
 * closure cannot be approved while its closure items are open.
 */
export function StatusCaseDetailPage() {
  const creditStatuses = useCodes('recognised_credit', 'status_code');
  const caseTypes = useCodes('student_status_case', 'case_type_code');
  const { statusCaseId } = useParams<{ statusCaseId: string }>();
  const { roles, user } = useAuth();
  const [found, setFound] = useState<StatusCase | null>(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    if (!statusCaseId) return;
    try { setFound(await getStatusCase(statusCaseId)); } catch (err) { setError(message(err, 'Failed to load the case')); }
  }, [statusCaseId]);
  useEffect(() => { void load(); }, [load]);

  const act = useCallback(async (run: () => Promise<unknown>): Promise<boolean> => {
    setActionError('');
    try { await run(); await load(); return true; } catch (err) { setActionError(message(err, 'The action failed')); return false; }
  }, [load]);

  if (error) return <p className="text-sm text-danger-600" role="alert">{error}</p>;
  if (!found) return <div className="flex justify-center py-16"><Spinner /></div>;

  const can = (p: Permission) => userHasAnyPermission(roles, [p]);
  const open = found.statusCode === 'requested';
  const subject = found.subject;
  const conditionHolder = can('status-case:write') || can('status-case:decide');

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Status cases', to: '/status-cases' }]}
        title={`${caseTypes.label(found.caseTypeCode)}: ${subject?.studentName ?? found.personId}`}
        description={[subject?.studentNumber, subject?.programmeCode].filter(Boolean).join(' · ')}
        actions={<CaseStatusBadge status={found.statusCode} />}
      />
      {actionError && <p className="mb-4 text-sm text-danger-600" role="alert">{actionError}</p>}

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader title="Request" />
          <CardBody>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
              <Fact label="Requested by">{found.initiatedByCode === 'student' ? 'The student' : 'The institution'}</Fact>
              <Fact label="Reason"><CodeLabel entity="student_status_case" field="reason_category_code" code={found.reasonCategoryCode} empty="Not given" /></Fact>
              <Fact label="From">{found.requestedEffectiveDate}</Fact>
              {found.expectedReturnDate && <Fact label="Expected return">{found.expectedReturnDate}</Fact>}
              {found.destinationProgrammeId && <Fact label="Destination programme">{found.destinationProgrammeId}</Fact>}
              {found.destinationModeOfStudyCode && <Fact label="Destination mode"><CodeLabel entity="student_status_case" field="destination_mode_of_study_code" code={found.destinationModeOfStudyCode} /></Fact>}
              {found.destinationStudyIntensityPercent !== null && found.destinationStudyIntensityPercent !== undefined && <Fact label="Destination intensity">{found.destinationStudyIntensityPercent}% of full time</Fact>}
              {found.institutionalOutcomeRef && <Fact label="Authorising outcome">{found.institutionalOutcomeRef}</Fact>}
              <Fact label="Opened">{new Date(found.createdAt).toLocaleString('en-GB')} by {found.createdBy}</Fact>
              {can('student:read:all') && subject?.personId && (
                <Fact label="Student record"><Link to={`/students/${subject.personId}`} className="text-primary-600 hover:underline">Open</Link></Fact>
              )}
            </dl>
            {(found.warnings ?? []).map((w) => (
              <p key={w} className="mt-3 text-xs text-warning-700 bg-warning-50 border border-warning-200 rounded px-3 py-2">{w}</p>
            ))}
            {(found.creditMappings ?? []).length > 0 && (
              <div className="mt-4 text-sm">
                <p className="font-medium">Credit mapped by this transfer</p>
                <ul className="ml-5 list-disc">
                  {found.creditMappings.map((c) => (
                    <li key={c.recognisedCreditId}>{c.sourceDescription}: {c.creditValue} credits ({creditStatuses.label(c.statusCode)})</li>
                  ))}
                </ul>
                <p className="text-xs text-neutral-600">A transfer is decided only once every mapping is approved or rejected, by someone other than its proposer.</p>
              </div>
            )}
            {found.decidedAt && (
              <p className="mt-4 text-sm">
                {found.statusCode === 'approved' ? 'Approved' : found.statusCode === 'rejected' ? 'Rejected' : 'Closed'} by {found.decidedBy} on {new Date(found.decidedAt).toLocaleDateString('en-GB')}: {found.decisionReason}
                {found.approvedEffectiveDate && ` (effective ${found.approvedEffectiveDate}${found.approvedReturnDate ? `, return ${found.approvedReturnDate}` : ''})`}
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Advice" description="Academic, destination, finance and UKVI compliance reviewers record their advice before the decision." />
          <CardBody>
            {found.assessments.length === 0 ? <p className="text-sm text-neutral-600">No advice recorded yet.</p> : (
              <Table>
                <TableHead><tr><TableHeaderCell>Reviewer</TableHeaderCell><TableHeaderCell>Advice</TableHeaderCell><TableHeaderCell>Note</TableHeaderCell><TableHeaderCell>By</TableHeaderCell></tr></TableHead>
                <TableBody>
                  {found.assessments.map((a) => (
                    <TableRow key={a.assessmentId}>
                      <TableCell><CodeLabel entity="status_case_assessment" field="assessor_role_code" code={a.assessorRoleCode} /></TableCell>
                      <TableCell><Badge value={a.outcomeCode === 'supports' ? 'approved' : a.outcomeCode === 'concerns' ? 'rejected' : 'pending'} label={a.outcomeCode} /></TableCell>
                      <TableCell className="text-sm">{a.note ?? '—'}</TableCell>
                      <TableCell className="text-xs">{a.assessedBy}<div>{new Date(a.assessedAt).toLocaleDateString('en-GB')}</div></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {open && can('status-case:assess') && <AdviceForm onSubmit={(body) => act(() => assessStatusCase(found.statusCaseId, body))} />}
          </CardBody>
        </Card>

        {found.outstandingReturnConditions.length > 0 && (
          <Card>
            <CardHeader title="Return conditions still open" description="Set when the interruption was approved. The return can be approved once each is met or waived." />
            <CardBody>
              <ConditionsTable conditions={found.outstandingReturnConditions} canResolve={conditionHolder} act={act} />
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader title={found.caseTypeCode === 'leaver-closure' ? 'Closure items' : 'Conditions'} />
          <CardBody>
            {found.conditions.length === 0 ? <p className="text-sm text-neutral-600">None.</p> : <ConditionsTable conditions={found.conditions} canResolve={conditionHolder} act={act} />}
            {open && conditionHolder && <ConditionForm onSubmit={(body) => act(() => addStatusCaseCondition(found.statusCaseId, body))} />}
          </CardBody>
        </Card>

        {open && can('status-case:decide') && (
          found.createdBy === user?.sub
            ? <StatusNotice>You opened this case, so someone else must decide it.</StatusNotice>
            : <DecisionCard found={found} onSubmit={(body) => act(() => decideStatusCase(found.statusCaseId, body))} />
        )}
        {open && can('status-case:write') && (
          <div><Button variant="secondary" size="sm" onClick={() => void act(() => withdrawStatusCase(found.statusCaseId))}>Close case without a decision</Button></div>
        )}
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt className="text-xs text-neutral-500">{label}</dt><dd className="mt-0.5">{children}</dd></div>;
}

function AdviceForm({ onSubmit }: { onSubmit: (body: { assessorRoleCode: string; outcomeCode: string; note?: string }) => Promise<boolean> }) {
  const { members: roles } = useValueSet('status_case_assessment', 'assessor_role_code');
  const { members: outcomes } = useValueSet('status_case_assessment', 'outcome_code');
  const [role, setRole] = useState('');
  const [outcome, setOutcome] = useState('');
  const [note, setNote] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await onSubmit({ assessorRoleCode: role, outcomeCode: outcome, ...(note.trim() ? { note: note.trim() } : {}) })) { setRole(''); setOutcome(''); setNote(''); }
  }
  return (
    <form className="mt-4 grid grid-cols-1 gap-3 items-end md:grid-cols-4" onSubmit={(e) => void submit(e)}>
      <LabelledField label="Advising as" htmlFor="advice-role" required>
        <Select id="advice-role" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Choose…</option>
          {roles.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
        </Select>
      </LabelledField>
      <LabelledField label="Advice" htmlFor="advice-outcome" required>
        <Select id="advice-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="">Choose…</option>
          {outcomes.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
        </Select>
      </LabelledField>
      <LabelledField label="Note" htmlFor="advice-note">
        <Input id="advice-note" value={note} onChange={(e) => setNote(e.target.value)} />
      </LabelledField>
      <Button type="submit" disabled={!role || !outcome}>Record advice</Button>
    </form>
  );
}

function ConditionsTable({ conditions, canResolve, act }: {
  conditions: StatusCaseCondition[]; canResolve: boolean; act: (run: () => Promise<unknown>) => Promise<boolean>;
}) {
  return (
    <Table>
      <TableHead><tr><TableHeaderCell>Condition</TableHeaderCell><TableHeaderCell>Due</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell><TableHeaderCell><span className="sr-only">Resolve</span></TableHeaderCell></tr></TableHead>
      <TableBody>
        {conditions.map((c) => (
          <TableRow key={c.conditionId}>
            <TableCell>{c.description}<div className="text-xs text-neutral-500"><CodeLabel entity="status_case_condition" field="condition_type_code" code={c.conditionTypeCode} /></div></TableCell>
            <TableCell className="text-sm">{c.dueDate ?? '—'}</TableCell>
            <TableCell>
              <Badge value={c.statusCode === 'open' ? 'pending' : 'approved'} label={c.statusCode} />
              {c.resolutionNote && <div className="text-xs text-neutral-500">{c.resolutionNote}</div>}
            </TableCell>
            <TableCell className="text-right">
              {c.statusCode === 'open' && canResolve && <ResolveControl condition={c} onResolve={(body) => act(() => resolveStatusCaseCondition(c.conditionId, body))} />}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ResolveControl({ condition, onResolve }: { condition: StatusCaseCondition; onResolve: (body: { statusCode: 'met' | 'waived'; note?: string; evidenceRef?: string }) => Promise<boolean> }) {
  const [openForm, setOpenForm] = useState(false);
  const [status, setStatus] = useState<'met' | 'waived'>('met');
  const [note, setNote] = useState('');
  const [evidence, setEvidence] = useState('');
  const id = `resolve-${condition.conditionId}`;
  if (!openForm) return <Button size="sm" variant="secondary" onClick={() => setOpenForm(true)}>Resolve<span className="sr-only"> {condition.description}</span></Button>;
  return (
    <form className="inline-flex flex-col items-end gap-2" onSubmit={(e) => {
      e.preventDefault();
      void onResolve({ statusCode: status, ...(note.trim() ? { note: note.trim() } : {}), ...(evidence.trim() ? { evidenceRef: evidence.trim() } : {}) }).then((ok) => { if (ok) setOpenForm(false); });
    }}>
      <LabelledField label="Outcome" htmlFor={`${id}-status`}>
        <CodeSelect entity="status_case_condition" field="status_code" id={`${id}-status`} value={status} onChange={(v) => setStatus(v as 'met' | 'waived')} only={['met', 'waived']} />
      </LabelledField>
      <LabelledField label="Evidence reference" htmlFor={`${id}-evidence`}><Input id={`${id}-evidence`} value={evidence} onChange={(e) => setEvidence(e.target.value)} /></LabelledField>
      <LabelledField label="Note" htmlFor={`${id}-note`}><Input id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} /></LabelledField>
      <div className="flex gap-2">
        <Button type="submit" size="sm">Record</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpenForm(false)}>Cancel</Button>
      </div>
    </form>
  );
}

function ConditionForm({ onSubmit }: { onSubmit: (body: { conditionTypeCode: string; description: string; dueDate?: string }) => Promise<boolean> }) {
  const { members: types } = useValueSet('status_case_condition', 'condition_type_code');
  const [type, setType] = useState('');
  const [description, setDescription] = useState('');
  const [due, setDue] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await onSubmit({ conditionTypeCode: type, description: description.trim(), ...(due ? { dueDate: due } : {}) })) { setType(''); setDescription(''); setDue(''); }
  }
  return (
    <form className="mt-4 grid grid-cols-1 gap-3 items-end md:grid-cols-4" onSubmit={(e) => void submit(e)}>
      <LabelledField label="Condition type" htmlFor="condition-type" required>
        <Select id="condition-type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Choose…</option>
          {types.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
        </Select>
      </LabelledField>
      <LabelledField label="Description" htmlFor="condition-description" required>
        <Input id="condition-description" value={description} onChange={(e) => setDescription(e.target.value)} />
      </LabelledField>
      <LabelledField label="Due" htmlFor="condition-due">
        <Input id="condition-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </LabelledField>
      <Button type="submit" variant="secondary" disabled={!type || !description.trim()}>Add condition</Button>
    </form>
  );
}

function DecisionCard({ found, onSubmit }: { found: StatusCase; onSubmit: (body: { decisionCode: 'approved' | 'rejected'; reason: string; effectiveDate?: string; returnDate?: string }) => Promise<boolean> }) {
  const [decision, setDecision] = useState<'approved' | 'rejected'>('approved');
  const [reason, setReason] = useState('');
  const [effective, setEffective] = useState(found.requestedEffectiveDate);
  const [returnDate, setReturnDate] = useState(found.expectedReturnDate ?? '');
  const interruption = found.caseTypeCode === 'interruption';
  const concerns = found.assessments.filter((a) => a.outcomeCode === 'concerns').length;
  return (
    <Card>
      <CardHeader title="Decide" description="Approving applies the change to the enrolment; if the enrolment refuses it, the case stays open." />
      <CardBody>
        {concerns > 0 && <p className="mb-3 text-sm text-neutral-700">{concerns} reviewer(s) raised concerns.</p>}
        <form className="grid grid-cols-1 gap-3 items-end md:grid-cols-4" onSubmit={(e) => {
          e.preventDefault();
          void onSubmit({
            decisionCode: decision, reason: reason.trim(),
            ...(decision === 'approved' && effective ? { effectiveDate: effective } : {}),
            ...(decision === 'approved' && interruption && returnDate ? { returnDate } : {}),
          });
        }}>
          <LabelledField label="Decision" htmlFor="case-decision">
            <CodeSelect entity="student_status_case" field="status_code" id="case-decision" value={decision} onChange={(v) => setDecision(v as 'approved' | 'rejected')} only={['approved', 'rejected']} />
          </LabelledField>
          {decision === 'approved' && (
            <LabelledField label="Effective from" htmlFor="case-effective">
              <Input id="case-effective" type="date" value={effective} onChange={(e) => setEffective(e.target.value)} />
            </LabelledField>
          )}
          {decision === 'approved' && interruption && (
            <LabelledField label="Return date" htmlFor="case-return" required>
              <Input id="case-return" type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
            </LabelledField>
          )}
          <LabelledField label="Reason" htmlFor="case-reason" required>
            <Input id="case-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </LabelledField>
          <Button type="submit" disabled={!reason.trim() || (decision === 'approved' && interruption && !returnDate)}>Record decision</Button>
        </form>
      </CardBody>
    </Card>
  );
}
