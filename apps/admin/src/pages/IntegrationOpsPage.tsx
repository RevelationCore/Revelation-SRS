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

type Tab = 'health' | 'failed';

export function IntegrationOpsPage() {
  const [tab, setTab] = useState<Tab>('health');

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-4">Integration operations</h1>

      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {([
          ['health', 'Connector health'],
          ['failed', 'Failed exchanges'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 ${
              tab === t
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'health'  && <ConnectorHealthTab />}
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

function ConnectorHealthTab() {
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
  if (error)   return <p className="text-sm text-red-600">{error}</p>;

  const vleItems = items.filter(i =>
    i.registration.displayName.toLowerCase().includes('vle') ||
    i.registration.endpointUrl?.toLowerCase().includes('vle'),
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{items.length} registered connectors</p>
        <button
          onClick={() => void checkAll()}
          className="rounded border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Record all OK
        </button>
      </div>

      <div className="space-y-3">
        {items.map(({ registration: reg, updated, checking, error: itemError }) => {
          const display = updated ?? reg;
          return (
            <div
              key={reg.registrationId}
              className="rounded-lg border border-gray-200 bg-white p-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{reg.displayName}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {reg.transportCode}
                    {reg.endpointUrl && (
                      <span className="font-mono ml-2">{reg.endpointUrl}</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge value={display.healthStatusCode ?? (display.enabled ? 'enabled' : 'disabled')} />
                  <div className="flex items-center gap-1">
                    {(['ok', 'degraded', 'down'] as const).map(s => (
                      <button
                        key={s}
                        onClick={() => void runHealthCheck(reg.registrationId, s)}
                        disabled={checking}
                        className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        {checking ? '…' : s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {itemError && (
                <p className="mt-2 text-xs text-red-600">{itemError}</p>
              )}

              {updated && (
                <div className="mt-2 text-xs text-green-700">
                  Status recorded at{' '}
                  {updated.lastHealthCheckAt
                    ? new Date(updated.lastHealthCheckAt).toLocaleTimeString('en-GB')
                    : '—'}
                </div>
              )}
            </div>
          );
        })}

        {items.length === 0 && (
          <p className="text-sm text-gray-400">No integrations registered.</p>
        )}
      </div>

      {/* VLE bulk reconciliation (R-VLE-003) */}
      {vleItems.length > 0 && (
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
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-blue-900">VLE connector — bulk reconciliation</h3>
        <button
          onClick={() => void triggerReconciliation()}
          disabled={running}
          className="rounded border border-blue-400 bg-white px-3 py-1.5 text-xs font-medium text-blue-800 hover:bg-blue-50 disabled:opacity-50"
        >
          {running ? 'Triggering…' : 'Trigger 24h replay'}
        </button>
      </div>
      <p className="text-xs text-blue-700 mb-3">
        Triggers a replay of all integration events from the last 24 hours across all VLE connector
        registrations. The adapter will re-process grade submissions, roster changes, and
        adjustment distributions — resolving any unprocessed conflicts (R-VLE-003).
      </p>
      {results.length > 0 && (
        <ul className="space-y-1 mt-3">
          {results.map(r => (
            <li key={r.registrationId} className="text-xs">
              <span className="font-medium text-blue-900">{r.label}:</span>{' '}
              {r.error ? (
                <span className="text-red-700">{r.error}</span>
              ) : (
                <span className="text-green-700">replay queued — job {r.replayJobId}</span>
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
  if (error)   return <p className="text-sm text-red-600">{error}</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Showing failed exchanges (page {page + 1})</p>
        <button
          onClick={() => void load(page * PAGE_SIZE)}
          className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {exchanges.length === 0 ? (
          <p className="px-5 py-8 text-sm text-gray-400 text-center">No failed exchanges.</p>
        ) : (
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Occurred</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Direction</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Event type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {exchanges.map(ex => (
                <tr key={ex.exchangeId} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-500 whitespace-nowrap">
                    {new Date(ex.createdAt).toLocaleString('en-GB')}
                  </td>
                  <td className="px-4 py-2">
                    <Badge value={ex.directionCode} />
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-700">{ex.exchangeTypeCode}</td>
                  <td className="px-4 py-2 text-xs text-red-700 max-w-xs truncate" title={ex.lastError ?? ''}>
                    {ex.lastError ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center justify-between">
        <button
          disabled={page === 0}
          onClick={() => goPage(page - 1)}
          className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          ← Previous
        </button>
        <button
          disabled={exchanges.length < PAGE_SIZE}
          onClick={() => goPage(page + 1)}
          className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
