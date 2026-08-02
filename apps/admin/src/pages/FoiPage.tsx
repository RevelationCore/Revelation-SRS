import { type FormEvent, useEffect, useState } from 'react';
import {
  type FoiRequest,
  type FoiExtract,
  listFoiRequests,
  createFoiRequest,
  triggerFoiExtract,
  updateFoiStatus,
} from '../api/foi.js';
import { ApiError } from '../api/client.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';
import { useValueSet } from '../hooks/useValueSet.js';
import {
  PageHeader, Card, CardHeader, CardBody, Button, Input, Select, Textarea, LabelledField,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';

type StatusMember = { code: string; displayLabel: string };

export function FoiPage() {
  const { members: foiStatuses } = useValueSet('foi_request', 'status_code');
  const [requests,  setRequests]  = useState<FoiRequest[]>([]);
  const [selected,  setSelected]  = useState<FoiRequest | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [showForm,  setShowForm]  = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await listFoiRequests();
      setRequests(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load FOI requests');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <div>
      <PageHeader title="Freedom of Information / SAR" actions={<Button onClick={() => setShowForm(true)}>New request</Button>} />

      {error && <p className="mb-4 text-sm text-danger-600">{error}</p>}

      {showForm && (
        <CreateFoiForm
          onCreated={() => { setShowForm(false); void load(); }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <div className="flex gap-6">
          {/* Request list */}
          <div className="w-80 flex-shrink-0">
            {requests.length === 0 ? (
              <p className="text-sm text-neutral-600">No requests recorded.</p>
            ) : (
              <ul className="space-y-1.5">
                {requests.map(r => (
                  <li key={r.requestId}>
                    <button
                      onClick={() => setSelected(r)}
                      className={`w-full text-left rounded-lg border px-4 py-3 transition-colors ${
                        selected?.requestId === r.requestId
                          ? 'border-primary-300 bg-primary-50'
                          : 'border-neutral-200 bg-white hover:border-primary-200'
                      }`}
                    >
                      <p className="text-sm font-medium text-neutral-900">{r.requestReference}</p>
                      <p className="text-xs text-neutral-500 mt-0.5 line-clamp-1">{r.description}</p>
                      <div className="mt-1.5 flex items-center justify-between">
                        <span className="text-xs text-neutral-600">
                          {new Date(r.receivedDate).toLocaleDateString('en-GB')}
                        </span>
                        <Badge value={r.statusCode} />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Detail panel */}
          <div className="flex-1">
            {selected ? (
              <RequestDetail
                request={selected}
                statuses={foiStatuses}
                onUpdated={async (updated) => {
                  setSelected(updated);
                  await load();
                }}
              />
            ) : (
              <div className="rounded-lg border border-dashed border-neutral-200 p-8 text-center">
                <p className="text-sm text-neutral-600">Select a request to view details</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CreateFoiForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [reference, setReference] = useState('');
  const [received,  setReceived]  = useState('');
  const [desc,      setDesc]      = useState('');
  const [basis,     setBasis]     = useState('');
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      await createFoiRequest({
        requestReference: reference,
        receivedDate:     received,
        description:      desc,
        legalBasis:       basis || undefined,
      });
      onCreated();
    } catch (e) {
      setError(e instanceof ApiError ? (e.detail ?? e.message) : 'Failed to create request');
      setSaving(false);
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader title="New FOI / SAR request" />
      <CardBody>
        <form onSubmit={(e) => void handleSubmit(e)}>
          {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <LabelledField label="Reference" htmlFor="foi-ref" required>
              <Input id="foi-ref" value={reference} onChange={e => setReference(e.target.value)} required placeholder="e.g. FOI-2026-001" />
            </LabelledField>
            <LabelledField label="Received date" htmlFor="foi-received" required>
              <Input id="foi-received" type="date" value={received} onChange={e => setReceived(e.target.value)} required />
            </LabelledField>
            <div className="sm:col-span-2">
              <LabelledField label="Description" htmlFor="foi-desc" required>
                <Textarea id="foi-desc" value={desc} onChange={e => setDesc(e.target.value)} required rows={3} />
              </LabelledField>
            </div>
            <LabelledField label="Legal basis" htmlFor="foi-basis" hint="Optional">
              <Input id="foi-basis" value={basis} onChange={e => setBasis(e.target.value)} placeholder="e.g. FOIA 2000, GDPR Art. 15" />
            </LabelledField>
          </div>
          <div className="mt-4 flex gap-3">
            <Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create'}</Button>
            <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function RequestDetail({
  request,
  statuses,
  onUpdated,
}: {
  request:   FoiRequest;
  statuses:  StatusMember[];
  onUpdated: (r: FoiRequest) => Promise<void>;
}) {
  const [extracts,      setExtracts]      = useState<FoiExtract[]>([]);
  const [query,         setQuery]         = useState('');
  const [extracting,    setExtracting]    = useState(false);
  const [newStatus,     setNewStatus]     = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [error,         setError]         = useState('');

  async function handleExtract(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setExtracting(true); setError('');
    try {
      const result = await triggerFoiExtract(request.requestId, query);
      setExtracts(prev => [...prev, result]);
      setQuery('');
    } catch (e) {
      setError(e instanceof ApiError ? (e.detail ?? e.message) : 'Extract failed');
    } finally {
      setExtracting(false);
    }
  }

  async function handleStatusUpdate(e: FormEvent) {
    e.preventDefault();
    if (!newStatus) return;
    setUpdatingStatus(true); setError('');
    try {
      await updateFoiStatus(request.requestId, newStatus);
      await onUpdated({ ...request, statusCode: newStatus });
      setNewStatus('');
    } catch (e) {
      setError(e instanceof ApiError ? (e.detail ?? e.message) : 'Status update failed');
    } finally {
      setUpdatingStatus(false);
    }
  }

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-danger-600">{error}</p>}

      {/* Request summary */}
      <Card>
        <CardBody>
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">{request.requestReference}</h2>
            <p className="text-xs text-neutral-500">Received {new Date(request.receivedDate).toLocaleDateString('en-GB')}</p>
          </div>
          <Badge value={request.statusCode} />
        </div>
        <p className="text-sm text-neutral-700 mb-3">{request.description}</p>
        <div className="text-xs text-neutral-500 space-y-0.5">
          {request.legalBasis && <p>Legal basis: {request.legalBasis}</p>}
          {request.dueDate && (
            <p className={new Date(request.dueDate) < new Date() ? 'text-danger-600 font-medium' : ''}>
              Due: {new Date(request.dueDate).toLocaleDateString('en-GB')}
              {new Date(request.dueDate) < new Date() ? ' (overdue)' : ''}
            </p>
          )}
          {request.closedAt && <p>Closed: {new Date(request.closedAt).toLocaleDateString('en-GB')}</p>}
        </div>
        </CardBody>
      </Card>

      {/* Status update */}
      <Card>
        <CardHeader title="Update status" />
        <CardBody>
        <form onSubmit={(e) => void handleStatusUpdate(e)} className="flex gap-3">
          <Select
            value={newStatus}
            onChange={e => setNewStatus(e.target.value)}
            required
            className="flex-1"
          >
            <option value="">Select new status</option>
            {statuses.filter(({ code }) => code !== request.statusCode).map(({ code, displayLabel }) => (
              <option key={code} value={code}>{displayLabel}</option>
            ))}
          </Select>
          <Button type="submit" disabled={updatingStatus || !newStatus}>
            {updatingStatus ? 'Saving…' : 'Update'}
          </Button>
        </form>
        </CardBody>
      </Card>

      {/* Data extract */}
      <Card>
        <CardHeader title="Trigger data extract" />
        <CardBody>
        <form onSubmit={(e) => void handleExtract(e)} className="flex gap-3 mb-4">
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            required
            placeholder="Query summary / data description"
            className="flex-1"
          />
          <Button type="submit" disabled={extracting || !query.trim()}>
            {extracting ? 'Extracting…' : 'Extract'}
          </Button>
        </form>

        {extracts.length > 0 && (
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Query</TableHeaderCell>
                <TableHeaderCell>Records</TableHeaderCell>
                <TableHeaderCell>Extracted</TableHeaderCell>
                <TableHeaderCell>By</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {extracts.map(ex => (
                <TableRow key={ex.extractId}>
                  <TableCell>{ex.querySummary}</TableCell>
                  <TableCell>{ex.recordCount}</TableCell>
                  <TableCell>
                    {new Date(ex.extractedAt).toLocaleString('en-GB')}
                  </TableCell>
                  <TableCell>{ex.extractedBy}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        </CardBody>
      </Card>
    </div>
  );
}
