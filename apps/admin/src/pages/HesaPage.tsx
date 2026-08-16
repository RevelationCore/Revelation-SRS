import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  type HesaReturn,
  type HesaValidationResult,
  type HesaSubmissionRequest,
  createHesaReturn,
  downloadHesaFile,
  getHesaReturn,
  listHesaReturns,
  requestHesaReturnSubmission,
  listHesaSubmissionRequests,
  decideHesaSubmissionRequest,
  validateHesaReturn,
} from '../api/regulatory.js';
import { ApiError } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';
import { PageHeader, Card, CardHeader, CardBody, Button, Input, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from '@revelation-srs/ui';

export function HesaPage() {
  const { token, roles }   = useAuth();
  const canDecide = userHasAnyPermission(roles, ['regulatory:decide']);
  const [returns,   setReturns]   = useState<HesaReturn[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [creating,  setCreating]  = useState(false);
  const [yearInput, setYearInput] = useState('');
  const [selected,  setSelected]  = useState<HesaReturn | null>(null);
  const [validation, setValidation] = useState<HesaValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setReturns(await listHesaReturns());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load returns');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const year = yearInput.trim();
    if (!year) return;
    setCreating(true);
    setActionError('');
    try {
      const { returnId } = await createHesaReturn(year);
      setShowCreate(false);
      setYearInput('');
      await load();
      const r = await getHesaReturn(returnId);
      setSelected(r);
    } catch (err) {
      setActionError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to create return');
    } finally {
      setCreating(false);
    }
  }

  async function handleValidate(returnId: string) {
    setValidating(true);
    setActionError('');
    setValidation(null);
    try {
      const result = await validateHesaReturn(returnId);
      setValidation(result);
    } catch (err) {
      setActionError(err instanceof ApiError ? (err.detail ?? err.message) : 'Validation failed');
    } finally {
      setValidating(false);
    }
  }

  async function handleDownload(returnId: string) {
    setDownloading(true);
    setActionError('');
    try {
      await downloadHesaFile(returnId, token);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  }

  async function handleRequestSubmission(returnId: string) {
    setSubmitting(true);
    setActionError('');
    try {
      await requestHesaReturnSubmission(returnId, selected?.submissionReference ?? undefined);
      const r = await getHesaReturn(returnId);
      setSelected(r);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to request submission');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader title="HESA returns" actions={<Button onClick={() => setShowCreate(s => !s)}>New return</Button>} />

      {showCreate && (
        <form onSubmit={(e) => void handleCreate(e)} className="mb-4 flex items-center gap-3 bg-primary-50 rounded-lg p-4">
          <label htmlFor="hesa-year-input" className="text-sm text-neutral-700">Academic year:</label>
          <Input
            id="hesa-year-input"
            value={yearInput}
            onChange={(e) => setYearInput(e.target.value)}
            placeholder="e.g. 2025/26"
            className="w-36"
          />
          <Button type="submit" size="sm" disabled={creating}>
            {creating ? 'Creating…' : 'Create'}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowCreate(false)}>
            Cancel
          </Button>
        </form>
      )}

      {actionError && <p className="mb-4 text-sm text-danger-600">{actionError}</p>}

      <div className="grid grid-cols-3 gap-6">
        {/* Returns list */}
        <div className="col-span-1">
          {loading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : error ? (
            <p className="text-sm text-danger-600">{error}</p>
          ) : returns.length === 0 ? (
            <p className="text-sm text-neutral-600">No returns yet.</p>
          ) : (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-neutral-100">
                {returns.map(r => (
                  <li key={r.returnId}>
                    <button
                      onClick={() => { setSelected(r); setValidation(null); setActionError(''); }}
                      className={`w-full text-left px-4 py-3 text-sm hover:bg-neutral-50 ${
                        selected?.returnId === r.returnId ? 'bg-primary-50' : ''
                      }`}
                    >
                      <div className="font-medium text-neutral-900">{r.academicYear}</div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <Badge value={r.statusCode} />
                        <span className="text-xs text-neutral-600">{r.recordCount} records</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        {/* Return detail */}
        <div className="col-span-2">
          {selected ? (
            <div className="space-y-4">
              <Card>
                <CardBody>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-neutral-700">
                    Return {selected.academicYear}
                  </h2>
                  <Badge value={selected.statusCode} />
                </div>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <InfoRow label="Records"   value={String(selected.recordCount)} />
                  <InfoRow label="Generated" value={new Date(selected.generatedAt).toLocaleString('en-GB')} />
                  <InfoRow label="Validated" value={selected.validatedAt
                    ? new Date(selected.validatedAt).toLocaleString('en-GB')
                    : null} />
                  <InfoRow label="Submitted" value={selected.submittedAt
                    ? new Date(selected.submittedAt).toLocaleString('en-GB')
                    : null} />
                  <InfoRow label="Reference" value={selected.submissionReference} />
                </dl>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleValidate(selected.returnId)}
                    disabled={validating}
                  >
                    {validating ? 'Validating…' : 'Validate'}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleDownload(selected.returnId)}
                    disabled={downloading}
                  >
                    {downloading ? 'Downloading…' : 'Download XML'}
                  </Button>
                  {selected.statusCode !== 'submitted' && (
                    <Button
                      size="sm"
                      className="bg-success-600 hover:bg-success-700"
                      onClick={() => void handleRequestSubmission(selected.returnId)}
                      disabled={submitting}
                    >
                      {submitting ? 'Submitting…' : 'Request approval to submit'}
                    </Button>
                  )}
                </div>
                </CardBody>
              </Card>

              {validation && (
                <div className={`rounded-lg border p-4 ${validation.isValid ? 'border-success-200 bg-success-50' : 'border-danger-200 bg-danger-50'}`}>
                  <p className={`text-sm font-semibold mb-2 ${validation.isValid ? 'text-success-800' : 'text-danger-800'}`}>
                    {validation.isValid ? 'Validation passed' : `${validation.errors.length} error(s), ${validation.warnings.length} warning(s)`}
                  </p>
                  {validation.errors.map((e, i) => (
                    <p key={i} className="text-xs text-danger-700">
                      <strong>{e.field}:</strong> {e.message}
                      {e.enrolmentId && <span className="text-danger-500"> ({e.enrolmentId})</span>}
                    </p>
                  ))}
                  {validation.warnings.map((w, i) => (
                    <p key={i} className="text-xs text-amber-700">
                      <strong>{w.field}:</strong> {w.message}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-neutral-600 py-8 text-center">Select a return to view details.</p>
          )}
        </div>
      </div>

      {canDecide && (
        <div className="mt-8">
          <HesaSubmissionRequestsQueue onDecided={load} />
        </div>
      )}
    </div>
  );
}

function HesaSubmissionRequestsQueue({ onDecided }: { onDecided: () => void }) {
  const [requests, setRequests] = useState<HesaSubmissionRequest[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [deciding, setDeciding] = useState<string | null>(null);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [busyId,   setBusyId]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setRequests(await listHesaSubmissionRequests());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load submission requests');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleDecide(workflowInstanceId: string, decisionCode: 'approved' | 'rejected') {
    setBusyId(workflowInstanceId); setError('');
    try {
      await decideHesaSubmissionRequest(workflowInstanceId, decisionCode, reasonById[workflowInstanceId]?.trim() || undefined);
      setDeciding(null);
      await load();
      onDecided();
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
                <TableHeaderCell>Academic year</TableHeaderCell>
                <TableHeaderCell>Reference</TableHeaderCell>
                <TableHeaderCell>Submitted</TableHeaderCell>
                <TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {requests.map(r => (
                <TableRow key={r.workflowInstanceId}>
                  <TableCell>{String(r.context['academicYear'] ?? '—')}</TableCell>
                  <TableCell className="font-mono text-xs">{String(r.context['submissionReference'] ?? '—')}</TableCell>
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

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 flex-shrink-0 text-neutral-500 text-xs pt-0.5">{label}</dt>
      <dd className="text-neutral-900 text-xs">{value ?? <span className="text-neutral-600">—</span>}</dd>
    </div>
  );
}
