import { useCallback, useEffect, useState } from 'react';
import {
  type IdentityChangeRequest,
  listIdentityChangeRequests,
  decideIdentityChangeRequest,
} from '../api/identityChangeRequests.js';
import { ApiError } from '../api/client.js';
import { Spinner } from '../components/Spinner.js';
import { PageHeader, Card, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, Button } from '@revelation-srs/ui';

export function IdentityChangeRequestsPage() {
  const [requests, setRequests] = useState<IdentityChangeRequest[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [deciding, setDeciding] = useState<string | null>(null);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [busyId,   setBusyId]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setRequests(await listIdentityChangeRequests());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load requests');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleDecide(workflowInstanceId: string, decisionCode: 'approved' | 'rejected') {
    setBusyId(workflowInstanceId); setError('');
    try {
      await decideIdentityChangeRequest(workflowInstanceId, decisionCode, reasonById[workflowInstanceId]?.trim() || undefined);
      setDeciding(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? (e.detail ?? e.message) : 'Failed to record decision');
    } finally { setBusyId(null); }
  }

  return (
    <div>
      <PageHeader
        title="Legal identity change requests"
        description="Student-initiated gender/nationality change requests awaiting personal tutor or registry approval"
        actions={<Button variant="secondary" onClick={() => void load()}>Refresh</Button>}
      />

      {error && <p className="mb-4 text-sm text-danger-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : requests.length === 0 ? (
        <p className="text-sm text-neutral-600 py-8 text-center">No pending requests.</p>
      ) : (
        <Card>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Person</TableHeaderCell>
                <TableHeaderCell>Requested change</TableHeaderCell>
                <TableHeaderCell>Reason</TableHeaderCell>
                <TableHeaderCell>Submitted</TableHeaderCell>
                <TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {requests.map(r => {
                const personId = String(r.context['personId'] ?? '');
                const patch = (r.context['patch'] ?? {}) as { genderCode?: string; nationalityCode?: string };
                const reason = String(r.context['reason'] ?? '') || '—';
                const changes = [
                  patch.genderCode ? `Gender → ${patch.genderCode}` : null,
                  patch.nationalityCode ? `Nationality → ${patch.nationalityCode}` : null,
                ].filter(Boolean).join(', ');
                return (
                  <TableRow key={r.workflowInstanceId}>
                    <TableCell className="font-mono text-xs text-neutral-600">{personId}</TableCell>
                    <TableCell className="text-sm">{changes}</TableCell>
                    <TableCell className="text-xs text-neutral-500">{reason}</TableCell>
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
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
