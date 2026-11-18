import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  PageHeader, Card, CardHeader, CardBody, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, Button, Badge, CodeBadge,
} from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import {
  type AllocationRun, decideAllocationRun, getAllocationRun, listAllocationRuns, previewAllocation, submitAllocationRun,
} from '../api/moduleSelection.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { Spinner } from '../components/Spinner.js';

/**
 * Ranked allocation for one selection window (Phase 4 D-30). Registry
 * previews runs, as many as needed (each is kept); submits one, which
 * starts its approval review (and a task in the approvers' inbox); a
 * different person with authority to decide selections approves it, which
 * applies it. Approval is refused if selections or places changed since
 * the preview. The order is random but fixed for the window.
 */
export function AllocationRunsPage() {
  const { windowId = '' } = useParams();
  const { roles, user } = useAuth();
  const canRun = userHasAnyPermission(roles, ['module-selection:allocate']);
  const canDecide = userHasAnyPermission(roles, ['module-selection:decide']);
  const [runs, setRuns] = useState<AllocationRun[]>([]);
  const [open, setOpen] = useState<AllocationRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setRuns(await listAllocationRuns(windowId)); } catch (e) { setError(e instanceof ApiError ? e.message : 'Failed to load allocation runs'); } finally { setLoading(false); }
  }, [windowId]);
  useEffect(() => { void load(); }, [load]);

  async function act(fn: () => Promise<AllocationRun>) {
    setBusy(true); setError('');
    try { const run = await fn(); setOpen(run.results ? run : await getAllocationRun(run.allocationRunId)); await load(); }
    catch (e) { setError(e instanceof ApiError ? (e.detail ?? e.message) : 'The action failed'); }
    finally { setBusy(false); }
  }

  const mainApplied = runs.some((r) => r.kindCode === 'main' && r.statusCode === 'applied');

  return (
    <div>
      <PageHeader
        title="Module allocation"
        description="Places on oversubscribed modules, allocated by ranked preference in a random order that is fixed for the window. Students with a higher stage come first. Submission time plays no part."
        actions={<Link to="/tenant-admin/selection-windows" className="text-sm text-primary-600 hover:underline">Selection windows</Link>}
      />
      {error && <p className="mb-4 text-sm text-danger-600" role="alert">{error}</p>}
      {canRun && (
        <div className="mb-4 flex gap-3">
          <Button disabled={busy} onClick={() => void act(() => previewAllocation(windowId, mainApplied ? 'top-up' : 'main'))}>
            {mainApplied ? 'Preview a top-up run' : 'Preview the allocation'}
          </Button>
        </div>
      )}

      {loading ? <div className="flex justify-center py-16"><Spinner /></div> : (
        <Card>
          <CardHeader title="Runs" />
          <CardBody>
            {runs.length === 0 ? <p className="text-sm text-neutral-600">No allocation has been previewed for this window.</p> : (
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Previewed</TableHeaderCell>
                    <TableHeaderCell>Kind</TableHeaderCell>
                    <TableHeaderCell>Students</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {[...runs].reverse().map((r) => (
                    <TableRow key={r.allocationRunId}>
                      <TableCell className="text-xs">{new Date(r.createdAt).toLocaleString('en-GB')}<span className="block text-neutral-500">by {r.createdBy}</span></TableCell>
                      <TableCell className="text-xs">{r.kindCode === 'main' ? 'Main' : 'Top-up'}</TableCell>
                      <TableCell className="text-xs">{r.summary.fullyAllocated} of {r.summary.proposals} fully allocated{r.summary.partlyAllocated ? `, ${r.summary.partlyAllocated} returned` : ''}</TableCell>
                      <TableCell><CodeBadge entity="module_allocation_run" field="status_code" code={r.statusCode} /></TableCell>
                      <TableCell className="text-right space-x-3 whitespace-nowrap">
                        <button className="text-xs text-primary-600 hover:underline" onClick={() => void act(() => getAllocationRun(r.allocationRunId))}>View</button>
                        {r.workflowInstanceId && (
                          <Link to={`/workflow/${r.workflowInstanceId}`} className="text-xs text-primary-600 hover:underline">Approval review</Link>
                        )}
                        {canRun && r.statusCode === 'previewed' && !runs.some((x) => x.statusCode === 'submitted') && (
                          <button className="text-xs text-primary-600 hover:underline" disabled={busy} onClick={() => void act(() => submitAllocationRun(r.allocationRunId))}>Submit for approval</button>
                        )}
                        {canDecide && r.statusCode === 'submitted' && r.submittedBy !== user?.sub && r.createdBy !== user?.sub && (
                          <>
                            <button className="text-xs text-success-700 hover:underline" disabled={busy} onClick={() => void act(() => decideAllocationRun(r.allocationRunId, 'approved'))}>Approve and apply</button>
                            <button className="text-xs text-danger-700 hover:underline" disabled={busy} onClick={() => void act(() => decideAllocationRun(r.allocationRunId, 'rejected'))}>Reject</button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardBody>
        </Card>
      )}

      {open?.results && (
        <div className="mt-6">
          <Card>
            <CardHeader title={`Run of ${new Date(open.createdAt).toLocaleString('en-GB')}`} />
            <CardBody>
              {open.summary.compulsoryOverflow.length > 0 && (
                <p className="mb-3 text-xs text-warning-700">Compulsory places over capacity: {open.summary.compulsoryOverflow.map((o) => `${o.moduleCode} (+${o.over})`).join(', ')}</p>
              )}
              <p className="mb-3 text-xs text-neutral-600">Algorithm {open.algorithmVersion}; priority {open.priorityOrder.join(', then ')}; inputs {open.inputsHash.slice(0, 12)}…</p>
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Order</TableHeaderCell>
                    <TableHeaderCell>Enrolment</TableHeaderCell>
                    <TableHeaderCell>Choice</TableHeaderCell>
                    <TableHeaderCell>Outcome</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {open.results.filter((x) => x.outcomeCode !== 'fixed').map((x) => (
                    <TableRow key={`${x.proposalId}-${x.choiceSlot}`}>
                      <TableCell>{x.orderPosition}</TableCell>
                      <TableCell className="font-mono text-xs">{x.enrolmentId.slice(0, 8)}</TableCell>
                      <TableCell>{x.choiceSlot}</TableCell>
                      <TableCell className="text-xs">{x.outcomeCode === 'allocated' ? 'Allocated' : 'Not allocated'}: {x.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
