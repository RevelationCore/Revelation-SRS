import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Card, CardHeader, CardBody, Button, Input, Select, LabelledField, Badge, Spinner, StatusNotice,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';

import { api, ApiError } from '../api/client.js';
import {
  type AwardRecommendation, type ProgressionDecision, type ReassessmentPlan, type AwardTypeCode,
  listAwardRecommendations, recommendAward, conferAward, withdrawAwardRecommendation,
  listReassessmentPlans, createReassessmentPlan, closeReassessmentPlan, listProgressionHistory,
} from '../api/awards.js';
import { type ExamBoard, listExamBoards } from '../api/examBoards.js';
import { type ModuleRegistration, listAllModuleRegistrations } from '../api/registrations.js';
import { useAuth } from '../auth/AuthContext.js';
import { EnrolmentScoped } from '../components/EnrolmentScoped.js';
import { useValueSet } from '../hooks/useValueSet.js';
import { AwardDocumentsSection } from './AwardDocumentsSection.js';
import { ProgressionSection } from './ProgressionSection.js';

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? (err.detail ?? err.message) : fallback;
}

export interface AwardsTabPermissions {
  canRecommend: boolean;
  canConfer: boolean;
  canReadPlans: boolean;
  canWritePlans: boolean;
  canReadBoards: boolean;
  /** Optional so existing callers keep working; default false. */
  canRunProgression?: boolean;
  canIssueDocuments?: boolean;
  canRevokeDocuments?: boolean;
  canReadDocuments?: boolean;
}

interface Classification { aggregateMark: number; classificationCode: string; boundariesApplied: Array<{ code: string; minimumMark: number }> }

/**
 * The award for one enrolment (BPR-D14; BP-06-003): a ratified board's
 * recommendation, conferred by someone other than the recommender, and
 * the reassessment plans that follow a ratified progression decision
 * (BP-06-002). The API enforces every rule; the tab shows only the
 * actions open at each stage and explains a refusal.
 */
export function AwardsTab({ personId, permissions }: { personId: string; permissions: AwardsTabPermissions }) {
  return (
    <EnrolmentScoped personId={personId} idPrefix="awards">
      {(enrolment) => (
        <>
          <ProgressionSection enrolmentId={enrolment.enrolmentId} canRun={permissions.canRunProgression ?? false} />
          <AwardRecommendations enrolmentId={enrolment.enrolmentId} permissions={permissions} />
          {permissions.canReadPlans && <ReassessmentPlans enrolmentId={enrolment.enrolmentId} canWrite={permissions.canWritePlans} />}
        </>
      )}
    </EnrolmentScoped>
  );
}

function AwardRecommendations({ enrolmentId, permissions }: { enrolmentId: string; permissions: AwardsTabPermissions }) {
  const { user } = useAuth();
  const [recommendations, setRecommendations] = useState<AwardRecommendation[] | null>(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    try { setRecommendations(await listAwardRecommendations(enrolmentId)); } catch (err) { setError(message(err, 'Failed to load award recommendations')); }
  }, [enrolmentId]);
  useEffect(() => { void load(); }, [load]);

  const act = useCallback(async (run: () => Promise<unknown>): Promise<boolean> => {
    setActionError('');
    try { await run(); await load(); return true; } catch (err) { setActionError(message(err, 'The action failed')); return false; }
  }, [load]);

  if (error) return <p className="text-sm text-danger-600" role="alert">{error}</p>;
  if (!recommendations) return <div className="flex justify-center py-8"><Spinner /></div>;
  const open = recommendations.find((r) => r.statusCode === 'recommended');
  const conferred = recommendations.find((r) => r.statusCode === 'conferred');

  return (
    <>
    <Card>
      <CardHeader
        title="Award"
        description="A ratified award board recommends the award; someone other than the recommender confers it under delegated authority."
      />
      <CardBody>
        <div className="flex flex-col gap-4">
          {actionError && <p className="text-sm text-danger-600" role="alert">{actionError}</p>}
          {recommendations.length === 0 ? <p className="text-sm text-neutral-600">No award has been recommended.</p> : (
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Award</TableHeaderCell><TableHeaderCell>Classification</TableHeaderCell>
                  <TableHeaderCell>Recommended</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {recommendations.map((r) => (
                  <TableRow key={r.recommendationId}>
                    <TableCell>{r.qualificationCode}<div className="text-xs text-neutral-500">{r.awardTypeCode}</div></TableCell>
                    <TableCell>
                      {r.classificationCode}
                      {r.calculatedClassificationCode && r.calculatedClassificationCode !== r.classificationCode && (
                        <div className="text-xs text-neutral-500">Calculated {r.calculatedClassificationCode}; discretion: {r.discretionReason}</div>
                      )}
                      {r.aggregateMark !== null && <div className="text-xs text-neutral-500">Aggregate {r.aggregateMark}</div>}
                    </TableCell>
                    <TableCell className="text-xs">{r.recommendedBy}<div>{new Date(r.recommendedAt).toLocaleDateString('en-GB')}</div></TableCell>
                    <TableCell>
                      <Badge value={r.statusCode} />
                      {r.conferment && <div className="text-xs text-neutral-500">Conferred {r.conferment.confermentDate} ({r.conferment.authorityRef})</div>}
                      {r.withdrawnReason && <div className="text-xs text-neutral-500">{r.withdrawnReason}</div>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {open && permissions.canConfer && (
            open.recommendedBy === user?.sub
              ? <StatusNotice>You recommended this award, so someone else must confer it.</StatusNotice>
              : <ConferForm onSubmit={(body) => act(() => conferAward(open.recommendationId, body))} />
          )}
          {open && permissions.canRecommend && (
            <WithdrawForm onSubmit={(reason) => act(() => withdrawAwardRecommendation(open.recommendationId, reason))} />
          )}
          {!open && !conferred && permissions.canRecommend && (
            <RecommendForm
              enrolmentId={enrolmentId}
              canReadBoards={permissions.canReadBoards}
              onSubmit={(body) => act(() => recommendAward(enrolmentId, body))}
            />
          )}
        </div>
      </CardBody>
    </Card>
    {conferred?.conferment && permissions.canReadDocuments && (
      <AwardDocumentsSection
        awardId={conferred.conferment.awardId}
        canIssue={permissions.canIssueDocuments ?? false}
        canRevoke={permissions.canRevokeDocuments ?? false}
      />
    )}
    </>
  );
}

function RecommendForm({ enrolmentId, canReadBoards, onSubmit }: {
  enrolmentId: string; canReadBoards: boolean; onSubmit: (body: Parameters<typeof recommendAward>[1]) => Promise<boolean>;
}) {
  const { members: awardTypes } = useValueSet('award_recommendation', 'award_type_code');
  const [boards, setBoards] = useState<ExamBoard[]>([]);
  const [classification, setClassification] = useState<Classification | null>(null);
  const [awardType, setAwardType] = useState<AwardTypeCode>('standard');
  const [boardId, setBoardId] = useState('');
  const [qualification, setQualification] = useState('');
  const [classificationCode, setClassificationCode] = useState('');
  const [discretion, setDiscretion] = useState('');
  const [authority, setAuthority] = useState('');

  useEffect(() => {
    if (!canReadBoards) return;
    listExamBoards().then((b) => setBoards(b.filter((x) => x.ratifiedAt))).catch(() => undefined);
    api.get<Classification>(`/api/v1/enrolments/${enrolmentId}/classification`)
      .then((c) => { setClassification(c); setClassificationCode((v) => v || c.classificationCode); })
      .catch(() => undefined);
  }, [enrolmentId, canReadBoards]);

  const calculatedAward = awardType === 'standard' || awardType === 'exit';
  const differs = calculatedAward && classification !== null && classificationCode !== classification.classificationCode;

  function submit(e: FormEvent) {
    e.preventDefault();
    void onSubmit({
      awardTypeCode: awardType, qualificationCode: qualification.trim(), classificationCode: classificationCode.trim(), examBoardId: boardId,
      ...(discretion.trim() ? { discretionReason: discretion.trim() } : {}), ...(authority.trim() ? { authorityRef: authority.trim() } : {}),
    });
  }

  return (
    <form className="grid grid-cols-1 gap-3 items-end md:grid-cols-3" onSubmit={submit}>
      <p className="text-sm font-medium md:col-span-3">Recommend an award</p>
      {classification && (
        <p className="text-sm text-neutral-600 md:col-span-3">
          Calculated classification: <strong>{classification.classificationCode}</strong> (aggregate {classification.aggregateMark}).
        </p>
      )}
      <LabelledField label="Award type" htmlFor="award-type" required>
        <Select id="award-type" value={awardType} onChange={(e) => setAwardType(e.target.value as AwardTypeCode)}>
          {awardTypes.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
        </Select>
      </LabelledField>
      <LabelledField label="Recommending exam board" htmlFor="award-board" required hint="A ratified board covering this enrolment">
        {boards.length > 0 ? (
          <Select id="award-board" value={boardId} onChange={(e) => setBoardId(e.target.value)}>
            <option value="">Choose…</option>
            {boards.map((b) => (
              <option key={b.examBoardId} value={b.examBoardId}>
                {b.boardTypeCode} board {b.academicYear}{b.periodCode ? ` ${b.periodCode}` : ''} (ratified {new Date(b.ratifiedAt!).toLocaleDateString('en-GB')})
              </option>
            ))}
          </Select>
        ) : (
          <Input id="award-board" value={boardId} onChange={(e) => setBoardId(e.target.value.trim())} placeholder="Exam board ID" />
        )}
      </LabelledField>
      <LabelledField label="Qualification" htmlFor="award-qualification" required hint="e.g. BSc (Hons)">
        <Input id="award-qualification" value={qualification} onChange={(e) => setQualification(e.target.value)} />
      </LabelledField>
      <LabelledField label="Classification" htmlFor="award-classification" required>
        <Input id="award-classification" list="award-classification-codes" value={classificationCode} onChange={(e) => setClassificationCode(e.target.value)} />
        <datalist id="award-classification-codes">
          {(classification?.boundariesApplied ?? []).map((b) => <option key={b.code} value={b.code} />)}
        </datalist>
      </LabelledField>
      {differs && (
        <div className="md:col-span-2">
          <LabelledField label="Discretion reason" htmlFor="award-discretion" required hint="Needed because this differs from the calculated classification">
            <Input id="award-discretion" value={discretion} onChange={(e) => setDiscretion(e.target.value)} />
          </LabelledField>
        </div>
      )}
      {!calculatedAward && (
        <div className="md:col-span-2">
          <LabelledField label="Policy authority" htmlFor="award-authority" required hint={`The regulation that allows a ${awardType} award`}>
            <Input id="award-authority" value={authority} onChange={(e) => setAuthority(e.target.value)} />
          </LabelledField>
        </div>
      )}
      <Button type="submit" disabled={!boardId || !qualification.trim() || !classificationCode.trim()}>Recommend award</Button>
    </form>
  );
}

function ConferForm({ onSubmit }: { onSubmit: (body: { confermentDate: string; authorityRef: string }) => Promise<boolean> }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [authority, setAuthority] = useState('');
  return (
    <form className="flex flex-wrap items-end gap-3 rounded border border-neutral-200 p-3" onSubmit={(e) => { e.preventDefault(); void onSubmit({ confermentDate: date, authorityRef: authority.trim() }); }}>
      <p className="w-full text-sm font-medium">Confer the award</p>
      <LabelledField label="Conferment date" htmlFor="confer-date" required>
        <Input id="confer-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </LabelledField>
      <LabelledField label="Delegated authority" htmlFor="confer-authority" required hint="e.g. Senate delegation 2026/4">
        <Input id="confer-authority" value={authority} onChange={(e) => setAuthority(e.target.value)} className="w-72" />
      </LabelledField>
      <Button type="submit" disabled={!date || !authority.trim()}>Confer award</Button>
    </form>
  );
}

function WithdrawForm({ onSubmit }: { onSubmit: (reason: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open) return <div><Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Withdraw recommendation</Button></div>;
  return (
    <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void onSubmit(reason.trim()).then((ok) => { if (ok) setOpen(false); }); }}>
      <LabelledField label="Reason for withdrawing" htmlFor="withdraw-reason" required>
        <Input id="withdraw-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="w-96" />
      </LabelledField>
      <Button type="submit" variant="secondary" disabled={!reason.trim()}>Withdraw</Button>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </form>
  );
}

function ReassessmentPlans({ enrolmentId, canWrite }: { enrolmentId: string; canWrite: boolean }) {
  const [plans, setPlans] = useState<ReassessmentPlan[] | null>(null);
  const [decisions, setDecisions] = useState<ProgressionDecision[]>([]);
  const [registrations, setRegistrations] = useState<ModuleRegistration[]>([]);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    try {
      setPlans(await listReassessmentPlans(enrolmentId));
    } catch (err) { setError(message(err, 'Failed to load reassessment plans')); }
  }, [enrolmentId]);
  useEffect(() => {
    void load();
    if (canWrite) {
      listProgressionHistory(enrolmentId).then((d) => setDecisions(d.filter((x) => x.recordedUntil === null))).catch(() => undefined);
      listAllModuleRegistrations(enrolmentId).then(setRegistrations).catch(() => undefined);
    }
  }, [load, enrolmentId, canWrite]);

  const act = useCallback(async (run: () => Promise<unknown>): Promise<boolean> => {
    setActionError('');
    try { await run(); await load(); return true; } catch (err) { setActionError(message(err, 'The action failed')); return false; }
  }, [load]);

  if (error) return <p className="text-sm text-danger-600" role="alert">{error}</p>;
  if (!plans) return <div className="flex justify-center py-8"><Spinner /></div>;
  const moduleName = (id: string | null) => {
    const r = registrations.find((x) => x.moduleRegistrationId === id);
    return r ? `${r.moduleCode} ${r.moduleTitle}` : (id ?? 'Whole stage');
  };
  const ratified = decisions.filter((d) => d.locked && ['resit', 'repeat-year'].includes(d.decisionCode));

  return (
    <Card>
      <CardHeader title="Reassessment plans" description="Further attempts that follow a ratified resit or repeat-year progression decision. A deferral keeps first-attempt treatment." />
      <CardBody>
        <div className="flex flex-col gap-4">
          {actionError && <p className="text-sm text-danger-600" role="alert">{actionError}</p>}
          {plans.length === 0 ? <p className="text-sm text-neutral-600">No reassessment plans.</p> : (
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Plan</TableHeaderCell><TableHeaderCell>Module</TableHeaderCell><TableHeaderCell>Attempt</TableHeaderCell>
                  <TableHeaderCell>Due</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell><TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {plans.map((p) => (
                  <TableRow key={p.reassessmentPlanId}>
                    <TableCell>{p.planTypeCode}</TableCell>
                    <TableCell className="text-sm">{moduleName(p.moduleRegistrationId)}</TableCell>
                    <TableCell>{p.attemptNumber}{p.markCap !== null ? <div className="text-xs text-neutral-500">Capped at {p.markCap}</div> : null}</TableCell>
                    <TableCell className="text-sm">{p.dueDate ?? '—'}</TableCell>
                    <TableCell><Badge value={p.statusCode} />{p.outcomeNote && <div className="text-xs text-neutral-500">{p.outcomeNote}</div>}</TableCell>
                    <TableCell className="text-right">
                      {canWrite && p.statusCode === 'planned' && (
                        <ClosePlan plan={p} onClose={(body) => act(() => closeReassessmentPlan(p.reassessmentPlanId, body))} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {canWrite && (ratified.length > 0
            ? <PlanForm decisions={ratified} registrations={registrations} onSubmit={(decisionId, body) => act(() => createReassessmentPlan(decisionId, body))} />
            : <p className="text-sm text-neutral-600">A plan can be added once a resit or repeat-year progression decision has been ratified.</p>)}
        </div>
      </CardBody>
    </Card>
  );
}

function PlanForm({ decisions, registrations, onSubmit }: {
  decisions: ProgressionDecision[]; registrations: ModuleRegistration[];
  onSubmit: (decisionId: string, body: Parameters<typeof createReassessmentPlan>[1]) => Promise<boolean>;
}) {
  const { members: planTypes } = useValueSet('reassessment_plan', 'plan_type_code');
  const [decisionId, setDecisionId] = useState(decisions[0]?.progressionDecisionId ?? '');
  const [planType, setPlanType] = useState('');
  const [registrationId, setRegistrationId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [markCap, setMarkCap] = useState('');
  const wholeStage = planType === 'repeat-stage';

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await onSubmit(decisionId, {
      planTypeCode: planType, ...(!wholeStage && registrationId ? { moduleRegistrationId: registrationId } : {}),
      ...(dueDate ? { dueDate } : {}), ...(markCap ? { markCap: Number(markCap) } : {}),
    });
    if (ok) { setPlanType(''); setRegistrationId(''); setDueDate(''); setMarkCap(''); }
  }

  return (
    <form className="grid grid-cols-1 gap-3 items-end md:grid-cols-3" onSubmit={(e) => void submit(e)}>
      <p className="text-sm font-medium md:col-span-3">Add a reassessment plan</p>
      <LabelledField label="Progression decision" htmlFor="plan-decision" required>
        <Select id="plan-decision" value={decisionId} onChange={(e) => setDecisionId(e.target.value)}>
          {decisions.map((d) => <option key={d.progressionDecisionId} value={d.progressionDecisionId}>{d.academicYear}: {d.decisionCode}</option>)}
        </Select>
      </LabelledField>
      <LabelledField label="Plan" htmlFor="plan-type" required>
        <Select id="plan-type" value={planType} onChange={(e) => setPlanType(e.target.value)}>
          <option value="">Choose…</option>
          {planTypes.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
        </Select>
      </LabelledField>
      {!wholeStage && (
        <LabelledField label="Module" htmlFor="plan-module" required>
          <Select id="plan-module" value={registrationId} onChange={(e) => setRegistrationId(e.target.value)}>
            <option value="">Choose…</option>
            {registrations.map((r) => <option key={r.moduleRegistrationId} value={r.moduleRegistrationId}>{r.moduleCode} {r.moduleTitle} ({r.periodCode})</option>)}
          </Select>
        </LabelledField>
      )}
      <LabelledField label="Due date" htmlFor="plan-due">
        <Input id="plan-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </LabelledField>
      <LabelledField label="Mark cap" htmlFor="plan-cap" hint="Leave empty for the configured resit cap">
        <Input id="plan-cap" type="number" min={0} max={100} value={markCap} onChange={(e) => setMarkCap(e.target.value)} />
      </LabelledField>
      <Button type="submit" disabled={!decisionId || !planType || (!wholeStage && !registrationId)}>Add plan</Button>
    </form>
  );
}

function ClosePlan({ plan, onClose }: { plan: ReassessmentPlan; onClose: (body: { statusCode: 'completed' | 'expired' | 'cancelled'; note?: string }) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<'completed' | 'expired' | 'cancelled'>('completed');
  const [note, setNote] = useState('');
  const id = `close-${plan.reassessmentPlanId}`;
  if (!open) return <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Close<span className="sr-only"> {plan.planTypeCode} plan</span></Button>;
  return (
    <form className="inline-flex flex-col items-end gap-2" onSubmit={(e) => { e.preventDefault(); void onClose({ statusCode: status, ...(note.trim() ? { note: note.trim() } : {}) }).then((ok) => { if (ok) setOpen(false); }); }}>
      <LabelledField label="Outcome" htmlFor={`${id}-status`}>
        <Select id={`${id}-status`} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="completed">Completed</option>
          <option value="expired">Expired</option>
          <option value="cancelled">Cancelled</option>
        </Select>
      </LabelledField>
      <LabelledField label="Note" htmlFor={`${id}-note`}>
        <Input id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} />
      </LabelledField>
      <div className="flex gap-2">
        <Button type="submit" size="sm">Close plan</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}
