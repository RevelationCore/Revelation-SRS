import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  type HealthCheckResult,
  type IntegrationContract,
  type IntegrationExchange,
  type IntegrationRegistration,
  createIntegrationContract,
  createIntegrationRegistration,
  disableIntegration,
  enableIntegration,
  healthCheckIntegration,
  listIntegrationContracts,
  listIntegrationExchanges,
  listIntegrationRegistrations,
  replayIntegration,
} from '../api/integrations.js';
import { ApiError } from '../api/client.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';

type Tab = 'contracts' | 'registrations' | 'exchanges';

const PAGE_SIZE = 20;

export function IntegrationsPage() {
  const [tab, setTab] = useState<Tab>('registrations');

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-4">Integrations</h1>

      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {(['registrations', 'contracts', 'exchanges'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t === 'registrations' ? 'Registrations' : t === 'contracts' ? 'Contracts' : 'Exchange log'}
          </button>
        ))}
      </div>

      {tab === 'registrations' && <RegistrationsTab />}
      {tab === 'contracts'     && <ContractsTab />}
      {tab === 'exchanges'     && <ExchangesTab />}
    </div>
  );
}

// ── Registrations tab ─────────────────────────────────────────────────────────

function RegistrationsTab() {
  const [regs,       setRegs]       = useState<IntegrationRegistration[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [actingId,   setActingId]   = useState<string | null>(null);
  const [healthResults, setHealthResults] = useState<Record<string, HealthCheckResult>>({});
  const [replayFor,  setReplayFor]  = useState<IntegrationRegistration | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setRegs(await listIntegrationRegistrations()); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed to load registrations'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleToggle(reg: IntegrationRegistration) {
    setActingId(reg.registrationId); setError('');
    try {
      if (reg.enabled) await disableIntegration(reg.registrationId);
      else             await enableIntegration(reg.registrationId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Toggle failed');
    } finally {
      setActingId(null);
    }
  }

  async function handleHealthCheck(reg: IntegrationRegistration) {
    setActingId(reg.registrationId); setError('');
    try {
      const result = await healthCheckIntegration(reg.registrationId, 'ok');
      setHealthResults(prev => ({ ...prev, [reg.registrationId]: result }));
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Health check failed');
    } finally {
      setActingId(null);
    }
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button
          onClick={() => setShowCreate(true)}
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          New registration
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : regs.length === 0 ? (
        <p className="text-sm text-gray-600">No integration registrations.</p>
      ) : (
        <div className="space-y-3">
          {regs.map(reg => {
            const health = healthResults[reg.registrationId];
            return (
              <div key={reg.registrationId} className={`bg-white rounded-lg border p-4 ${reg.enabled ? 'border-gray-200' : 'border-gray-100 opacity-70'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{reg.displayName}</p>
                    {reg.endpointUrl && <p className="text-xs text-gray-600 font-mono mt-0.5 truncate max-w-xs">{reg.endpointUrl}</p>}
                    <div className="mt-1 flex items-center gap-2">
                      <Badge value={reg.healthStatusCode ?? (reg.enabled ? 'enabled' : 'disabled')} />
                      {reg.enabled
                        ? <span className="text-xs text-green-600">enabled</span>
                        : <span className="text-xs text-gray-600">disabled</span>}
                      {reg.lastHealthCheckAt && (
                        <span className="text-xs text-gray-600">
                          Last check: {new Date(reg.lastHealthCheckAt).toLocaleString('en-GB')}
                        </span>
                      )}
                    </div>
                    {health && (
                      <div className="mt-1 text-xs rounded px-2 py-0.5 inline-block bg-green-50 text-green-700">
                        Health recorded — {health.healthStatusCode ?? '—'}
                        {health.lastHealthCheckAt
                          ? ` at ${new Date(health.lastHealthCheckAt).toLocaleTimeString('en-GB')}`
                          : ''}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => void handleHealthCheck(reg)}
                      disabled={actingId === reg.registrationId}
                      className="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {actingId === reg.registrationId ? '…' : 'Record OK'}
                    </button>
                    <button
                      onClick={() => setReplayFor(reg)}
                      className="rounded border border-indigo-300 px-2.5 py-1 text-xs text-indigo-700 hover:bg-indigo-50"
                    >
                      Replay
                    </button>
                    <button
                      onClick={() => void handleToggle(reg)}
                      disabled={actingId === reg.registrationId}
                      className={`rounded border px-2.5 py-1 text-xs disabled:opacity-50 ${
                        reg.enabled
                          ? 'border-red-300 text-red-600 hover:bg-red-50'
                          : 'border-green-300 text-green-700 hover:bg-green-50'
                      }`}
                    >
                      {reg.enabled ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreate && (
        <CreateRegModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); void load(); }}
        />
      )}

      {replayFor && (
        <ReplayModal
          reg={replayFor}
          onClose={() => setReplayFor(null)}
        />
      )}
    </div>
  );
}

function CreateRegModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd           = new FormData(e.currentTarget);
    const contractId   = String(fd.get('contractId')   ?? '').trim();
    const transportCode = String(fd.get('transportCode') ?? '').trim();
    const displayName  = String(fd.get('displayName')  ?? '').trim();
    const endpointUrl  = String(fd.get('endpointUrl')  ?? '').trim();
    if (!contractId || !transportCode) { setError('Contract ID and transport code are required.'); return; }
    setSubmitting(true); setError('');
    try {
      await createIntegrationRegistration({
        contractId, transportCode,
        ...(displayName  ? { displayName }  : {}),
        ...(endpointUrl  ? { endpointUrl }  : {}),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg border border-gray-200 p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-gray-900 mb-4">New integration registration</h2>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          <MField name="contractId"    label="Contract ID *" />
          <MField name="transportCode" label="Transport code * (e.g. http, nats)" />
          <MField name="displayName"   label="Display name (optional)" />
          <MField name="endpointUrl"   label="Endpoint URL (optional)" />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
            <button type="submit" disabled={submitting} className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ReplayModal({
  reg,
  onClose,
}: {
  reg:     IntegrationRegistration;
  onClose: () => void;
}) {
  const [replaying, setReplaying] = useState(false);
  const [error,     setError]     = useState('');
  const [success,   setSuccess]   = useState('');

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd       = new FormData(e.currentTarget);
    const fromDate = String(fd.get('fromDate') ?? '').trim();
    const toDate   = String(fd.get('toDate')   ?? '').trim();
    if (!fromDate || !toDate) { setError('From and to dates are required.'); return; }
    setReplaying(true); setError('');
    try {
      const result = await replayIntegration(reg.registrationId, { fromDate, toDate });
      setSuccess(`Replay job started: ${result.replayJobId}`);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Replay failed');
    } finally {
      setReplaying(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg border border-gray-200 p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-gray-900 mb-1">Replay — {reg.displayName}</h2>
        <p className="text-xs text-gray-500 mb-4">
          Re-process integration exchanges in a date range. This is a destructive operation that
          may produce duplicate events — confirm with your integration team before proceeding.
        </p>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          <MField name="fromDate" label="From date (ISO 8601)" />
          <MField name="toDate"   label="To date (ISO 8601)" />
          {error   && <p className="text-sm text-red-600">{error}</p>}
          {success && <p className="text-sm text-green-600">{success}</p>}
          {!success && (
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button type="submit" disabled={replaying} className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
                {replaying ? 'Starting…' : 'Start replay'}
              </button>
            </div>
          )}
          {success && (
            <div className="flex justify-end pt-2">
              <button type="button" onClick={onClose} className="rounded bg-gray-600 px-4 py-2 text-sm font-medium text-white">Close</button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

// ── Contracts tab ─────────────────────────────────────────────────────────────

function ContractsTab() {
  const [contracts,  setContracts]  = useState<IntegrationContract[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setContracts(await listIntegrationContracts()); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed to load contracts'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd          = new FormData(e.currentTarget);
    const name        = String(fd.get('name')        ?? '').trim();
    const version     = String(fd.get('version')     ?? '').trim();
    const direction   = String(fd.get('direction')   ?? '') as 'inbound' | 'outbound' | 'bidirectional';
    const protocolCode = String(fd.get('protocolCode') ?? '').trim();
    if (!name || !version || !protocolCode) return;
    try {
      await createIntegrationContract({ name, version, direction, protocolCode });
      setShowCreate(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Create failed');
    }
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button onClick={() => setShowCreate(s => !s)} className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          New contract
        </button>
      </div>

      {showCreate && (
        <form onSubmit={(e) => void handleCreate(e)} className="flex items-end gap-3 mb-4 bg-indigo-50 rounded-lg p-4">
          <MiniField name="name"         label="Name" />
          <MiniField name="version"      label="Version" />
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Direction</label>
            <select name="direction" className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="inbound">Inbound</option>
              <option value="outbound">Outbound</option>
              <option value="bidirectional">Bidirectional</option>
            </select>
          </div>
          <MiniField name="protocolCode" label="Protocol" />
          <button type="submit" className="rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white">Save</button>
          <button type="button" onClick={() => setShowCreate(false)} className="text-sm text-gray-500">Cancel</button>
        </form>
      )}

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : contracts.length === 0 ? (
        <p className="text-sm text-gray-600">No contracts.</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Version</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Direction</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Protocol</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {contracts.map(c => (
                <tr key={c.contractId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{c.displayName}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{c.currentContractVersion}</td>
                  <td className="px-4 py-3"><Badge value={c.directionCode} /></td>
                  <td className="px-4 py-3 text-gray-600">{c.patternType}</td>
                  <td className="px-4 py-3">
                    {c.deprecatedAt == null
                      ? <span className="text-xs text-green-600">Yes</span>
                      : <span className="text-xs text-gray-600">Deprecated</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Exchanges tab ─────────────────────────────────────────────────────────────

function ExchangesTab() {
  const [exchanges,    setExchanges]    = useState<IntegrationExchange[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [offset,       setOffset]       = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [dirFilter,    setDirFilter]    = useState('');

  const load = useCallback(async (off: number, status?: string, directionCode?: string) => {
    setLoading(true); setError('');
    try {
      setExchanges(await listIntegrationExchanges({
        limit: PAGE_SIZE, offset: off,
        ...(status        ? { statusCode: status }        : {}),
        ...(directionCode ? { directionCode }              : {}),
      }));
      setOffset(off);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load exchanges');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(0); }, [load]);

  function handleFilter(e: FormEvent) {
    e.preventDefault();
    void load(0, statusFilter || undefined, dirFilter || undefined);
  }


  return (
    <div>
      <form onSubmit={handleFilter} className="flex items-center gap-3 mb-4">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
          <option value="">All statuses</option>
          {['pending', 'processed', 'failed', 'retried'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={dirFilter} onChange={(e) => setDirFilter(e.target.value)} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
          <option value="">All directions</option>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
        </select>
        <button type="submit" className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">Filter</button>
        {(statusFilter || dirFilter) && (
          <button type="button" onClick={() => { setStatusFilter(''); setDirFilter(''); void load(0); }} className="text-sm text-gray-500">Clear</button>
        )}
      </form>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : exchanges.length === 0 ? (
        <p className="text-sm text-gray-600">No exchanges found.</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Event type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Direction</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Occurred</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {exchanges.map(ex => (
                <tr key={ex.exchangeId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{ex.exchangeTypeCode}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs capitalize">{ex.directionCode}</td>
                  <td className="px-4 py-3"><Badge value={ex.statusCode} /></td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{new Date(ex.createdAt).toLocaleString('en-GB')}</td>
                  <td className="px-4 py-3 text-red-500 text-xs truncate max-w-xs">{ex.lastError ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex items-center gap-3 text-sm text-gray-600">
            <button
              onClick={() => void load(Math.max(0, offset - PAGE_SIZE), statusFilter || undefined, dirFilter || undefined)}
              disabled={offset === 0}
              className="px-3 py-1 rounded border border-gray-300 disabled:opacity-40 hover:bg-white"
            >
              Previous
            </button>
            {exchanges.length > 0 && <span>{offset + 1}–{offset + exchanges.length}</span>}
            <button
              onClick={() => void load(offset + PAGE_SIZE, statusFilter || undefined, dirFilter || undefined)}
              disabled={exchanges.length < PAGE_SIZE}
              className="px-3 py-1 rounded border border-gray-300 disabled:opacity-40 hover:bg-white"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MField({ name, label }: { name: string; label: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      <input name={name} className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
    </div>
  );
}

function MiniField({ name, label }: { name: string; label: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      <input name={name} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
    </div>
  );
}
