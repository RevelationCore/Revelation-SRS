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
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Freedom of Information / SAR</h1>
        <button
          onClick={() => setShowForm(true)}
          className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          New request
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

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
              <p className="text-sm text-gray-400">No requests recorded.</p>
            ) : (
              <ul className="space-y-1.5">
                {requests.map(r => (
                  <li key={r.requestId}>
                    <button
                      onClick={() => setSelected(r)}
                      className={`w-full text-left rounded-lg border px-4 py-3 transition-colors ${
                        selected?.requestId === r.requestId
                          ? 'border-indigo-300 bg-indigo-50'
                          : 'border-gray-200 bg-white hover:border-indigo-200'
                      }`}
                    >
                      <p className="text-sm font-medium text-gray-900">{r.requestReference}</p>
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{r.description}</p>
                      <div className="mt-1.5 flex items-center justify-between">
                        <span className="text-xs text-gray-400">
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
              <div className="rounded-lg border border-dashed border-gray-200 p-8 text-center">
                <p className="text-sm text-gray-400">Select a request to view details</p>
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
    <form onSubmit={(e) => void handleSubmit(e)} className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-gray-700 mb-4">New FOI / SAR request</h2>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Reference *</label>
          <input
            value={reference}
            onChange={e => setReference(e.target.value)}
            required
            placeholder="e.g. FOI-2026-001"
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Received date *</label>
          <input
            type="date"
            value={received}
            onChange={e => setReceived(e.target.value)}
            required
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Description *</label>
          <textarea
            value={desc}
            onChange={e => setDesc(e.target.value)}
            required
            rows={3}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Legal basis</label>
          <input
            value={basis}
            onChange={e => setBasis(e.target.value)}
            placeholder="e.g. FOIA 2000, GDPR Art. 15"
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
          />
        </div>
      </div>
      <div className="mt-4 flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? 'Creating…' : 'Create'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
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
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Request summary */}
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{request.requestReference}</h2>
            <p className="text-xs text-gray-500">Received {new Date(request.receivedDate).toLocaleDateString('en-GB')}</p>
          </div>
          <Badge value={request.statusCode} />
        </div>
        <p className="text-sm text-gray-700 mb-3">{request.description}</p>
        <div className="text-xs text-gray-500 space-y-0.5">
          {request.legalBasis && <p>Legal basis: {request.legalBasis}</p>}
          {request.dueDate && (
            <p className={new Date(request.dueDate) < new Date() ? 'text-red-600 font-medium' : ''}>
              Due: {new Date(request.dueDate).toLocaleDateString('en-GB')}
              {new Date(request.dueDate) < new Date() ? ' (overdue)' : ''}
            </p>
          )}
          {request.closedAt && <p>Closed: {new Date(request.closedAt).toLocaleDateString('en-GB')}</p>}
        </div>
      </div>

      {/* Status update */}
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Update status</h3>
        <form onSubmit={(e) => void handleStatusUpdate(e)} className="flex gap-3">
          <select
            value={newStatus}
            onChange={e => setNewStatus(e.target.value)}
            required
            className="rounded border border-gray-300 px-2 py-1.5 text-sm flex-1"
          >
            <option value="">Select new status</option>
            {statuses.filter(({ code }) => code !== request.statusCode).map(({ code, displayLabel }) => (
              <option key={code} value={code}>{displayLabel}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={updatingStatus || !newStatus}
            className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {updatingStatus ? 'Saving…' : 'Update'}
          </button>
        </form>
      </div>

      {/* Data extract */}
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Trigger data extract</h3>
        <form onSubmit={(e) => void handleExtract(e)} className="flex gap-3 mb-4">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            required
            placeholder="Query summary / data description"
            className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={extracting || !query.trim()}
            className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {extracting ? 'Extracting…' : 'Extract'}
          </button>
        </form>

        {extracts.length > 0 && (
          <table className="min-w-full text-sm divide-y divide-gray-100">
            <thead>
              <tr>
                <th className="py-2 text-left text-xs font-medium text-gray-500 uppercase">Query</th>
                <th className="py-2 text-left text-xs font-medium text-gray-500 uppercase">Records</th>
                <th className="py-2 text-left text-xs font-medium text-gray-500 uppercase">Extracted</th>
                <th className="py-2 text-left text-xs font-medium text-gray-500 uppercase">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {extracts.map(ex => (
                <tr key={ex.extractId}>
                  <td className="py-1.5 text-gray-700">{ex.querySummary}</td>
                  <td className="py-1.5 text-gray-500">{ex.recordCount}</td>
                  <td className="py-1.5 text-gray-500">
                    {new Date(ex.extractedAt).toLocaleString('en-GB')}
                  </td>
                  <td className="py-1.5 text-gray-500">{ex.extractedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
