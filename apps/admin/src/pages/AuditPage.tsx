import { useCallback, useEffect, useState } from 'react';
import {
  type IntegrationExchange,
  listIntegrationExchanges,
} from '../api/integrations.js';
import { ApiError } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';
import {
  PageHeader, Button, Card, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';

const AUDIT_ROLES       = ['dpo', 'system-administrator', 'registry-administrator', 'wellbeing-auditor'];
const INTEGRATION_ROLES = ['registry-administrator', 'tenant-administrator', 'system-administrator'];

export function AuditPage() {
  const { roles } = useAuth();
  const canRead         = AUDIT_ROLES.some(r => roles.includes(r));
  const canSeeExchanges = INTEGRATION_ROLES.some(r => roles.includes(r));

  return (
    <div>
      <PageHeader title="Audit log" />

      <div className="mb-6 rounded-lg border border-warning-200 bg-warning-50 p-4">
        <p className="text-sm font-medium text-warning-800">Residual gap — Phase 10</p>
        <p className="text-xs text-warning-700 mt-1">
          A dedicated entity-level audit log API is not yet available. The exchange log below
          covers integration events. Full entity audit trails (student record changes, enrolment
          transitions, mark corrections) are captured server-side and will be surfaced in Phase 11
          via <code className="font-mono">/api/v1/audit-log</code>.
        </p>
      </div>

      {!canRead ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center">
          <p className="text-sm text-neutral-500">
            Audit log access requires the <strong>dpo</strong>, <strong>system-administrator</strong>,
            <strong>registry-administrator</strong>, or <strong>wellbeing-auditor</strong> role.
          </p>
        </div>
      ) : canSeeExchanges ? (
        <IntegrationExchangeAudit />
      ) : (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center">
          <p className="text-sm text-neutral-600 font-medium mb-2">Entity-level audit access</p>
          <p className="text-sm text-neutral-500">
            As a DPO or wellbeing auditor, your audit access is scoped to individual entity records.
            Open a student record and navigate to the <strong>History</strong> tab to view that
            student's full audit trail.
          </p>
          <p className="text-xs text-neutral-600 mt-3">
            A consolidated audit search view is planned for a future release.
          </p>
        </div>
      )}
    </div>
  );
}

function IntegrationExchangeAudit() {
  const [exchanges, setExchanges] = useState<IntegrationExchange[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setExchanges(await listIntegrationExchanges({ limit: 50 }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load exchange log');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-neutral-700">Integration exchange log (most recent 50)</h2>
        <Button variant="secondary" size="sm" onClick={() => void load()}>Refresh</Button>
      </div>

      {error && <p className="mb-4 text-sm text-danger-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : exchanges.length === 0 ? (
        <p className="text-sm text-neutral-600">No exchange records found.</p>
      ) : (
        <Card>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Exchange ID</TableHeaderCell>
                <TableHeaderCell>Event type</TableHeaderCell>
                <TableHeaderCell>Direction</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Occurred</TableHeaderCell>
                <TableHeaderCell>Processed</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {exchanges.map(ex => (
                <TableRow key={ex.exchangeId}>
                  <TableCell className="font-mono text-xs text-neutral-600">{ex.exchangeId.slice(0, 8)}…</TableCell>
                  <TableCell className="font-mono text-xs text-neutral-700">{ex.exchangeTypeCode}</TableCell>
                  <TableCell className="text-xs capitalize">{ex.directionCode}</TableCell>
                  <TableCell><Badge value={ex.statusCode} /></TableCell>
                  <TableCell className="text-xs">
                    {new Date(ex.createdAt).toLocaleString('en-GB')}
                  </TableCell>
                  <TableCell className="text-xs">
                    {ex.lastAttemptAt
                      ? new Date(ex.lastAttemptAt).toLocaleString('en-GB')
                      : <span className="text-neutral-600">—</span>}
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
