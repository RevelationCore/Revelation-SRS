import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Card, CardHeader, CardBody, Button, PageHeader, LabelledField, Input, Select, Badge,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';
import {
  type ExaminationCase,
  type ExaminerAppointment,
  type ExaminerReport,
  type VivaEvent,
  type ExaminationOutcomeRecord,
  type CorrectionRequirement,
  type PgrThesisFormat,
  type PgrExaminerRole,
  type PgrExaminationOutcome,
  submitThesis,
  getExaminationCase,
  nominateExaminer,
  listExaminerAppointments,
  recordIndependenceCheck,
  declareExaminerConflict,
  recuseExaminer,
  approveExaminerPanel,
  recordExaminerReport,
  listExaminerReports,
  recordViva,
  getViva,
  ratifyOutcome,
  getLatestOutcome,
  listCorrectionRequirements,
  completeCorrectionRequirement,
} from '../api/pgr.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { ApiError } from '../api/client.js';
import { Spinner } from '../components/Spinner.js';

const CORRECTIONS_REQUIRED = new Set(['pass-minor-corrections', 'pass-major-corrections', 'resubmission']);

export function PgrExaminationPage() {
  const [examinationCase, setExaminationCase] = useState<ExaminationCase | null>(null);

  return (
    <div>
      <PageHeader
        title="PGR thesis examination"
        description="Submit a thesis, nominate and approve examiners, record reports and the viva, and ratify the outcome."
      />
      <div className="space-y-6 mt-4">
        {!examinationCase && <SubmitThesisForm onSubmitted={setExaminationCase} />}
        {examinationCase && (
          <ExaminationWorkspace
            examinationCase={examinationCase}
            onRefresh={setExaminationCase}
            onStartNew={() => setExaminationCase(null)}
          />
        )}
      </div>
    </div>
  );
}

function SubmitThesisForm({ onSubmitted }: { onSubmitted: (c: ExaminationCase) => void }) {
  const { user } = useAuth();
  const [enrolmentId, setEnrolmentId] = useState('');
  const [formatCode, setFormatCode]   = useState<PgrThesisFormat>('traditional');
  const [storageRef, setStorageRef]   = useState('');
  const [declarationConfirmed, setDeclarationConfirmed] = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      const { examinationCaseId } = await submitThesis({
        enrolmentId: enrolmentId.trim(),
        ownerId: user?.sub ?? '',
        formatCode,
        declarationConfirmed,
        storageRef: storageRef.trim(),
      });
      onSubmitted(await getExaminationCase(examinationCaseId));
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to submit thesis');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="Submit a thesis" />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-2 gap-3 items-end">
          <LabelledField label="Enrolment ID" htmlFor="ex-enrolment" required>
            <Input id="ex-enrolment" value={enrolmentId} onChange={(e) => setEnrolmentId(e.target.value)} />
          </LabelledField>
          <LabelledField label="Format" htmlFor="ex-format">
            <Select id="ex-format" value={formatCode} onChange={(e) => setFormatCode(e.target.value as PgrThesisFormat)}>
              <option value="traditional">Traditional thesis</option>
              <option value="practice-based">Practice-based submission</option>
              <option value="published-work">Published-work submission</option>
            </Select>
          </LabelledField>
          <LabelledField label="Storage reference" htmlFor="ex-storage" required>
            <Input id="ex-storage" value={storageRef} onChange={(e) => setStorageRef(e.target.value)} placeholder="repo://thesis/..." />
          </LabelledField>
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" checked={declarationConfirmed} onChange={(e) => setDeclarationConfirmed(e.target.checked)} />
            Declarations confirmed
          </label>
          <div className="col-span-2">
            <Button type="submit" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit thesis'}</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function ExaminationWorkspace({
  examinationCase, onRefresh, onStartNew,
}: {
  examinationCase: ExaminationCase;
  onRefresh:       (c: ExaminationCase) => void;
  onStartNew:      () => void;
}) {
  const { roles } = useAuth();
  const canDecide = userHasAnyPermission(roles, ['pgr-case:decide']);
  const [appointments, setAppointments] = useState<ExaminerAppointment[]>([]);
  const [reports, setReports]           = useState<ExaminerReport[]>([]);
  const [viva, setViva]                 = useState<VivaEvent | null>(null);
  const [outcome, setOutcome]           = useState<ExaminationOutcomeRecord | null>(null);
  const [requirements, setRequirements] = useState<CorrectionRequirement[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [detail, appointmentList, reportList, vivaEvent, latestOutcome] = await Promise.all([
        getExaminationCase(examinationCase.examinationCaseId),
        listExaminerAppointments(examinationCase.examinationCaseId),
        listExaminerReports(examinationCase.examinationCaseId),
        getViva(examinationCase.examinationCaseId),
        getLatestOutcome(examinationCase.examinationCaseId),
      ]);
      onRefresh(detail);
      setAppointments(appointmentList);
      setReports(reportList);
      setViva(vivaEvent);
      setOutcome(latestOutcome);
      if (latestOutcome) {
        setRequirements(await listCorrectionRequirements(latestOutcome.outcomeId));
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load examination case');
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examinationCase.examinationCaseId]);

  useEffect(() => { void load(); }, [load]);

  const status = examinationCase.statusCode;
  const isSubmitted = status === 'submitted';
  const isConfirmed = status === 'examiners-confirmed';
  const isVivaHeld = status === 'viva-held';
  const isDecided = !isSubmitted && !isConfirmed && !isVivaHeld;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={`Examination ${examinationCase.examinationCaseId.slice(0, 8)}…`}
          actions={
            <div className="flex items-center gap-2">
              <Badge value={status} />
              <Button variant="ghost" size="sm" onClick={onStartNew}>Start a new examination</Button>
            </div>
          }
        />
        <CardBody>
          {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
          <InfoRow label="Enrolment" value={examinationCase.enrolmentId} mono />
        </CardBody>
      </Card>

      {isSubmitted && <NominateExaminerForm caseId={examinationCase.examinationCaseId} onNominated={load} />}

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : (
        <Card>
          <CardHeader title="Examiners" />
          <CardBody>
            {appointments.length === 0 ? (
              <p className="text-sm text-neutral-600">No examiners nominated yet.</p>
            ) : (
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Person</TableHeaderCell>
                    <TableHeaderCell>Role</TableHeaderCell>
                    <TableHeaderCell>Independence</TableHeaderCell>
                    <TableHeaderCell>Conflict</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {appointments.map((a) => (
                    <ExaminerRow key={a.appointmentId} appointment={a} editable={isSubmitted} onChanged={load} />
                  ))}
                </TableBody>
              </Table>
            )}
            {isSubmitted && canDecide && (
              <div className="mt-4">
                <Button size="sm" onClick={() => void approveExaminerPanel(examinationCase.examinationCaseId).then(load).catch((e: unknown) => setError(e instanceof ApiError ? (e.detail ?? e.message) : 'Failed to approve panel'))}>
                  Approve panel
                </Button>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {isConfirmed && (
        <ReportForm caseId={examinationCase.examinationCaseId} appointments={appointments} onRecorded={load} />
      )}

      {(isConfirmed || isVivaHeld || isDecided) && reports.length > 0 && (
        <Card>
          <CardHeader title="Examiner reports" />
          <CardBody>
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Examiner</TableHeaderCell>
                  <TableHeaderCell>Report</TableHeaderCell>
                  <TableHeaderCell>Recommendation</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {reports.map((r) => (
                  <TableRow key={r.reportId}>
                    <TableCell className="font-mono text-xs">{r.examinerAppointmentId}</TableCell>
                    <TableCell className="text-xs">{r.reportRef}</TableCell>
                    <TableCell>{r.recommendationCode ? <Badge value={r.recommendationCode} /> : <span className="text-neutral-500 text-xs">—</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardBody>
        </Card>
      )}

      {isConfirmed && <VivaForm caseId={examinationCase.examinationCaseId} onRecorded={load} />}

      {isVivaHeld && viva && (
        <Card>
          <CardHeader title="Viva" />
          <CardBody>
            <InfoRow label="Held" value={new Date(viva.heldAt).toLocaleString('en-GB')} />
            <InfoRow label="Joint recommendation" value={viva.jointRecommendationText} />
          </CardBody>
        </Card>
      )}

      {isVivaHeld && canDecide && (
        <OutcomeForm caseId={examinationCase.examinationCaseId} onRatified={load} />
      )}

      {isDecided && outcome && (
        <Card>
          <CardHeader title="Ratified outcome" actions={<Badge value={outcome.outcomeCode} />} />
          <CardBody>
            <InfoRow label="Decided by" value={outcome.decidedBy} />
            <InfoRow label="Decided at" value={new Date(outcome.decidedAt).toLocaleString('en-GB')} />
            {CORRECTIONS_REQUIRED.has(outcome.outcomeCode) && (
              <div className="mt-4">
                <h3 className="text-sm font-semibold text-neutral-700 mb-2">Corrections</h3>
                {requirements.length === 0 ? (
                  <p className="text-sm text-neutral-600">No correction requirement recorded.</p>
                ) : (
                  requirements.map((r) => (
                    <CorrectionRow key={r.requirementId} requirement={r} onChanged={load} />
                  ))
                )}
              </div>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function ExaminerRow({
  appointment, editable, onChanged,
}: {
  appointment: ExaminerAppointment;
  editable:    boolean;
  onChanged:   () => void;
}) {
  const [conflictTypeCode, setConflictTypeCode] = useState('');
  const [declaring, setDeclaring] = useState(false);
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState('');

  async function handleCheck() {
    setBusy(true); setError('');
    try { await recordIndependenceCheck(appointment.appointmentId); onChanged(); }
    catch (err) { setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed'); }
    finally { setBusy(false); }
  }

  async function handleDeclare() {
    setBusy(true); setError('');
    try { await declareExaminerConflict(appointment.appointmentId, conflictTypeCode.trim()); setDeclaring(false); onChanged(); }
    catch (err) { setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed'); }
    finally { setBusy(false); }
  }

  async function handleRecuse() {
    setBusy(true); setError('');
    try { await recuseExaminer(appointment.appointmentId); onChanged(); }
    catch (err) { setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed'); }
    finally { setBusy(false); }
  }

  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{appointment.personId}</TableCell>
      <TableCell><Badge value={appointment.examinerRoleCode} /></TableCell>
      <TableCell className="text-xs">
        {appointment.independenceCheckedAt
          ? new Date(appointment.independenceCheckedAt).toLocaleDateString('en-GB')
          : <span className="text-neutral-500">Not checked</span>}
      </TableCell>
      <TableCell className="text-xs">
        {appointment.conflictTypeCode
          ? (appointment.recusedAt ? <span className="text-success-700">Resolved</span> : <span className="text-danger-600">{appointment.conflictTypeCode}</span>)
          : <span className="text-neutral-500">None</span>}
        {error && <p className="text-danger-600">{error}</p>}
      </TableCell>
      <TableCell className="text-xs">
        {appointment.recusedAt ? <span className="text-neutral-500">Recused</span>
          : appointment.confirmedAt ? <span className="text-success-700">Confirmed</span> : <span className="text-neutral-500">Proposed</span>}
      </TableCell>
      <TableCell className="text-right">
        {editable && !appointment.recusedAt && !appointment.independenceCheckedAt && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void handleCheck()}>Check independence</Button>
        )}
        {editable && !appointment.recusedAt && !appointment.conflictTypeCode && (
          declaring ? (
            <div className="inline-flex items-center gap-2 ml-2">
              <input type="text" placeholder="e.g. supervisory" className="rounded border border-neutral-300 px-2 py-1 text-xs w-28"
                value={conflictTypeCode} onChange={(e) => setConflictTypeCode(e.target.value)} />
              <Button size="sm" disabled={busy} onClick={() => void handleDeclare()}>Declare</Button>
              <Button size="sm" variant="ghost" onClick={() => setDeclaring(false)}>Cancel</Button>
            </div>
          ) : (
            <Button size="sm" variant="secondary" className="ml-2" onClick={() => setDeclaring(true)}>Declare conflict</Button>
          )
        )}
        {editable && appointment.conflictTypeCode && !appointment.recusedAt && (
          <Button size="sm" variant="secondary" className="ml-2" disabled={busy} onClick={() => void handleRecuse()}>Recuse</Button>
        )}
      </TableCell>
    </TableRow>
  );
}

function NominateExaminerForm({ caseId, onNominated }: { caseId: string; onNominated: () => void }) {
  const [personId, setPersonId] = useState('');
  const [examinerRoleCode, setExaminerRoleCode] = useState<PgrExaminerRole>('internal');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]       = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      await nominateExaminer(caseId, { personId: personId.trim(), examinerRoleCode });
      setPersonId('');
      onNominated();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to nominate examiner');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="Nominate an examiner" />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-3 gap-3 items-end">
          <LabelledField label="Person ID" htmlFor="ex-examiner-person" required>
            <Input id="ex-examiner-person" value={personId} onChange={(e) => setPersonId(e.target.value)} />
          </LabelledField>
          <LabelledField label="Role" htmlFor="ex-examiner-role">
            <Select id="ex-examiner-role" value={examinerRoleCode} onChange={(e) => setExaminerRoleCode(e.target.value as PgrExaminerRole)}>
              <option value="internal">Internal examiner</option>
              <option value="external">External examiner</option>
            </Select>
          </LabelledField>
          <div className="col-span-3">
            <Button type="submit" size="sm" variant="secondary" disabled={submitting}>
              {submitting ? 'Nominating…' : 'Nominate'}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function ReportForm({
  caseId, appointments, onRecorded,
}: {
  caseId:       string;
  appointments: ExaminerAppointment[];
  onRecorded:   () => void;
}) {
  const confirmed = appointments.filter((a) => a.confirmedAt && !a.recusedAt);
  const [examinerAppointmentId, setExaminerAppointmentId] = useState(confirmed[0]?.appointmentId ?? '');
  const [reportRef, setReportRef]     = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      await recordExaminerReport(caseId, { examinerAppointmentId, reportRef: reportRef.trim() });
      setReportRef('');
      onRecorded();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to record report');
    } finally { setSubmitting(false); }
  }

  if (confirmed.length === 0) return null;

  return (
    <Card>
      <CardHeader title="Record an examiner report" />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-3 gap-3 items-end">
          <LabelledField label="Examiner" htmlFor="ex-report-examiner">
            <Select id="ex-report-examiner" value={examinerAppointmentId} onChange={(e) => setExaminerAppointmentId(e.target.value)}>
              {confirmed.map((a) => (
                <option key={a.appointmentId} value={a.appointmentId}>{a.personId} ({a.examinerRoleCode})</option>
              ))}
            </Select>
          </LabelledField>
          <LabelledField label="Report reference" htmlFor="ex-report-ref" required>
            <Input id="ex-report-ref" value={reportRef} onChange={(e) => setReportRef(e.target.value)} placeholder="workspace://report/..." />
          </LabelledField>
          <div className="col-span-3">
            <Button type="submit" size="sm" variant="secondary" disabled={submitting}>
              {submitting ? 'Recording…' : 'Record report'}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function VivaForm({ caseId, onRecorded }: { caseId: string; onRecorded: () => void }) {
  const [heldAt, setHeldAt] = useState('');
  const [jointRecommendationText, setJointRecommendationText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      await recordViva(caseId, { heldAt: new Date(heldAt).toISOString(), jointRecommendationText: jointRecommendationText.trim() });
      onRecorded();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to record viva');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="Record the viva" />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-2 gap-3 items-end">
          <LabelledField label="Held at" htmlFor="ex-viva-held" required>
            <Input id="ex-viva-held" type="datetime-local" value={heldAt} onChange={(e) => setHeldAt(e.target.value)} />
          </LabelledField>
          <LabelledField label="Joint recommendation" htmlFor="ex-viva-recommendation" required>
            <Input id="ex-viva-recommendation" value={jointRecommendationText} onChange={(e) => setJointRecommendationText(e.target.value)} />
          </LabelledField>
          <div className="col-span-2">
            <Button type="submit" disabled={submitting}>{submitting ? 'Recording…' : 'Record viva'}</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function OutcomeForm({ caseId, onRatified }: { caseId: string; onRatified: () => void }) {
  const [outcomeCode, setOutcomeCode] = useState<PgrExaminationOutcome>('pass');
  const [correctionsDeadline, setCorrectionsDeadline] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      await ratifyOutcome(caseId, {
        outcomeCode,
        ...(correctionsDeadline.trim() ? { correctionsDeadline: correctionsDeadline.trim() } : {}),
      });
      onRatified();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to ratify outcome');
    } finally { setSubmitting(false); }
  }

  const needsDeadline = CORRECTIONS_REQUIRED.has(outcomeCode);

  return (
    <Card>
      <CardHeader title="Ratify outcome" />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-2 gap-3 items-end">
          <LabelledField label="Outcome" htmlFor="ex-outcome">
            <Select id="ex-outcome" value={outcomeCode} onChange={(e) => setOutcomeCode(e.target.value as PgrExaminationOutcome)}>
              <option value="pass">Pass</option>
              <option value="pass-minor-corrections">Pass with minor corrections</option>
              <option value="pass-major-corrections">Pass with major corrections</option>
              <option value="resubmission">Resubmission</option>
              <option value="fail">Fail</option>
            </Select>
          </LabelledField>
          {needsDeadline && (
            <LabelledField label="Corrections deadline" htmlFor="ex-corrections-deadline" required>
              <Input id="ex-corrections-deadline" type="date" value={correctionsDeadline} onChange={(e) => setCorrectionsDeadline(e.target.value)} />
            </LabelledField>
          )}
          <div className="col-span-2">
            <Button type="submit" disabled={submitting}>{submitting ? 'Ratifying…' : 'Ratify outcome'}</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function CorrectionRow({ requirement, onChanged }: { requirement: CorrectionRequirement; onChanged: () => void }) {
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  async function handleComplete() {
    setBusy(true); setError('');
    try { await completeCorrectionRequirement(requirement.requirementId); onChanged(); }
    catch (err) { setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to mark complete'); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex items-center justify-between border-t border-neutral-100 py-2 text-sm">
      <div>
        <span className="text-neutral-700">Deadline: {new Date(requirement.deadlineDate).toLocaleDateString('en-GB')}</span>
        {error && <p className="text-danger-600 text-xs">{error}</p>}
      </div>
      {requirement.completedAt ? (
        <span className="text-success-700 text-xs">Completed {new Date(requirement.completedAt).toLocaleDateString('en-GB')}</span>
      ) : (
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void handleComplete()}>Mark complete</Button>
      )}
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-40 flex-shrink-0 text-neutral-500 text-xs pt-0.5">{label}</dt>
      <dd className={`text-neutral-900 text-xs ${mono ? 'font-mono' : ''}`}>{value ?? <span className="text-neutral-600">—</span>}</dd>
    </div>
  );
}
