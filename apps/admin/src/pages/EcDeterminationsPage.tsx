import { useCallback, useEffect, useState } from 'react';
import {
  Badge, Button, Card, CardBody, CardHeader, Input, PageHeader, StatusNotice,
  Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow,
} from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import { type EcDetermination, decideEcDetermination, listEcDeterminations } from '../api/students.js';
import { useAuth } from '../auth/AuthContext.js';
import { Spinner } from '../components/Spinner.js';
import { useValueSet } from '../hooks/useValueSet.js';

/**
 * Exceptional-circumstances determinations awaiting a decision (Phase 5
 * D-41). Someone other than the proposer and the person who recorded the
 * claim upholds or rejects each proposed outcome; until then the claim
 * keeps its outcome, so boards never see a proposal as decided.
 */
export function EcDeterminationsPage() {
  const { user } = useAuth();
  const { members: outcomes } = useValueSet('exceptional_circumstances', 'outcome_code');
  const [rows, setRows] = useState<EcDetermination[] | null>(null);
  const [error, setError] = useState('');
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try { setRows(await listEcDeterminations({ statusCode: 'proposed' })); } catch (err) { setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to load'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function decide(id: string, decisionCode: 'upheld' | 'not-upheld') {
    setError('');
    try { await decideEcDetermination(id, { decisionCode, ...(reasons[id]?.trim() ? { reason: reasons[id].trim() } : {}) }); await load(); }
    catch (err) { setError(err instanceof ApiError ? (err.detail ?? err.message) : 'The decision failed'); }
  }

  const label = (code: string) => outcomes.find((m) => m.code === code)?.displayLabel ?? code;
  return (
    <div>
      <PageHeader title="EC determinations" description="Proposed exceptional-circumstances outcomes awaiting an independent decision." />
      {error && <p className="mb-4 text-sm text-danger-600" role="alert">{error}</p>}
      <Card>
        <CardHeader title="Awaiting a decision" />
        <CardBody>
          {!rows ? <div className="flex justify-center py-8"><Spinner /></div> : rows.length === 0 ? <p className="text-sm text-neutral-600">Nothing awaits a decision.</p> : (
            <Table>
              <TableHead><tr><TableHeaderCell>Proposed outcome</TableHeaderCell><TableHeaderCell>Reason</TableHeaderCell><TableHeaderCell>Proposed</TableHeaderCell><TableHeaderCell>Decision</TableHeaderCell></tr></TableHead>
              <TableBody>
                {rows.map((d) => {
                  const own = d.proposedBy === user?.sub || d.recordedBy === user?.sub;
                  return (
                    <TableRow key={d.id}>
                      <TableCell><Badge value={d.proposedOutcomeCode} label={label(d.proposedOutcomeCode)} /></TableCell>
                      <TableCell className="text-sm">{d.reason}</TableCell>
                      <TableCell className="text-xs">{d.proposedBy}<div>{new Date(d.proposedAt).toLocaleDateString('en-GB')}</div></TableCell>
                      <TableCell>
                        {own ? <StatusNotice>You proposed or recorded this, so someone else must decide it.</StatusNotice> : (
                          <div className="flex flex-wrap items-center gap-2">
                            <Input aria-label="Decision reason" placeholder="Reason (optional)" value={reasons[d.id] ?? ''} onChange={(e) => setReasons((r) => ({ ...r, [d.id]: e.target.value }))} />
                            <Button size="sm" onClick={() => void decide(d.id, 'upheld')}>Uphold</Button>
                            <Button size="sm" variant="secondary" onClick={() => void decide(d.id, 'not-upheld')}>Do not uphold</Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
