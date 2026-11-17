import { useEffect, useState } from 'react';
import { Card, CardHeader, Badge, Spinner, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from '@revelation-srs/ui';

import { api } from '../api/client.js';

interface Entitlement { deliveryItemId: string; flowCode: string; targetSystem: string; summary: string; statusCode: string; fulfilmentModeCode: string; createdAt: string; deliveredAt: string | null }

/**
 * What each adjacent system has been asked to give this person (Phase 3 D-19):
 * the latest item of each flow. Study access follows the enrolment status;
 * the institutional account ends at leaver closure plus a grace period.
 */
export function EntitlementsSection({ personId }: { personId: string }) {
  const [items, setItems] = useState<Entitlement[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get<Entitlement[]>(`/api/v1/students/${personId}/entitlements`).then(setItems).catch(() => setError('Failed to load entitlements'));
  }, [personId]);
  return (
    <Card>
      <CardHeader title="Access and entitlements" description="The latest instruction sent to each system, and whether it has been done." />
      {error ? <p className="px-6 pb-6 text-sm text-danger-600" role="alert">{error}</p>
        : !items ? <div className="p-6"><Spinner /></div>
          : items.length === 0 ? <p className="px-6 pb-6 text-sm text-neutral-600">Nothing has been sent to other systems.</p> : (
            <Table>
              <TableHead><tr><TableHeaderCell>Flow</TableHeaderCell><TableHeaderCell>Instruction</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell><TableHeaderCell>Sent</TableHeaderCell></tr></TableHead>
              <TableBody>
                {items.map((i) => (
                  <TableRow key={i.deliveryItemId}>
                    <TableCell className="font-mono text-xs">{i.flowCode}</TableCell>
                    <TableCell className="text-sm">{i.summary}</TableCell>
                    <TableCell><Badge value={i.statusCode === 'delivered' || i.statusCode === 'acknowledged' ? 'approved' : i.statusCode === 'failed' ? 'rejected' : 'pending'} label={i.statusCode} /></TableCell>
                    <TableCell className="text-xs">{new Date(i.createdAt).toLocaleDateString('en-GB')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
    </Card>
  );
}
