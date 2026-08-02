import { useCallback, useEffect, useState } from 'react';
import {
  type ModuleSelectionProposal,
  listModuleSelectionProposals,
  decideModuleSelectionProposal,
} from '../api/moduleSelection.js';
import { ApiError } from '../api/client.js';
import { Spinner } from '../components/Spinner.js';
import {
  PageHeader, Card, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
  Button, Select,
} from '@revelation-srs/ui';

const STATUS_OPTIONS = ['waitlisted', 'submitted', 'returned', 'confirmed', 'rejected', ''];

export function ModuleSelectionProposalsPage() {
  const [proposals, setProposals] = useState<ModuleSelectionProposal[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [statusFilter, setStatusFilter] = useState('waitlisted');
  const [deciding,   setDeciding]   = useState<string | null>(null);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [busyId,     setBusyId]     = useState<string | null>(null);

  const load = useCallback(async (status: string) => {
    setLoading(true);
    setError('');
    try {
      const data = await listModuleSelectionProposals(status ? { statusCode: status } : undefined);
      setProposals(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load proposals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(statusFilter); }, [load, statusFilter]);

  async function handleDecide(proposalId: string, decisionCode: 'approved' | 'rejected' | 'returned') {
    const reason = reasonById[proposalId]?.trim();
    if (!reason) {
      setError('A reason is required to record a decision.');
      return;
    }
    setBusyId(proposalId);
    setError('');
    try {
      await decideModuleSelectionProposal(proposalId, decisionCode, reason);
      setDeciding(null);
      void load(statusFilter);
    } catch (e) {
      setError(e instanceof ApiError ? (e.detail ?? e.message) : 'Failed to record decision');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Module selection proposals"
        description="Proposals awaiting a programme or teaching-unit approval decision"
        actions={
          <div className="flex items-center gap-3">
            <label htmlFor="proposal-status-filter" className="text-sm text-neutral-500">Status:</label>
            <Select
              id="proposal-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-auto"
            >
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>{s || 'All'}</option>
              ))}
            </Select>
            <Button variant="secondary" onClick={() => void load(statusFilter)}>Refresh</Button>
          </div>
        }
      />

      {error && <p className="mb-4 text-sm text-danger-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : proposals.length === 0 ? (
        <p className="text-sm text-neutral-600 py-8 text-center">No proposals found.</p>
      ) : (
        <Card>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Enrolment</TableHeaderCell>
                <TableHeaderCell>Modules</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Submitted</TableHeaderCell>
                <TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {proposals.map(proposal => (
                <TableRow key={proposal.moduleSelectionProposalId}>
                  <TableCell className="font-mono text-xs text-neutral-600">{proposal.enrolmentId}</TableCell>
                  <TableCell>
                    <ul className="space-y-0.5">
                      {proposal.items.map(item => (
                        <li key={item.proposalItemId} className="text-xs">
                          <span className="font-mono text-neutral-500 mr-1">{item.moduleCode}</span>
                          {item.moduleTitle}
                          {item.validationMessages.some(m => m.severity === 'warning') && (
                            <span className="ml-1 text-warning-600">⚠</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </TableCell>
                  <TableCell>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColour(proposal.statusCode)}`}>
                      {proposal.statusCode}
                    </span>
                  </TableCell>
                  <TableCell className="text-neutral-500">
                    {proposal.submittedAt ? new Date(proposal.submittedAt).toLocaleDateString('en-GB') : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    {proposal.statusCode === 'waitlisted' || proposal.statusCode === 'submitted' ? (
                      deciding === proposal.moduleSelectionProposalId ? (
                        <div className="inline-flex flex-col items-end gap-2">
                          <input
                            type="text"
                            placeholder="Decision reason"
                            className="rounded border border-neutral-300 px-2 py-1 text-xs w-56"
                            value={reasonById[proposal.moduleSelectionProposalId] ?? ''}
                            onChange={(e) => setReasonById(r => ({ ...r, [proposal.moduleSelectionProposalId]: e.target.value }))}
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              disabled={busyId === proposal.moduleSelectionProposalId}
                              className="bg-success-600 hover:bg-success-700"
                              onClick={() => void handleDecide(proposal.moduleSelectionProposalId, 'approved')}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busyId === proposal.moduleSelectionProposalId}
                              onClick={() => void handleDecide(proposal.moduleSelectionProposalId, 'returned')}
                            >
                              Return
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              className="border-danger-300 text-danger-700 hover:bg-danger-50"
                              disabled={busyId === proposal.moduleSelectionProposalId}
                              onClick={() => void handleDecide(proposal.moduleSelectionProposalId, 'rejected')}
                            >
                              Reject
                            </Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => setDeciding(null)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => setDeciding(proposal.moduleSelectionProposalId)}
                        >
                          Decide
                        </Button>
                      )
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function statusColour(code: string): string {
  const map: Record<string, string> = {
    draft:      'bg-neutral-100 text-neutral-600',
    submitted:  'bg-primary-100 text-primary-700',
    validated:  'bg-primary-100 text-primary-700',
    approved:   'bg-success-100 text-success-700',
    returned:   'bg-warning-100 text-warning-700',
    waitlisted: 'bg-warning-100 text-warning-700',
    rejected:   'bg-danger-100 text-danger-700',
    confirmed:  'bg-success-100 text-success-700',
  };
  return map[code] ?? 'bg-neutral-100 text-neutral-700';
}
