import { useCallback, useEffect, useState } from 'react';
import {
  type OfsB3Extract,
  generateOfsB3Extract,
  generateOfsParticipationReport,
  getOfsB3Extract,
} from '../api/regulatory.js';
import { ApiError } from '../api/client.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';

export function OfsPage() {
  const [extracts,         setExtracts]         = useState<OfsB3Extract[]>([]);
  const [loading,          setLoading]          = useState(false);
  const [error,            setError]            = useState('');
  const [generatingB3,     setGeneratingB3]     = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [successMsg,       setSuccessMsg]       = useState('');
  const [selected,         setSelected]         = useState<OfsB3Extract | null>(null);
  const [polling,          setPolling]          = useState<string | null>(null);

  const load = useCallback(async () => {
    // OfS doesn't have a list endpoint in the API — we accumulate locally
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!polling) return;
    const id = setInterval(async () => {
      try {
        const ext = await getOfsB3Extract(polling);
        if (ext.statusCode !== 'pending') {
          setPolling(null);
          setExtracts(prev => prev.map(e => e.extractId === ext.extractId ? ext : e));
          if (selected?.extractId === ext.extractId) setSelected(ext);
        }
      } catch { /* keep polling */ }
    }, 3000);
    return () => clearInterval(id);
  }, [polling, selected]);

  async function handleGenerateB3() {
    setGeneratingB3(true);
    setError('');
    setSuccessMsg('');
    try {
      const { extractId } = await generateOfsB3Extract();
      const ext = await getOfsB3Extract(extractId);
      setExtracts(prev => [ext, ...prev]);
      setSelected(ext);
      if (ext.statusCode === 'pending') setPolling(extractId);
      setSuccessMsg('B3 extract generation started.');
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to start B3 extract');
    } finally {
      setGeneratingB3(false);
    }
  }

  async function handleGenerateReport() {
    setGeneratingReport(true);
    setError('');
    setSuccessMsg('');
    try {
      await generateOfsParticipationReport();
      setSuccessMsg('Participation report generation started.');
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to generate report');
    } finally {
      setGeneratingReport(false);
    }
  }

  return (
    <div>
      <p className="text-xs text-gray-400 mb-0.5">Regulatory</p>
      <h1 className="text-xl font-semibold text-gray-900 mb-6">Office for Students (OfS)</h1>

      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => void handleGenerateB3()}
          disabled={generatingB3}
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {generatingB3 ? 'Generating…' : 'Generate B3 extract'}
        </button>
        <button
          onClick={() => void handleGenerateReport()}
          disabled={generatingReport}
          className="rounded border border-indigo-300 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
        >
          {generatingReport ? 'Generating…' : 'Generate participation report'}
        </button>
      </div>

      {error      && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {successMsg && <p className="mb-4 text-sm text-green-600">{successMsg}</p>}

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : extracts.length === 0 ? (
        <p className="text-sm text-gray-400">No B3 extracts generated in this session.</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Extract ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Generated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {extracts.map(e => (
                <tr
                  key={e.extractId}
                  onClick={() => setSelected(e)}
                  className={`cursor-pointer hover:bg-gray-50 ${selected?.extractId === e.extractId ? 'bg-indigo-50' : ''}`}
                >
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{e.extractId}</td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1.5">
                      <Badge value={e.statusCode} />
                      {polling === e.extractId && <Spinner />}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {e.generatedAt
                      ? new Date(e.generatedAt).toLocaleString('en-GB')
                      : <span className="text-gray-400">—</span>}
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
