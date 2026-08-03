import { useCallback, useEffect, useState } from 'react';
import {
  type SlcConfirmationRecord,
  type SlcSubmissionRequest,
  generateSlcConfirmations,
  requestSlcSubmission,
  listSlcSubmissionRequests,
  decideSlcSubmissionRequest,
} from '../api/regulatory.js';
import { ApiError } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';
import {
  PageHeader, Button, Card, CardBody, CardHeader, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';

type Step = 'idle' | 'previewing' | 'preview' | 'requesting' | 'requested';

export function SlcPage() {
  const { roles } = useAuth();
  const canDecide = userHasAnyPermission(roles, ['regulatory:decide']);

  const [step,     setStep]     = useState<Step>('idle');
  const [records,  setRecords]  = useState<SlcConfirmationRecord[]>([]);
  const [error,    setError]    = useState('');

  async function handlePreview() {
    (document.activeElement as HTMLElement | null)?.blur();
    setStep('previewing'); setError('');
    try {
      const result = await generateSlcConfirmations({ dryRun: true });
      setRecords(result.payload.confirmations);
      setStep('preview');
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to preview confirmations');
      setStep('idle');
    }
  }

  async function handleRequestSubmission() {
    (document.activeElement as HTMLElement | null)?.blur();
    setStep('requesting'); setError('');
    try {
      await requestSlcSubmission();
      setStep('requested');
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to request submission');
      setStep('preview');
    }
  }

  function handleReset() {
    setStep('idle'); setRecords([]); setError('');
  }

  return (
    <div>
      <PageHeader title="SLC loan data & triggers" />

      <div className="max-w-4xl space-y-6">

        {/* Step indicator */}
        <div className="flex items-center gap-3">
          {(['preview', 'review', 'request approval'] as const).map((label, i) => {
            const active = (i === 0 && (step === 'previewing' || step === 'preview')) ||
                           (i === 1 && step === 'preview') ||
                           (i === 2 && (step === 'requesting' || step === 'requested'));
            const done   = (i === 0 && step !== 'idle' && step !== 'previewing') ||
                           (i === 2 && step === 'requested');
            return (
              <span key={label} className="flex items-center gap-2">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  done    ? 'bg-success-500 text-white' :
                  active  ? 'bg-primary-600 text-white' :
                            'bg-neutral-200 text-neutral-500'
                }`}>
                  {done ? '✓' : i + 1}
                </span>
                <span className={`text-sm ${active || done ? 'text-neutral-900 font-medium' : 'text-neutral-600'}`}>
                  {label === 'preview' ? 'Preview' : label === 'review' ? 'Review records' : 'Request approval'}
                </span>
                {i < 2 && <span className="text-neutral-300 mx-1">›</span>}
              </span>
            );
          })}
        </div>

        {error && <p className="text-sm text-danger-600">{error}</p>}

        {/* Step 1 — idle */}
        {step === 'idle' && (
          <Card>
            <CardBody>
              <h2 className="text-sm font-semibold text-neutral-700 mb-2">Enrolment confirmations</h2>
              <p className="text-sm text-neutral-600 mb-4">
                This process collects all pending SLC triggers (new enrolments, withdrawals, and
                intermissions) and generates confirmation records for transmission to the Student
                Loans Company. Preview the records, then request approval — a regulatory officer
                must approve the exact batch previewed before it is transmitted.
              </p>
              <Button onClick={() => void handlePreview()}>Preview confirmations</Button>
            </CardBody>
          </Card>
        )}

        {/* Step 1 — loading preview */}
        {step === 'previewing' && (
          <div className="flex items-center gap-3 py-8 text-sm text-neutral-500">
            <Spinner /> Loading pending triggers…
          </div>
        )}

        {/* Step 2 — review */}
        {(step === 'preview' || step === 'requesting' || step === 'requested') && (
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-neutral-50 border-b border-neutral-200">
              <span className="text-sm font-medium text-neutral-700">
                {records.length} confirmation{records.length !== 1 ? 's' : ''} pending
                {step === 'requested' && ' — submitted for approval'}
              </span>
              {step === 'requested' && (
                <span className="text-xs text-warning-700 font-medium">Awaiting regulatory officer approval</span>
              )}
            </div>

            {records.length === 0 ? (
              <p className="px-4 py-6 text-sm text-neutral-600">No pending SLC triggers found.</p>
            ) : (
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>SLC Reference</TableHeaderCell>
                    <TableHeaderCell>Type</TableHeaderCell>
                    <TableHeaderCell>Mode</TableHeaderCell>
                    <TableHeaderCell>Fee</TableHeaderCell>
                    <TableHeaderCell>Start date</TableHeaderCell>
                    <TableHeaderCell>Expected end</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {records.map(r => (
                    <TableRow key={r.triggerId}>
                      <TableCell className="font-mono text-xs text-neutral-700">{r.slcReference}</TableCell>
                      <TableCell><Badge value={r.confirmationType} /></TableCell>
                      <TableCell className="text-xs">{r.modeOfStudyCode}</TableCell>
                      <TableCell className="text-xs">{r.feeAmount ?? '—'}</TableCell>
                      <TableCell className="text-xs">{r.startDate}</TableCell>
                      <TableCell className="text-xs">{r.expectedEndDate ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        )}

        {/* Step 3 — actions */}
        {step === 'preview' && (
          <div className="flex items-center gap-3">
            <Button onClick={() => void handleRequestSubmission()} disabled={records.length === 0}>
              Request approval to submit {records.length} confirmation{records.length !== 1 ? 's' : ''}
            </Button>
            <Button variant="ghost" onClick={handleReset}>Cancel</Button>
          </div>
        )}

        {step === 'requesting' && (
          <div className="flex items-center gap-3 text-sm text-neutral-500">
            <Spinner /> Submitting for approval…
          </div>
        )}

        {step === 'requested' && (
          <div className="flex items-center gap-3">
            <p className="text-sm text-neutral-700">
              Submission request created. It will appear below (and to any regulatory officer)
              until decided.
            </p>
            <Button variant="ghost" onClick={handleReset}>Start new batch</Button>
          </div>
        )}

      </div>

      {canDecide && (
        <div className="max-w-4xl mt-8">
          <SubmissionRequestsQueue />
        </div>
      )}
    </div>
  );
}

function SubmissionRequestsQueue() {
  const [requests, setRequests] = useState<SlcSubmissionRequest[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [deciding, setDeciding] = useState<string | null>(null);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [busyId,   setBusyId]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setRequests(await listSlcSubmissionRequests());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load submission requests');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleDecide(workflowInstanceId: string, decisionCode: 'approved' | 'rejected') {
    setBusyId(workflowInstanceId); setError('');
    try {
      await decideSlcSubmissionRequest(workflowInstanceId, decisionCode, reasonById[workflowInstanceId]?.trim() || undefined);
      setDeciding(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? (e.detail ?? e.message) : 'Failed to record decision');
    } finally { setBusyId(null); }
  }

  return (
    <Card>
      <CardHeader
        title="Pending submission requests"
        actions={<Button variant="secondary" size="sm" onClick={() => void load()}>Refresh</Button>}
      />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        {loading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : requests.length === 0 ? (
          <p className="text-sm text-neutral-600">No pending submission requests.</p>
        ) : (
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Records</TableHeaderCell>
                <TableHeaderCell>Submitted</TableHeaderCell>
                <TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {requests.map(r => (
                <TableRow key={r.workflowInstanceId}>
                  <TableCell>{r.recordCount}</TableCell>
                  <TableCell className="text-neutral-500">
                    {new Date(r.startedAt).toLocaleDateString('en-GB')}
                  </TableCell>
                  <TableCell className="text-right">
                    {deciding === r.workflowInstanceId ? (
                      <div className="inline-flex flex-col items-end gap-2">
                        <input
                          type="text"
                          placeholder="Reason (optional)"
                          className="rounded border border-neutral-300 px-2 py-1 text-xs w-56"
                          value={reasonById[r.workflowInstanceId] ?? ''}
                          onChange={(e) => setReasonById(v => ({ ...v, [r.workflowInstanceId]: e.target.value }))}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={busyId === r.workflowInstanceId}
                            className="bg-success-600 hover:bg-success-700"
                            onClick={() => void handleDecide(r.workflowInstanceId, 'approved')}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="border-danger-300 text-danger-700 hover:bg-danger-50"
                            disabled={busyId === r.workflowInstanceId}
                            onClick={() => void handleDecide(r.workflowInstanceId, 'rejected')}
                          >
                            Reject
                          </Button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => setDeciding(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button type="button" variant="secondary" size="sm" onClick={() => setDeciding(r.workflowInstanceId)}>
                        Decide
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}
