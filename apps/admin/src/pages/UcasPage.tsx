import { useCallback, useEffect, useState } from 'react';
import {
  type UcasApplication,
  generateUcasConfirmations,
  listUcasApplications,
} from '../api/regulatory.js';
import { ApiError } from '../api/client.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';

export function UcasPage() {
  const [applications, setApplications] = useState<UcasApplication[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [generating,   setGenerating]   = useState(false);
  const [successMsg,   setSuccessMsg]   = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setApplications(await listUcasApplications());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load applications');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleGenerateConfirmations() {
    setGenerating(true);
    setError('');
    setSuccessMsg('');
    try {
      await generateUcasConfirmations();
      setSuccessMsg('Confirmations generated and queued for transmission.');
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to generate confirmations');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">UCAS applications</h1>
        </div>
        <button
          onClick={() => void handleGenerateConfirmations()}
          disabled={generating}
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {generating ? 'Generating…' : 'Generate confirmations'}
        </button>
      </div>

      {error      && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {successMsg && <p className="mb-4 text-sm text-green-600">{successMsg}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : applications.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">No UCAS applications on record.</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">UCAS personal ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cycle</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Received</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Linked enrolment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {applications.map(a => (
                <tr key={a.applicationId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{a.ucasPersonalId}</td>
                  <td className="px-4 py-3 text-gray-600">{a.cycle}</td>
                  <td className="px-4 py-3"><Badge value={a.statusCode} /></td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {new Date(a.receivedAt).toLocaleDateString('en-GB')}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">
                    {a.linkedEnrolmentId ?? <span className="text-gray-400">—</span>}
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
