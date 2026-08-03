import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type UcasApplication,
  type UcasSubmissionRequest,
  listUcasApplications,
  requestUcasSubmission,
  listUcasSubmissionRequests,
  decideUcasSubmissionRequest,
} from '../api/regulatory.js';
import { ApiError } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';
import {
  PageHeader, Button, Select, Card, CardHeader, CardBody, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';

export function UcasPage() {
  const { roles } = useAuth();
  const canDecide = userHasAnyPermission(roles, ['regulatory:decide']);
  const [applications, setApplications] = useState<UcasApplication[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [requesting,   setRequesting]   = useState(false);
  const [successMsg,   setSuccessMsg]   = useState('');
  const [cycle,        setCycle]        = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setApplications(await listUcasApplications());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load applications');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const cycles = useMemo(
    () => Array.from(new Set(applications.map(a => a.cycle))).sort().reverse(),
    [applications],
  );

  useEffect(() => {
    if (!cycle && cycles.length > 0) setCycle(cycles[0]!);
  }, [cycle, cycles]);

  async function handleRequestSubmission() {
    if (!cycle.trim()) return;
    setRequesting(true);
    setError('');
    setSuccessMsg('');
    try {
      await requestUcasSubmission(cycle.trim());
      setSuccessMsg(`Approval requested to submit UCAS confirmations for cycle ${cycle}.`);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to request confirmation submission');
    } finally {
      setRequesting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="UCAS applications"
        actions={
          <div className="flex items-center gap-2">
            <Select
              value={cycle}
              onChange={e => setCycle(e.target.value)}
              className="w-auto"
            >
              {cycles.length === 0 && <option value="">No cycles yet</option>}
              {cycles.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Button onClick={() => void handleRequestSubmission()} disabled={requesting || !cycle}>
              {requesting ? 'Requesting…' : 'Request approval to submit'}
            </Button>
          </div>
        }
      />

      {error      && <p className="mb-4 text-sm text-danger-600">{error}</p>}
      {successMsg && <p className="mb-4 text-sm text-success-600">{successMsg}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : applications.length === 0 ? (
        <p className="py-8 text-center text-sm text-neutral-600">No UCAS applications on record.</p>
      ) : (
        <Card>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>UCAS personal ID</TableHeaderCell>
                <TableHeaderCell>Cycle</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Received</TableHeaderCell>
                <TableHeaderCell>Linked enrolment</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {applications.map(a => (
                <TableRow key={a.applicationId}>
                  <TableCell className="font-mono text-xs text-neutral-700">{a.ucasPersonalId}</TableCell>
                  <TableCell>{a.cycle}</TableCell>
                  <TableCell><Badge value={a.statusCode} /></TableCell>
                  <TableCell className="text-xs">
                    {new Date(a.receivedAt).toLocaleDateString('en-GB')}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-neutral-500">
                    {a.linkedEnrolmentId ?? <span className="text-neutral-600">—</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {canDecide && (
        <div className="mt-8">
          <UcasSubmissionRequestsQueue />
        </div>
      )}
    </div>
  );
}

function UcasSubmissionRequestsQueue() {
  const [requests, setRequests] = useState<UcasSubmissionRequest[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [deciding, setDeciding] = useState<string | null>(null);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [busyId,   setBusyId]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setRequests(await listUcasSubmissionRequests());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load submission requests');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleDecide(workflowInstanceId: string, decisionCode: 'approved' | 'rejected') {
    setBusyId(workflowInstanceId); setError('');
    try {
      await decideUcasSubmissionRequest(workflowInstanceId, decisionCode, reasonById[workflowInstanceId]?.trim() || undefined);
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
                <TableHeaderCell>Cycle</TableHeaderCell>
                <TableHeaderCell>Confirmations</TableHeaderCell>
                <TableHeaderCell>Requested</TableHeaderCell>
                <TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {requests.map(r => (
                <TableRow key={r.workflowInstanceId}>
                  <TableCell>{r.context.cycle}</TableCell>
                  <TableCell className="text-xs">{r.recordCount}</TableCell>
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
