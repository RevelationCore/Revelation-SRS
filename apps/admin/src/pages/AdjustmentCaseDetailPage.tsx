import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  PageHeader, Card, CardHeader, CardBody, Button, Input, Select, LabelledField, Badge,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, Spinner,
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@revelation-srs/ui';
import {
  type AdjustmentCaseDetail,
  getAdjustmentCase, startAssessment, requestReview, closeAdjustmentCase,
  recordAssessment, recordPanelDecision, approveAdjustmentCase, rejectAdjustmentCase,
  deleteEvidence,
} from '../api/adjustmentCases.js';
import { uploadEvidence, downloadEvidence, ApiError } from '../api/wellbeingModule.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';

const STATUS_LABELS: Record<string, string> = {
  referral_received:  'Referral received',
  assessment_pending: 'Assessment pending',
  under_assessment:   'Under assessment',
  determination_made: 'Determination made',
  under_review:        'Under review (panel)',
  approved:            'Approved',
  rejected:            'Rejected',
  review_complete:     'Review complete',
  closed:              'Closed',
};

type Tab = 'overview' | 'assessments' | 'panel-approval' | 'evidence';

export function AdjustmentCaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const { roles }  = useAuth();
  const canAssess  = userHasAnyPermission(roles, ['adjustment-case:assess']);
  const canManage  = userHasAnyPermission(roles, ['adjustment-case:manage']);
  const canDecide  = userHasAnyPermission(roles, ['panel-decision:write']);

  const [c, setC]             = useState<AdjustmentCaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [tab, setTab]         = useState<Tab>('overview');
  const [actionError, setActionError] = useState('');
  const [actionBusy, setActionBusy]   = useState(false);

  const load = useCallback(async () => {
    if (!caseId) return;
    setLoading(true); setError('');
    try {
      setC(await getAdjustmentCase(caseId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load adjustment case');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => { void load(); }, [load]);

  async function runAction(action: () => Promise<unknown>) {
    setActionBusy(true); setActionError('');
    try {
      await action();
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? (err.detail ?? err.message) : 'Action failed');
    } finally {
      setActionBusy(false);
    }
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (error)    return <p className="text-sm text-danger-600 py-8">{error}</p>;
  if (!c || !caseId) return null;

  const canStartAssessment = canAssess && ['referral_received', 'assessment_pending'].includes(c.statusCode);
  const canRecordAssessment = canAssess && c.statusCode === 'under_assessment';
  const canRecordPanelDecision = canDecide;
  const canApproveOrReject = canDecide && ['determination_made', 'under_review'].includes(c.statusCode);
  const canRequestReview = canManage && ['approved', 'rejected'].includes(c.statusCode);
  const canClose = canManage && c.statusCode !== 'closed';

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Adjustment cases', to: '/governance/adjustment-cases' }]}
        title={<span className="capitalize">{c.adjustmentTypeCode.replace(/-/g, ' ')} adjustment</span>}
        description={<span className="font-mono text-xs">{caseId}</span>}
        actions={
          <div className="flex items-center gap-3">
            <Badge value={c.statusCode} label={STATUS_LABELS[c.statusCode] ?? c.statusCode} />
            {canClose && (
              <Button size="sm" variant="ghost" disabled={actionBusy} onClick={() => void runAction(() => closeAdjustmentCase(caseId))}>
                Close case
              </Button>
            )}
            {canRequestReview && (
              <Button size="sm" variant="ghost" disabled={actionBusy} onClick={() => void runAction(() => requestReview(caseId))}>
                Reopen for review
              </Button>
            )}
          </div>
        }
      />

      {actionError && <p className="mb-3 text-sm text-danger-600">{actionError}</p>}

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="mb-6">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="assessments">Assessment</TabsTrigger>
          <TabsTrigger value="panel-approval">Panel &amp; approval</TabsTrigger>
          <TabsTrigger value="evidence">Evidence ({c.evidence.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card>
            <CardHeader title="Case details" />
            <CardBody>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <InfoRow label="Person" value={c.personId} mono />
                <InfoRow label="Wellbeing case" value={c.wellbeingCaseId} mono />
                <InfoRow label="Disability support case" value={c.disabilitySupportCaseId} mono />
                <InfoRow label="Adjustment type" value={c.adjustmentTypeCode} />
                <InfoRow label="Rationale" value={c.rationale} />
                <InfoRow label="Recommended adjustment" value={c.recommendedAdjustment} />
                <InfoRow label="SRS application ref" value={c.srsApplicationRef} mono />
                <InfoRow label="SRS handoff status" value={c.srsHandoffStatus} />
              </dl>
              {canStartAssessment && (
                <div className="mt-4">
                  <Button disabled={actionBusy} onClick={() => void runAction(() => startAssessment(caseId))}>
                    Start assessment
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>
        </TabsContent>

        <TabsContent value="assessments">
          <div className="space-y-6">
            {canRecordAssessment && (
              <AssessmentForm caseId={caseId} onRecorded={() => void load()} />
            )}
            <Card>
              <CardHeader title="Assessment history" />
              <CardBody>
                {c.assessments.length === 0 ? (
                  <p className="text-sm text-neutral-600">No assessments recorded yet.</p>
                ) : (
                  <Table>
                    <TableHead>
                      <tr>
                        <TableHeaderCell>Assessor</TableHeaderCell>
                        <TableHeaderCell>Date</TableHeaderCell>
                        <TableHeaderCell>Outcome</TableHeaderCell>
                        <TableHeaderCell>Findings</TableHeaderCell>
                      </tr>
                    </TableHead>
                    <TableBody>
                      {c.assessments.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="font-mono text-xs">{a.assessorId}</TableCell>
                          <TableCell className="text-xs">{new Date(a.assessedAt).toLocaleDateString('en-GB')}</TableCell>
                          <TableCell><Badge value={a.outcomeCode} /></TableCell>
                          <TableCell className="text-xs">{a.findings ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardBody>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="panel-approval">
          <div className="space-y-6">
            {canRecordPanelDecision && (
              <PanelDecisionForm caseId={caseId} onRecorded={() => void load()} />
            )}
            {c.panelDecision && (
              <Card>
                <CardHeader title="Panel decision" />
                <CardBody>
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                    <InfoRow label="Panel chair" value={c.panelDecision.panelChairId} mono />
                    <InfoRow label="Date" value={new Date(c.panelDecision.panelDate).toLocaleDateString('en-GB')} />
                    <InfoRow label="Decision" value={c.panelDecision.decisionCode} />
                    <InfoRow label="Rationale" value={c.panelDecision.decisionRationale} />
                  </dl>
                </CardBody>
              </Card>
            )}
            {canApproveOrReject && (
              <ApproveRejectForm caseId={caseId} onDone={() => void load()} />
            )}
          </div>
        </TabsContent>

        <TabsContent value="evidence">
          <EvidenceSection caseId={caseId} canManage={canManage} evidence={c.evidence} onChanged={() => void load()} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-48 flex-shrink-0 text-neutral-500 text-xs pt-0.5">{label}</dt>
      <dd className={`text-neutral-900 text-xs ${mono ? 'font-mono' : ''}`}>{value ?? <span className="text-neutral-600">—</span>}</dd>
    </div>
  );
}

function AssessmentForm({ caseId, onRecorded }: { caseId: string; onRecorded: () => void }) {
  const { user } = useAuth();
  const [assessedAt, setAssessedAt]   = useState(new Date().toISOString().slice(0, 10));
  const [outcomeCode, setOutcomeCode] = useState('recommended');
  const [findings, setFindings]       = useState('');
  const [recommendedAction, setRecommendedAction] = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      await recordAssessment(caseId, {
        assessorId: user?.sub ?? '',
        assessedAt: new Date(assessedAt).toISOString(),
        outcomeCode,
        ...(findings.trim() ? { findings: findings.trim() } : {}),
        ...(recommendedAction.trim() ? { recommendedAction: recommendedAction.trim() } : {}),
      });
      setFindings(''); setRecommendedAction('');
      onRecorded();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to record assessment');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Record a needs assessment" />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-2 gap-3 items-end">
          <LabelledField label="Assessed on" htmlFor="assess-date">
            <Input id="assess-date" type="date" value={assessedAt} onChange={(e) => setAssessedAt(e.target.value)} />
          </LabelledField>
          <LabelledField label="Outcome" htmlFor="assess-outcome">
            <Select id="assess-outcome" value={outcomeCode} onChange={(e) => setOutcomeCode(e.target.value)}>
              <option value="recommended">Recommended</option>
              <option value="not-recommended">Not recommended</option>
              <option value="deferred">Deferred</option>
              <option value="referred-to-panel">Refer to panel</option>
            </Select>
          </LabelledField>
          <div className="col-span-2">
            <LabelledField label="Findings" htmlFor="assess-findings">
              <Input id="assess-findings" value={findings} onChange={(e) => setFindings(e.target.value)} />
            </LabelledField>
          </div>
          <div className="col-span-2">
            <LabelledField label="Recommended action" htmlFor="assess-action">
              <Input id="assess-action" value={recommendedAction} onChange={(e) => setRecommendedAction(e.target.value)} />
            </LabelledField>
          </div>
          <div className="col-span-2">
            <Button type="submit" disabled={submitting}>{submitting ? 'Recording…' : 'Record assessment'}</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function PanelDecisionForm({ caseId, onRecorded }: { caseId: string; onRecorded: () => void }) {
  const { user } = useAuth();
  const [panelDate, setPanelDate]         = useState(new Date().toISOString().slice(0, 10));
  const [decisionCode, setDecisionCode]   = useState('upheld');
  const [decisionRationale, setDecisionRationale] = useState('');
  const [submitting, setSubmitting]       = useState(false);
  const [error, setError]                 = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      await recordPanelDecision(caseId, {
        panelChairId: user?.sub ?? '',
        panelDate: new Date(panelDate).toISOString(),
        decisionCode,
        ...(decisionRationale.trim() ? { decisionRationale: decisionRationale.trim() } : {}),
      });
      setDecisionRationale('');
      onRecorded();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to record panel decision');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Record a panel decision" />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-2 gap-3 items-end">
          <LabelledField label="Panel date" htmlFor="panel-date">
            <Input id="panel-date" type="date" value={panelDate} onChange={(e) => setPanelDate(e.target.value)} />
          </LabelledField>
          <LabelledField label="Decision" htmlFor="panel-decision">
            <Select id="panel-decision" value={decisionCode} onChange={(e) => setDecisionCode(e.target.value)}>
              <option value="upheld">Upheld</option>
              <option value="modified">Modified</option>
              <option value="rejected">Rejected</option>
            </Select>
          </LabelledField>
          <div className="col-span-2">
            <LabelledField label="Rationale" htmlFor="panel-rationale">
              <Input id="panel-rationale" value={decisionRationale} onChange={(e) => setDecisionRationale(e.target.value)} />
            </LabelledField>
          </div>
          <div className="col-span-2">
            <Button type="submit" disabled={submitting}>{submitting ? 'Recording…' : 'Record panel decision'}</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function ApproveRejectForm({ caseId, onDone }: { caseId: string; onDone: () => void }) {
  const [mode, setMode] = useState<'approve' | 'reject'>('approve');
  const [enrolmentId, setEnrolmentId] = useState('');
  const [scopeCode, setScopeCode]     = useState('all');
  const [recommendedAdjustment, setRecommendedAdjustment] = useState('');
  const [validFrom, setValidFrom]     = useState(new Date().toISOString().slice(0, 10));
  const [rationale, setRationale]     = useState('');
  const [forceApprove, setForceApprove] = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState('');
  const [result, setResult]           = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError(''); setResult('');
    try {
      if (mode === 'reject') {
        await rejectAdjustmentCase(caseId, rationale.trim());
        setResult('Case rejected.');
      } else {
        const res = await approveAdjustmentCase(caseId, {
          enrolmentId: enrolmentId.trim(),
          scopeCode,
          recommendedAdjustment: recommendedAdjustment.trim(),
          validFrom: new Date(validFrom).toISOString(),
          forceApprove,
        });
        setResult(res.status === 'already_sent' ? 'Already distributed to SRS.' : 'Approved and submitted to SRS.');
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Action failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Approve or reject" />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        {result && <p className="mb-3 text-sm text-success-700">{result}</p>}
        <div className="mb-4 flex gap-2" role="radiogroup" aria-label="Decision">
          <Button type="button" size="sm" variant={mode === 'approve' ? 'primary' : 'secondary'} onClick={() => setMode('approve')}>Approve</Button>
          <Button type="button" size="sm" variant={mode === 'reject' ? 'primary' : 'secondary'} onClick={() => setMode('reject')}>Reject</Button>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-2 gap-3 items-end">
          {mode === 'approve' ? (
            <>
              <LabelledField label="Enrolment ID" htmlFor="approve-enrolment" required>
                <Input id="approve-enrolment" value={enrolmentId} onChange={(e) => setEnrolmentId(e.target.value)} />
              </LabelledField>
              <LabelledField label="Scope" htmlFor="approve-scope">
                <Select id="approve-scope" value={scopeCode} onChange={(e) => setScopeCode(e.target.value)}>
                  <option value="all">All</option>
                  <option value="exam">Exam</option>
                  <option value="coursework">Coursework</option>
                  <option value="attendance">Attendance</option>
                </Select>
              </LabelledField>
              <div className="col-span-2">
                <LabelledField label="Recommended adjustment" htmlFor="approve-recommended" required>
                  <Input id="approve-recommended" value={recommendedAdjustment} onChange={(e) => setRecommendedAdjustment(e.target.value)} />
                </LabelledField>
              </div>
              <LabelledField label="Valid from" htmlFor="approve-valid-from">
                <Input id="approve-valid-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
              </LabelledField>
              <label className="flex items-center gap-2 text-sm text-neutral-700">
                <input type="checkbox" checked={forceApprove} onChange={(e) => setForceApprove(e.target.checked)} />
                Force approve (skip module-registration check)
              </label>
            </>
          ) : (
            <div className="col-span-2">
              <LabelledField label="Rationale" htmlFor="reject-rationale" required>
                <Input id="reject-rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} />
              </LabelledField>
            </div>
          )}
          <div className="col-span-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Submitting…' : mode === 'approve' ? 'Approve case' : 'Reject case'}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function EvidenceSection({
  caseId, canManage, evidence, onChanged,
}: {
  caseId: string;
  canManage: boolean;
  evidence: AdjustmentCaseDetail['evidence'];
  onChanged: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [evidenceTypeCode, setEvidenceTypeCode] = useState('assessor-report');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true); setError('');
    try {
      await uploadEvidence(caseId, file, evidenceTypeCode);
      setFile(null);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to upload evidence');
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(evidenceId: string) {
    setError('');
    try {
      await deleteEvidence(caseId, evidenceId);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to delete evidence');
    }
  }

  // A plain <a href> navigation wouldn't carry the Authorization header
  // the wellbeing module requires, so fetch the blob (via the same
  // Bearer-token client every other call uses) and hand the browser a
  // save via a temporary object URL instead.
  async function handleDownload(evidenceId: string, filenameHint: string) {
    setError('');
    try {
      const blob = await downloadEvidence(caseId, evidenceId);
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = filenameHint;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to download evidence');
    }
  }

  return (
    <div className="space-y-6">
      {canManage && (
        <Card>
          <CardHeader title="Upload evidence" description="A DSA medical letter, specialist assessor report, or other supporting document. Stored with a checksum and access log." />
          <CardBody>
            {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
            <form onSubmit={(e) => void handleUpload(e)} className="grid grid-cols-2 gap-3 items-end">
              <LabelledField label="Evidence type" htmlFor="evidence-type">
                <Select id="evidence-type" value={evidenceTypeCode} onChange={(e) => setEvidenceTypeCode(e.target.value)}>
                  <option value="medical-letter">Medical letter</option>
                  <option value="assessor-report">Assessor report</option>
                  <option value="dsa-award-letter">DSA award letter</option>
                  <option value="other">Other</option>
                </Select>
              </LabelledField>
              <LabelledField label="File" htmlFor="evidence-file" required>
                <input
                  id="evidence-file"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-neutral-700 file:mr-3 file:rounded-md file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-700 hover:file:bg-primary-100"
                />
              </LabelledField>
              <div className="col-span-2">
                <Button type="submit" disabled={uploading || !file}>{uploading ? 'Uploading…' : 'Upload'}</Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Evidence on file" />
        <CardBody>
          {evidence.length === 0 ? (
            <p className="text-sm text-neutral-600">No evidence uploaded yet.</p>
          ) : (
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Type</TableHeaderCell>
                  <TableHeaderCell>Uploaded by</TableHeaderCell>
                  <TableHeaderCell>Uploaded</TableHeaderCell>
                  <TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {evidence.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell><Badge value={e.evidenceTypeCode} /></TableCell>
                    <TableCell className="font-mono text-xs">{e.uploadedBy}</TableCell>
                    <TableCell className="text-xs">{new Date(e.uploadedAt).toLocaleString('en-GB')}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => void handleDownload(e.id, `${e.evidenceTypeCode}-${e.id.slice(0, 8)}`)}
                          className="text-sm text-primary-600 hover:underline"
                        >
                          Download
                        </button>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => void handleDelete(e.id)}
                            className="text-sm text-danger-600 hover:underline"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
