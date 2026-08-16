import { useCallback, useEffect, useState } from 'react';
import {
  type OfsB3Extract,
  type OfsGenerationRequest,
  type OfsExtractTypeCode,
  getOfsB3Extract,
  requestOfsExtractGeneration,
  listOfsGenerationRequests,
  decideOfsGenerationRequest,
} from '../api/regulatory.js';
import { ApiError } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';
import {
  PageHeader, Button, Select, Card, CardHeader, CardBody, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@revelation-srs/ui';

const OFS_ACADEMIC_YEARS = ['2025-26', '2024-25', '2023-24', '2022-23'];

type Tab = 'b3' | 'participation';

interface ParticipationReport {
  extractId:   string;
  academicYear: string;
  recordCount: number;
  generatedAt: string;
  payload:     Record<string, unknown>;
}

// ── B3 Extract tab ────────────────────────────────────────────────────────────

function B3Tab({
  extracts, setExtracts, onRequested,
}: {
  extracts: OfsB3Extract[];
  setExtracts: React.Dispatch<React.SetStateAction<OfsB3Extract[]>>;
  onRequested: () => void;
}) {
  const [academicYear, setAcademicYear] = useState(OFS_ACADEMIC_YEARS[0]!);
  const [requesting,   setRequesting]   = useState(false);
  const [polling,      setPolling]      = useState<string | null>(null);
  const [selected,     setSelected]     = useState<OfsB3Extract | null>(null);
  const [error,        setError]        = useState('');
  const [successMsg,   setSuccessMsg]   = useState('');

  useEffect(() => {
    if (!polling) return;
    const id = setInterval(async () => {
      try {
        const ext = await getOfsB3Extract(polling);
        if (ext.statusCode !== 'pending') {
          setPolling(null);
          setExtracts(prev => prev.map(e => e.extractId === ext.extractId ? ext : e));
          if (selected?.extractId === ext.extractId) setSelected(ext);
        }
      } catch { /* keep polling */ }
    }, 3000);
    return () => clearInterval(id);
  }, [polling, selected, setExtracts]);

  async function handleRequestGeneration() {
    (document.activeElement as HTMLElement | null)?.blur();
    setRequesting(true); setError(''); setSuccessMsg('');
    try {
      await requestOfsExtractGeneration('b3-student-outcomes', academicYear);
      onRequested();
      setSuccessMsg(`Approval requested to generate the B3 extract for ${academicYear}.`);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to request B3 extract generation');
    } finally {
      setRequesting(false);
    }
  }

  function handleDownload() {
    if (!selected) return;
    const blob = new Blob([JSON.stringify(selected.payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `ofs-b3-${selected.extractId}.json`;
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-neutral-500">
        Request approval to generate the OfS B3 student data extract for a given academic year.
        Once a regulatory officer approves the request, the extract can be downloaded as JSON for
        submission to the OfS data portal.
      </p>

      <div className="flex items-center gap-3">
        <label htmlFor="ofs-b3-academic-year" className="text-sm font-medium text-neutral-700">Academic year</label>
        <Select
          id="ofs-b3-academic-year"
          value={academicYear}
          onChange={e => setAcademicYear(e.target.value)}
          className="w-auto"
        >
          {OFS_ACADEMIC_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </Select>
        <Button onClick={() => void handleRequestGeneration()} disabled={requesting} icon={requesting ? <Spinner /> : undefined}>
          {requesting ? 'Requesting…' : 'Request approval to generate'}
        </Button>
      </div>

      {error      && <p className="text-sm text-danger-600">{error}</p>}
      {successMsg && <p className="text-sm text-success-600">{successMsg}</p>}

      {extracts.length === 0 && !requesting ? (
        <p className="text-sm text-neutral-600">No extracts generated in this session.</p>
      ) : extracts.length > 0 && (
        <div className="space-y-4">
          <Card>
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Extract ID</TableHeaderCell>
                  <TableHeaderCell>Year</TableHeaderCell>
                  <TableHeaderCell>Records</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Generated</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {extracts.map(e => (
                  <TableRow
                    key={e.extractId}
                    onClick={() => setSelected(selected?.extractId === e.extractId ? null : e)}
                    className={`cursor-pointer ${selected?.extractId === e.extractId ? 'bg-primary-50' : ''}`}
                  >
                    <TableCell className="font-mono text-xs text-neutral-700">{e.extractId}</TableCell>
                    <TableCell className="text-xs">{e.academicYear ?? '—'}</TableCell>
                    <TableCell className="text-xs">{e.recordCount ?? '—'}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <Badge value={e.statusCode} />
                        {polling === e.extractId && <Spinner />}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">
                      {e.generatedAt ? new Date(e.generatedAt).toLocaleString('en-GB') : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {selected && (
            <Card>
              <CardBody>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-neutral-700">
                    Payload — {selected.academicYear} ({selected.recordCount} records)
                  </h2>
                  <Button variant="secondary" size="sm" onClick={handleDownload}>Download JSON</Button>
                </div>
                <pre className="bg-neutral-50 rounded p-3 text-xs text-neutral-700 overflow-auto max-h-96">
                  {JSON.stringify(selected.payload, null, 2)}
                </pre>
              </CardBody>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ── Participation Report tab ───────────────────────────────────────────────────

function ParticipationTab({
  reports, onRequested,
}: {
  reports: ParticipationReport[];
  onRequested: () => void;
}) {
  const [academicYear, setAcademicYear] = useState(OFS_ACADEMIC_YEARS[0]!);
  const [requesting,   setRequesting]   = useState(false);
  const [selected,     setSelected]     = useState<ParticipationReport | null>(null);
  const [error,        setError]        = useState('');
  const [successMsg,   setSuccessMsg]   = useState('');

  async function handleRequestGeneration() {
    (document.activeElement as HTMLElement | null)?.blur();
    setRequesting(true); setError(''); setSuccessMsg('');
    try {
      await requestOfsExtractGeneration('access-participation-progress', academicYear);
      onRequested();
      setSuccessMsg(`Approval requested to generate the participation report for ${academicYear}.`);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to request report generation');
    } finally {
      setRequesting(false);
    }
  }

  function handleDownload() {
    if (!selected) return;
    const blob = new Blob([JSON.stringify(selected.payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `ofs-participation-${selected.extractId}.json`;
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-neutral-500">
        Request approval to generate the OfS participation report for a given academic year. This
        report covers widening participation metrics and equality of opportunity data.
      </p>

      <div className="flex items-center gap-3">
        <label htmlFor="ofs-participation-academic-year" className="text-sm font-medium text-neutral-700">Academic year</label>
        <Select
          id="ofs-participation-academic-year"
          value={academicYear}
          onChange={e => setAcademicYear(e.target.value)}
          className="w-auto"
        >
          {OFS_ACADEMIC_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </Select>
        <Button onClick={() => void handleRequestGeneration()} disabled={requesting} icon={requesting ? <Spinner /> : undefined}>
          {requesting ? 'Requesting…' : 'Request approval to generate'}
        </Button>
      </div>

      {error      && <p className="text-sm text-danger-600">{error}</p>}
      {successMsg && <p className="text-sm text-success-600">{successMsg}</p>}

      {reports.length === 0 && !requesting ? (
        <p className="text-sm text-neutral-600">No reports generated in this session.</p>
      ) : reports.length > 0 && (
        <div className="space-y-4">
          <Card>
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Report ID</TableHeaderCell>
                  <TableHeaderCell>Year</TableHeaderCell>
                  <TableHeaderCell>Records</TableHeaderCell>
                  <TableHeaderCell>Generated</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {reports.map(r => (
                  <TableRow
                    key={r.extractId}
                    onClick={() => setSelected(selected?.extractId === r.extractId ? null : r)}
                    className={`cursor-pointer ${selected?.extractId === r.extractId ? 'bg-primary-50' : ''}`}
                  >
                    <TableCell className="font-mono text-xs text-neutral-700">{r.extractId}</TableCell>
                    <TableCell className="text-xs">{r.academicYear}</TableCell>
                    <TableCell className="text-xs">{r.recordCount}</TableCell>
                    <TableCell className="text-xs">
                      {new Date(r.generatedAt).toLocaleString('en-GB')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {selected && (
            <Card>
              <CardBody>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-neutral-700">
                    Payload — {selected.academicYear} ({selected.recordCount} records)
                  </h2>
                  <Button variant="secondary" size="sm" onClick={handleDownload}>Download JSON</Button>
                </div>
                <pre className="bg-neutral-50 rounded p-3 text-xs text-neutral-700 overflow-auto max-h-96">
                  {JSON.stringify(selected.payload, null, 2)}
                </pre>
              </CardBody>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ── Generation requests queue ────────────────────────────────────────────────

function OfsGenerationRequestsQueue({
  refreshSignal, onApproved,
}: {
  refreshSignal: number;
  onApproved: (extractTypeCode: OfsExtractTypeCode, extractId: string) => void;
}) {
  const [requests, setRequests] = useState<OfsGenerationRequest[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [deciding, setDeciding] = useState<string | null>(null);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [busyId,   setBusyId]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setRequests(await listOfsGenerationRequests());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load generation requests');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load, refreshSignal]);

  async function handleDecide(request: OfsGenerationRequest, decisionCode: 'approved' | 'rejected') {
    setBusyId(request.workflowInstanceId); setError('');
    try {
      const { extractId } = await decideOfsGenerationRequest(
        request.workflowInstanceId, decisionCode, reasonById[request.workflowInstanceId]?.trim() || undefined,
      );
      setDeciding(null);
      if (decisionCode === 'approved' && extractId) onApproved(request.context.extractTypeCode, extractId);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? (e.detail ?? e.message) : 'Failed to record decision');
    } finally { setBusyId(null); }
  }

  return (
    <Card>
      <CardHeader
        title="Pending extract generation requests"
        actions={<Button variant="secondary" size="sm" onClick={() => void load()}>Refresh</Button>}
      />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        {loading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : requests.length === 0 ? (
          <p className="text-sm text-neutral-600">No pending generation requests.</p>
        ) : (
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Extract type</TableHeaderCell>
                <TableHeaderCell>Academic year</TableHeaderCell>
                <TableHeaderCell>Requested</TableHeaderCell>
                <TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {requests.map(r => (
                <TableRow key={r.workflowInstanceId}>
                  <TableCell>
                    {r.context.extractTypeCode === 'b3-student-outcomes' ? 'B3 student outcomes' : 'Access & participation'}
                  </TableCell>
                  <TableCell>{r.context.academicYear}</TableCell>
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
                            onClick={() => void handleDecide(r, 'approved')}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="border-danger-300 text-danger-700 hover:bg-danger-50"
                            disabled={busyId === r.workflowInstanceId}
                            onClick={() => void handleDecide(r, 'rejected')}
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

// ── Page ──────────────────────────────────────────────────────────────────────

export function OfsPage() {
  const { roles } = useAuth();
  const canDecide = userHasAnyPermission(roles, ['regulatory:decide']);
  const [tab,     setTab]     = useState<Tab>('b3');
  const [b3s,     setB3s]     = useState<OfsB3Extract[]>([]);
  const [reports, setReports] = useState<ParticipationReport[]>([]);
  const [refreshSignal, setRefreshSignal] = useState(0);

  async function handleApproved(extractTypeCode: OfsExtractTypeCode, extractId: string) {
    const extract = await getOfsB3Extract(extractId);
    if (extractTypeCode === 'b3-student-outcomes') {
      setB3s(prev => [extract, ...prev]);
    } else {
      setReports(prev => [{
        extractId:   extract.extractId,
        academicYear: extract.academicYear,
        recordCount: extract.recordCount,
        generatedAt: extract.generatedAt ?? new Date().toISOString(),
        payload:     extract.payload,
      }, ...prev]);
    }
  }

  return (
    <div>
      <PageHeader title="Office for Students (OfS)" />

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="mb-6">
          <TabsTrigger value="b3">B3 Extract</TabsTrigger>
          <TabsTrigger value="participation">Participation Report</TabsTrigger>
        </TabsList>
        <TabsContent value="b3"><B3Tab extracts={b3s} setExtracts={setB3s} onRequested={() => setRefreshSignal(s => s + 1)} /></TabsContent>
        <TabsContent value="participation"><ParticipationTab reports={reports} onRequested={() => setRefreshSignal(s => s + 1)} /></TabsContent>
      </Tabs>

      {canDecide && (
        <div className="mt-8">
          <OfsGenerationRequestsQueue
            refreshSignal={refreshSignal}
            onApproved={(extractTypeCode, extractId) => void handleApproved(extractTypeCode, extractId)}
          />
        </div>
      )}
    </div>
  );
}
