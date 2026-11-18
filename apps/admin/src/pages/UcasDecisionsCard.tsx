import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Card, CardHeader, CardBody, Button, Badge, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, useCodes,
} from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import { type UcasOutboundDecision, dispatchUcasDecisions, listUcasDecisions } from '../api/regulatory.js';


/**
 * Admissions decisions for UCAS (Phase 3 D-15). Decisions queue as they are
 * made; sending produces the file for UCAS (or uses the simulator in a test
 * tenant). A sent decision is confirmed when UCAS's next status agrees; a
 * contradiction, or no confirmation within two working days, needs attention.
 */
export function UcasDecisionsCard({ canSend }: { canSend: boolean }) {
  const sendStatuses = useCodes('ucas_outbound_decision', 'status_code');
  const [items, setItems] = useState<UcasOutboundDecision[] | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setItems((await listUcasDecisions()).filter((i) => i.statusCode !== 'reconciled' || i.attention)); } catch (err) { setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to load decisions'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function send() {
    setError(''); setNotice('');
    try {
      const file = await dispatchUcasDecisions();
      if (file.transport === 'manual-file' && file.processedCount > 0) {
        const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url; a.download = `ucas-decisions-${file.generatedAt.slice(0, 10)}.json`; a.click();
        URL.revokeObjectURL(url);
      }
      setNotice(file.processedCount === 0 ? 'No decisions are waiting to be sent.' : `${file.processedCount} decision(s) sent (${file.transport === 'simulator' ? 'simulator' : 'file downloaded for upload to UCAS'}).`);
      await load();
    } catch (err) { setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Sending failed'); }
  }

  const waiting = items?.filter((i) => i.statusCode === 'queued').length ?? 0;
  return (
    <Card>
      <CardHeader
        title="Decisions for UCAS"
        description="Offers, changes, withdrawals and confirmation outcomes on UCAS applications, queued as they are made."
        actions={canSend && <Button size="sm" onClick={() => void send()} disabled={waiting === 0}>Send {waiting} decision(s)</Button>}
      />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600" role="alert">{error}</p>}
        {notice && <p className="mb-3 text-sm text-success-700" role="status">{notice}</p>}
        {!items ? null : items.length === 0 ? <p className="text-sm text-neutral-600">Nothing is waiting, and every sent decision is confirmed.</p> : (
          <Table>
            <TableHead><tr><TableHeaderCell>Applicant</TableHeaderCell><TableHeaderCell>Decision</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell></tr></TableHead>
            <TableBody>
              {items.map((i) => (
                <TableRow key={i.exchangeId}>
                  <TableCell><Link to={`/applications/${i.applicationId}`} className="text-primary-600 hover:underline">{i.sourceReference}</Link></TableCell>
                  <TableCell className="text-sm">{i.outcome}{i.ucasCode ? ` (${i.ucasCode})` : ''}</TableCell>
                  <TableCell>
                    <Badge value={i.attention ? 'rejected' : i.statusCode === 'queued' ? 'pending' : 'approved'} label={i.attention === 'not-reconciled' ? 'Not confirmed in time' : sendStatuses.label(i.statusCode)} />
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
