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
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import {
  PageHeader, Card, CardBody, Button, Input, Select, LabelledField, Dialog, DialogClose,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@revelation-srs/ui';

type Tab = 'contracts' | 'registrations' | 'exchanges';

const PAGE_SIZE = 20;

export function IntegrationsPage() {
  const [tab, setTab] = useState<Tab>('registrations');
  const { roles } = useAuth();
  const canManage = userHasAnyPermission(roles, ['integration:manage']);

  return (
    <div>
      <PageHeader title="Integrations" />

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="mb-6">
          <TabsTrigger value="registrations">Registrations</TabsTrigger>
          <TabsTrigger value="contracts">Contracts</TabsTrigger>
          <TabsTrigger value="exchanges">Exchange log</TabsTrigger>
        </TabsList>
        <TabsContent value="registrations"><RegistrationsTab canManage={canManage} /></TabsContent>
        <TabsContent value="contracts"><ContractsTab canManage={canManage} /></TabsContent>
        <TabsContent value="exchanges"><ExchangesTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ── Registrations tab ─────────────────────────────────────────────────────────

function RegistrationsTab({ canManage }: { canManage: boolean }) {
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
      {canManage && <div className="flex justify-end mb-4">
        <Button onClick={() => setShowCreate(true)}>New registration</Button>
      </div>}

      {error && <p className="mb-4 text-sm text-danger-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : regs.length === 0 ? (
        <p className="text-sm text-neutral-600">No integration registrations.</p>
      ) : (
        <div className="space-y-3">
          {regs.map(reg => {
            const health = healthResults[reg.registrationId];
            return (
              <Card key={reg.registrationId} className={reg.enabled ? '' : 'opacity-70'}>
                <CardBody className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-neutral-900">{reg.displayName}</p>
                    {reg.endpointUrl && <p className="text-xs text-neutral-600 font-mono mt-0.5 truncate max-w-xs">{reg.endpointUrl}</p>}
                    <div className="mt-1 flex items-center gap-2">
                      <Badge value={reg.healthStatusCode ?? (reg.enabled ? 'enabled' : 'disabled')} />
                      {reg.enabled
                        ? <span className="text-xs text-success-600">enabled</span>
                        : <span className="text-xs text-neutral-600">disabled</span>}
                      {reg.lastHealthCheckAt && (
                        <span className="text-xs text-neutral-600">
                          Last check: {new Date(reg.lastHealthCheckAt).toLocaleString('en-GB')}
                        </span>
                      )}
                    </div>
                    {health && (
                      <div className="mt-1 text-xs rounded px-2 py-0.5 inline-block bg-success-50 text-success-700">
                        Health recorded — {health.healthStatusCode ?? '—'}
                        {health.lastHealthCheckAt
                          ? ` at ${new Date(health.lastHealthCheckAt).toLocaleTimeString('en-GB')}`
                          : ''}
                      </div>
                    )}
                  </div>
                  {canManage && <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void handleHealthCheck(reg)}
                      disabled={actingId === reg.registrationId}
                    >
                      {actingId === reg.registrationId ? '…' : 'Record OK'}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="border-primary-300 text-primary-700 hover:bg-primary-50"
                      onClick={() => setReplayFor(reg)}
                    >
                      Replay
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className={reg.enabled ? 'border-danger-300 text-danger-600 hover:bg-danger-50' : 'border-success-300 text-success-700 hover:bg-success-50'}
                      onClick={() => void handleToggle(reg)}
                      disabled={actingId === reg.registrationId}
                    >
                      {reg.enabled ? 'Disable' : 'Enable'}
                    </Button>
                  </div>}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {canManage && (
        <Dialog open={showCreate} onOpenChange={(open) => { if (!open) setShowCreate(false); }} title="New integration registration">
          <CreateRegForm
            onClose={() => setShowCreate(false)}
            onCreated={() => { setShowCreate(false); void load(); }}
          />
        </Dialog>
      )}

      {canManage && (
        <Dialog open={replayFor !== null} onOpenChange={(open) => { if (!open) setReplayFor(null); }} title={replayFor ? `Replay — ${replayFor.displayName}` : ''}>
          {replayFor && <ReplayForm reg={replayFor} onClose={() => setReplayFor(null)} />}
        </Dialog>
      )}
    </div>
  );
}

function CreateRegForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
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
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
      <LabelledField label="Contract ID" htmlFor="ir-contract" required><Input id="ir-contract" name="contractId" /></LabelledField>
      <LabelledField label="Transport code" htmlFor="ir-transport" required hint="e.g. http, nats"><Input id="ir-transport" name="transportCode" /></LabelledField>
      <LabelledField label="Display name" htmlFor="ir-name" hint="Optional"><Input id="ir-name" name="displayName" /></LabelledField>
      <LabelledField label="Endpoint URL" htmlFor="ir-url" hint="Optional"><Input id="ir-url" name="endpointUrl" /></LabelledField>
      {error && <p className="text-sm text-danger-600">{error}</p>}
      <div className="flex justify-end gap-3 pt-2">
        <DialogClose asChild>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </DialogClose>
        <Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create'}</Button>
      </div>
    </form>
  );
}

function ReplayForm({
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
    <div>
      <p className="text-xs text-neutral-500 mb-4">
        Re-process integration exchanges in a date range. This is a destructive operation that
        may produce duplicate events — confirm with your integration team before proceeding.
      </p>
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
        <LabelledField label="From date" htmlFor="rp-from" hint="ISO 8601"><Input id="rp-from" name="fromDate" /></LabelledField>
        <LabelledField label="To date" htmlFor="rp-to" hint="ISO 8601"><Input id="rp-to" name="toDate" /></LabelledField>
        {error   && <p className="text-sm text-danger-600">{error}</p>}
        {success && <p className="text-sm text-success-600">{success}</p>}
        {!success && (
          <div className="flex justify-end gap-3 pt-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={replaying} className="bg-warning-600 hover:bg-warning-700">
              {replaying ? 'Starting…' : 'Start replay'}
            </Button>
          </div>
        )}
        {success && (
          <div className="flex justify-end pt-2">
            <DialogClose asChild>
              <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
            </DialogClose>
          </div>
        )}
      </form>
    </div>
  );
}

// ── Contracts tab ─────────────────────────────────────────────────────────────

function ContractsTab({ canManage }: { canManage: boolean }) {
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
        {canManage && <Button onClick={() => setShowCreate(s => !s)}>New contract</Button>}
      </div>

      {canManage && showCreate && (
        <form onSubmit={(e) => void handleCreate(e)} className="flex items-end gap-3 mb-4 bg-primary-50 rounded-lg p-4">
          <MiniField name="name"         label="Name" />
          <MiniField name="version"      label="Version" />
          <LabelledField label="Direction" htmlFor="ic-direction">
            <Select id="ic-direction" name="direction">
              <option value="inbound">Inbound</option>
              <option value="outbound">Outbound</option>
              <option value="bidirectional">Bidirectional</option>
            </Select>
          </LabelledField>
          <MiniField name="protocolCode" label="Protocol" />
          <Button type="submit">Save</Button>
          <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
        </form>
      )}

      {error && <p className="mb-4 text-sm text-danger-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : contracts.length === 0 ? (
        <p className="text-sm text-neutral-600">No contracts.</p>
      ) : (
        <Card>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Version</TableHeaderCell>
                <TableHeaderCell>Direction</TableHeaderCell>
                <TableHeaderCell>Protocol</TableHeaderCell>
                <TableHeaderCell>Active</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {contracts.map(c => (
                <TableRow key={c.contractId}>
                  <TableCell className="font-medium text-neutral-900">{c.displayName}</TableCell>
                  <TableCell className="font-mono text-xs">{c.currentContractVersion}</TableCell>
                  <TableCell><Badge value={c.directionCode} /></TableCell>
                  <TableCell>{c.patternType}</TableCell>
                  <TableCell>
                    {c.deprecatedAt == null
                      ? <span className="text-xs text-success-600">Yes</span>
                      : <span className="text-xs text-neutral-600">Deprecated</span>}
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
        <Select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-auto">
          <option value="">All statuses</option>
          {['pending', 'processed', 'failed', 'retried'].map(s => <option key={s} value={s}>{s}</option>)}
        </Select>
        <Select aria-label="Filter by direction" value={dirFilter} onChange={(e) => setDirFilter(e.target.value)} className="w-auto">
          <option value="">All directions</option>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
        </Select>
        <Button type="submit">Filter</Button>
        {(statusFilter || dirFilter) && (
          <Button type="button" variant="ghost" onClick={() => { setStatusFilter(''); setDirFilter(''); void load(0); }}>Clear</Button>
        )}
      </form>

      {error && <p className="mb-4 text-sm text-danger-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : exchanges.length === 0 ? (
        <p className="text-sm text-neutral-600">No exchanges found.</p>
      ) : (
        <Card>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Event type</TableHeaderCell>
                <TableHeaderCell>Direction</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Occurred</TableHeaderCell>
                <TableHeaderCell>Error</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {exchanges.map(ex => (
                <TableRow key={ex.exchangeId}>
                  <TableCell className="font-mono text-xs text-neutral-700">{ex.exchangeTypeCode}</TableCell>
                  <TableCell className="text-xs capitalize">{ex.directionCode}</TableCell>
                  <TableCell><Badge value={ex.statusCode} /></TableCell>
                  <TableCell className="text-xs">{new Date(ex.createdAt).toLocaleString('en-GB')}</TableCell>
                  <TableCell className="text-danger-500 text-xs truncate max-w-xs">{ex.lastError ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="px-4 py-3 bg-neutral-50 border-t border-neutral-200 flex items-center gap-3 text-sm text-neutral-600">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void load(Math.max(0, offset - PAGE_SIZE), statusFilter || undefined, dirFilter || undefined)}
              disabled={offset === 0}
            >
              Previous
            </Button>
            {exchanges.length > 0 && <span>{offset + 1}–{offset + exchanges.length}</span>}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void load(offset + PAGE_SIZE, statusFilter || undefined, dirFilter || undefined)}
              disabled={exchanges.length < PAGE_SIZE}
            >
              Next
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function MiniField({ name, label }: { name: string; label: string }) {
  return (
    <LabelledField label={label} htmlFor={`ic-${name}`}>
      <Input id={`ic-${name}`} name={name} />
    </LabelledField>
  );
}
