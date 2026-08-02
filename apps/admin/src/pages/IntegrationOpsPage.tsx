import { useEffect, useState } from 'react';
import {
  type IntegrationRegistration,
  type HealthCheckResult,
  type IntegrationExchange,
  listIntegrationRegistrations,
  healthCheckIntegration,
  listIntegrationExchanges,
  replayIntegration,
} from '../api/integrations.js';
import { ApiError } from '../api/client.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import {
  PageHeader, Card, CardBody, Button,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';

type Tab = 'health' | 'failed';

export function IntegrationOpsPage() {
  const [tab, setTab] = useState<Tab>('health');
  const { roles } = useAuth();
  const canManage = userHasAnyPermission(roles, ['integration:manage']);

  return (
    <div>
      <PageHeader title="Integration operations" />

      <div className="flex gap-1 mb-6 border-b border-neutral-200">
        {([
          ['health', 'Connector health'],
          ['failed', 'Failed exchanges'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 ${
              tab === t
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-neutral-500 hover:text-neutral-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'health'  && <ConnectorHealthTab canManage={canManage} />}
      {tab === 'failed'  && <FailedExchangesTab />}
    </div>
  );
}

interface RegistrationHealth {
  registration: IntegrationRegistration;
  updated:       IntegrationRegistration | null;
  checking:      boolean;
  error:         string;
}

function ConnectorHealthTab({ canManage }: { canManage: boolean }) {
  const [items,   setItems]   = useState<RegistrationHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const regs = await listIntegrationRegistrations();
        setItems(regs.map(r => ({ registration: r, updated: null, checking: false, error: '' })));
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function runHealthCheck(registrationId: string, statusCode: string) {
    setItems(prev => prev.map(i =>
      i.registration.registrationId === registrationId
        ? { ...i, checking: true, error: '', updated: null }
        : i,
    ));
    try {
      const updated = await healthCheckIntegration(registrationId, statusCode);
      setItems(prev => prev.map(i =>
        i.registration.registrationId === registrationId
          ? { ...i, checking: false, updated }
          : i,
      ));
    } catch (e) {
      const msg = e instanceof ApiError ? (e.detail ?? e.message) : 'Health check failed';
      setItems(prev => prev.map(i =>
        i.registration.registrationId === registrationId
          ? { ...i, checking: false, error: msg }
          : i,
      ));
    }
  }

  async function checkAll() {
    const ids = items.map(i => i.registration.registrationId);
    await Promise.all(ids.map(id => runHealthCheck(id, 'ok')));
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>;
  if (error)   return <p className="text-sm text-danger-600">{error}</p>;

  const vleItems = items.filter(i =>
    i.registration.displayName.toLowerCase().includes('vle') ||
    i.registration.endpointUrl?.toLowerCase().includes('vle'),
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-500">{items.length} registered connectors</p>
        {canManage && <Button variant="secondary" onClick={() => void checkAll()}>Record all OK</Button>}
      </div>

      <div className="space-y-3">
        {items.map(({ registration: reg, updated, checking, error: itemError }) => {
          const display = updated ?? reg;
          return (
            <Card key={reg.registrationId}>
              <CardBody>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-neutral-900">{reg.displayName}</p>
                  <p className="text-xs text-neutral-600 mt-0.5">
                    {reg.transportCode}
                    {reg.endpointUrl && (
                      <span className="font-mono ml-2">{reg.endpointUrl}</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge value={display.healthStatusCode ?? (display.enabled ? 'enabled' : 'disabled')} />
                  {canManage && <div className="flex items-center gap-1">
                    {(['ok', 'degraded', 'down'] as const).map(s => (
                      <Button
                        key={s}
                        variant="secondary"
                        size="sm"
                        onClick={() => void runHealthCheck(reg.registrationId, s)}
                        disabled={checking}
                      >
                        {checking ? '…' : s}
                      </Button>
                    ))}
                  </div>}
                </div>
              </div>

              {itemError && (
                <p className="mt-2 text-xs text-danger-600">{itemError}</p>
              )}

              {updated && (
                <div className="mt-2 text-xs text-success-700">
                  Status recorded at{' '}
                  {updated.lastHealthCheckAt
                    ? new Date(updated.lastHealthCheckAt).toLocaleTimeString('en-GB')
                    : '—'}
                </div>
              )}
              </CardBody>
            </Card>
          );
        })}

        {items.length === 0 && (
          <p className="text-sm text-neutral-600">No integrations registered.</p>
        )}
      </div>

      {/* VLE bulk reconciliation (R-VLE-003) */}
      {canManage && vleItems.length > 0 && (
        <VleReconcilePanel vleItems={vleItems} />
      )}
    </div>
  );
}

// ── VLE bulk reconciliation panel (R-VLE-003) ─────────────────────────────────

type RunResult = { registrationId: string; label: string; replayJobId: string; error?: string };

function VleReconcilePanel({ vleItems }: { vleItems: RegistrationHealth[] }) {
  const [running,  setRunning]  = useState(false);
  const [results,  setResults]  = useState<RunResult[]>([]);

  async function triggerReconciliation() {
    setRunning(true);
    setResults([]);
    const toDate   = new Date().toISOString();
    const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const next: RunResult[] = [];
    for (const { registration: reg } of vleItems) {
      try {
        const { replayJobId } = await replayIntegration(reg.registrationId, { fromDate, toDate });
        next.push({ registrationId: reg.registrationId, label: reg.displayName, replayJobId });
      } catch (e) {
        next.push({
          registrationId: reg.registrationId,
          label: reg.displayName,
          replayJobId: '',
          error: e instanceof ApiError ? (e.detail ?? e.message) : 'Replay failed',
        });
      }
    }
    setResults(next);
    setRunning(false);
  }

  return (
    <div className="rounded-lg border border-primary-200 bg-primary-50 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-primary-900">VLE connector — bulk reconciliation</h3>
        <Button
          variant="secondary"
          size="sm"
          className="border-primary-400 text-primary-800 hover:bg-primary-50"
          onClick={() => void triggerReconciliation()}
          disabled={running}
        >
          {running ? 'Triggering…' : 'Trigger 24h replay'}
        </Button>
      </div>
      <p className="text-xs text-primary-700 mb-3">
        Triggers a replay of all integration events from the last 24 hours across all VLE connector
        registrations. The adapter will re-process grade submissions, roster changes, and
        adjustment distributions — resolving any unprocessed conflicts (R-VLE-003).
      </p>
      {results.length > 0 && (
        <ul className="space-y-1 mt-3">
          {results.map(r => (
            <li key={r.registrationId} className="text-xs">
              <span className="font-medium text-primary-900">{r.label}:</span>{' '}
              {r.error ? (
                <span className="text-danger-700">{r.error}</span>
              ) : (
                <span className="text-success-700">replay queued — job {r.replayJobId}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FailedExchangesTab() {
  const [exchanges, setExchanges] = useState<IntegrationExchange[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [page,      setPage]      = useState(0);
  const PAGE_SIZE = 25;

  async function load(offset: number) {
    setLoading(true);
    try {
      const data = await listIntegrationExchanges({
        statusCode: 'failed',
        limit:      PAGE_SIZE,
        offset,
      });
      setExchanges(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(0); }, []);

  function goPage(newPage: number) {
    setPage(newPage);
    void load(newPage * PAGE_SIZE);
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>;
  if (error)   return <p className="text-sm text-danger-600">{error}</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-500">Showing failed exchanges (page {page + 1})</p>
        <Button variant="secondary" size="sm" onClick={() => void load(page * PAGE_SIZE)}>Refresh</Button>
      </div>

      <Card>
        {exchanges.length === 0 ? (
          <p className="px-5 py-8 text-sm text-neutral-600 text-center">No failed exchanges.</p>
        ) : (
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Occurred</TableHeaderCell>
                <TableHeaderCell>Direction</TableHeaderCell>
                <TableHeaderCell>Event type</TableHeaderCell>
                <TableHeaderCell>Error</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {exchanges.map(ex => (
                <TableRow key={ex.exchangeId}>
                  <TableCell className="whitespace-nowrap">
                    {new Date(ex.createdAt).toLocaleString('en-GB')}
                  </TableCell>
                  <TableCell>
                    <Badge value={ex.directionCode} />
                  </TableCell>
                  <TableCell className="font-mono text-xs text-neutral-700">{ex.exchangeTypeCode}</TableCell>
                  <TableCell className="text-xs text-danger-700 max-w-xs truncate">
                    <span title={ex.lastError ?? ''}>{ex.lastError ?? '—'}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => goPage(page - 1)}>← Previous</Button>
        <Button variant="secondary" size="sm" disabled={exchanges.length < PAGE_SIZE} onClick={() => goPage(page + 1)}>Next →</Button>
      </div>
    </div>
  );
}
