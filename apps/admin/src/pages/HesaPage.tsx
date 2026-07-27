import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  type HesaReturn,
  type HesaValidationResult,
  createHesaReturn,
  downloadHesaFile,
  getHesaReturn,
  listHesaReturns,
  submitHesaReturn,
  validateHesaReturn,
} from '../api/regulatory.js';
import { ApiError } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';

export function HesaPage() {
  const { token }          = useAuth();
  const [returns,   setReturns]   = useState<HesaReturn[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [creating,  setCreating]  = useState(false);
  const [yearInput, setYearInput] = useState('');
  const [selected,  setSelected]  = useState<HesaReturn | null>(null);
  const [validation, setValidation] = useState<HesaValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setReturns(await listHesaReturns());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load returns');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const year = yearInput.trim();
    if (!year) return;
    setCreating(true);
    setActionError('');
    try {
      const { returnId } = await createHesaReturn(year);
      setShowCreate(false);
      setYearInput('');
      await load();
      const r = await getHesaReturn(returnId);
      setSelected(r);
    } catch (err) {
      setActionError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to create return');
    } finally {
      setCreating(false);
    }
  }

  async function handleValidate(returnId: string) {
    setValidating(true);
    setActionError('');
    setValidation(null);
    try {
      const result = await validateHesaReturn(returnId);
      setValidation(result);
    } catch (err) {
      setActionError(err instanceof ApiError ? (err.detail ?? err.message) : 'Validation failed');
    } finally {
      setValidating(false);
    }
  }

  async function handleDownload(returnId: string) {
    setDownloading(true);
    setActionError('');
    try {
      await downloadHesaFile(returnId, token);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  }

  async function handleSubmit(returnId: string) {
    setSubmitting(true);
    setActionError('');
    try {
      await submitHesaReturn(returnId);
      const r = await getHesaReturn(returnId);
      setSelected(r);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? (err.detail ?? err.message) : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">HESA returns</h1>
        </div>
        <button
          onClick={() => setShowCreate(s => !s)}
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          New return
        </button>
      </div>

      {showCreate && (
        <form onSubmit={(e) => void handleCreate(e)} className="mb-4 flex items-center gap-3 bg-indigo-50 rounded-lg p-4">
          <label className="text-sm text-gray-700">Academic year:</label>
          <input
            value={yearInput}
            onChange={(e) => setYearInput(e.target.value)}
            placeholder="e.g. 2025/26"
            className="rounded border border-gray-300 px-3 py-1.5 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit"
            disabled={creating}
            className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
          <button type="button" onClick={() => setShowCreate(false)} className="text-sm text-gray-500">
            Cancel
          </button>
        </form>
      )}

      {actionError && <p className="mb-4 text-sm text-red-600">{actionError}</p>}

      <div className="grid grid-cols-3 gap-6">
        {/* Returns list */}
        <div className="col-span-1">
          {loading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : returns.length === 0 ? (
            <p className="text-sm text-gray-600">No returns yet.</p>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <ul className="divide-y divide-gray-100">
                {returns.map(r => (
                  <li key={r.returnId}>
                    <button
                      onClick={() => { setSelected(r); setValidation(null); setActionError(''); }}
                      className={`w-full text-left px-4 py-3 text-sm hover:bg-gray-50 ${
                        selected?.returnId === r.returnId ? 'bg-indigo-50' : ''
                      }`}
                    >
                      <div className="font-medium text-gray-900">{r.academicYear}</div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <Badge value={r.statusCode} />
                        <span className="text-xs text-gray-600">{r.recordCount} records</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Return detail */}
        <div className="col-span-2">
          {selected ? (
            <div className="space-y-4">
              <div className="bg-white rounded-lg border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-gray-700">
                    Return {selected.academicYear}
                  </h2>
                  <Badge value={selected.statusCode} />
                </div>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <InfoRow label="Records"   value={String(selected.recordCount)} />
                  <InfoRow label="Generated" value={new Date(selected.generatedAt).toLocaleString('en-GB')} />
                  <InfoRow label="Validated" value={selected.validatedAt
                    ? new Date(selected.validatedAt).toLocaleString('en-GB')
                    : null} />
                  <InfoRow label="Submitted" value={selected.submittedAt
                    ? new Date(selected.submittedAt).toLocaleString('en-GB')
                    : null} />
                  <InfoRow label="Reference" value={selected.submissionReference} />
                </dl>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => void handleValidate(selected.returnId)}
                    disabled={validating}
                    className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {validating ? 'Validating…' : 'Validate'}
                  </button>
                  <button
                    onClick={() => void handleDownload(selected.returnId)}
                    disabled={downloading}
                    className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {downloading ? 'Downloading…' : 'Download XML'}
                  </button>
                  {selected.statusCode !== 'submitted' && (
                    <button
                      onClick={() => void handleSubmit(selected.returnId)}
                      disabled={submitting}
                      className="rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      {submitting ? 'Submitting…' : 'Submit to HESA'}
                    </button>
                  )}
                </div>
              </div>

              {validation && (
                <div className={`rounded-lg border p-4 ${validation.isValid ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                  <p className={`text-sm font-semibold mb-2 ${validation.isValid ? 'text-green-800' : 'text-red-800'}`}>
                    {validation.isValid ? 'Validation passed' : `${validation.errors.length} error(s), ${validation.warnings.length} warning(s)`}
                  </p>
                  {validation.errors.map((e, i) => (
                    <p key={i} className="text-xs text-red-700">
                      <strong>{e.field}:</strong> {e.message}
                      {e.enrolmentId && <span className="text-red-500"> ({e.enrolmentId})</span>}
                    </p>
                  ))}
                  {validation.warnings.map((w, i) => (
                    <p key={i} className="text-xs text-amber-700">
                      <strong>{w.field}:</strong> {w.message}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-600 py-8 text-center">Select a return to view details.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 flex-shrink-0 text-gray-500 text-xs pt-0.5">{label}</dt>
      <dd className="text-gray-900 text-xs">{value ?? <span className="text-gray-600">—</span>}</dd>
    </div>
  );
}
