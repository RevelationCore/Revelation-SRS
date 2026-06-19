import { useCallback, useEffect, useState } from 'react';
import {
  type CasRequest,
  type ComplianceAlert,
  evaluateComplianceAlerts,
  generateCasRequests,
  listCasRequests,
  listComplianceAlerts,
  resolveComplianceAlert,
} from '../api/regulatory.js';
import { ApiError } from '../api/client.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';

type Tab = 'cas' | 'compliance';

export function UkviPage() {
  const [tab, setTab] = useState<Tab>('cas');

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-4">UKVI</h1>

      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {(['cas', 'compliance'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t === 'cas' ? 'CAS requests' : 'Compliance alerts'}
          </button>
        ))}
      </div>

      {tab === 'cas'        && <CasTab />}
      {tab === 'compliance' && <ComplianceTab />}
    </div>
  );
}

function CasTab() {
  const [requests,   setRequests]   = useState<CasRequest[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [generating, setGenerating] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRequests(await listCasRequests());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load CAS requests');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleGenerate() {
    setGenerating(true);
    setError('');
    setSuccessMsg('');
    try {
      const result = await generateCasRequests();
      setSuccessMsg(`Generated ${result.processedCount} CAS request(s).`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to generate CAS requests');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-600">Confirmation of Acceptance for Studies (CAS) requests for international students.</p>
        <button
          onClick={() => void handleGenerate()}
          disabled={generating}
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {generating ? 'Generating…' : 'Generate CAS requests'}
        </button>
      </div>

      {error      && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {successMsg && <p className="mb-4 text-sm text-green-600">{successMsg}</p>}

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : requests.length === 0 ? (
        <p className="text-sm text-gray-400">No CAS requests found.</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Enrolment</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">CAS reference</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Requested</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {requests.map(r => (
                <tr key={r.casRequestId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{r.enrolmentId}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">
                    {r.casReference ?? <span className="text-gray-400">pending</span>}
                  </td>
                  <td className="px-4 py-3"><Badge value={r.statusCode} /></td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {new Date(r.requestedAt).toLocaleDateString('en-GB')}
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

function ComplianceTab() {
  const [alerts,     setAlerts]     = useState<ComplianceAlert[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [evaluating, setEvaluating] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setAlerts(await listComplianceAlerts());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load compliance alerts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleEvaluate() {
    setEvaluating(true);
    setError('');
    setSuccessMsg('');
    try {
      await evaluateComplianceAlerts();
      setSuccessMsg('Compliance evaluation complete.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Evaluation failed');
    } finally {
      setEvaluating(false);
    }
  }

  async function handleResolve(alertId: string) {
    setResolvingId(alertId);
    setError('');
    try {
      await resolveComplianceAlert(alertId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Resolve failed');
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-600">Attendance and compliance alerts for Tier 4 / Student visa holders.</p>
        <button
          onClick={() => void handleEvaluate()}
          disabled={evaluating}
          className="rounded border border-indigo-300 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
        >
          {evaluating ? 'Evaluating…' : 'Re-evaluate alerts'}
        </button>
      </div>

      {error      && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {successMsg && <p className="mb-4 text-sm text-green-600">{successMsg}</p>}

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : alerts.length === 0 ? (
        <p className="text-sm text-gray-400">No compliance alerts.</p>
      ) : (
        <div className="space-y-3">
          {alerts.map(a => (
            <div key={a.alertId} className={`bg-white rounded-lg border p-4 ${a.resolvedAt ? 'border-gray-200' : 'border-amber-300'}`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-900 capitalize">{a.alertTypeCode}</p>
                  <p className="text-xs text-gray-500 font-mono mt-0.5">{a.enrolmentId}</p>
                  {a.casReference && (
                    <p className="text-xs text-gray-500 mt-0.5">CAS: {a.casReference}</p>
                  )}
                </div>
                <div className="text-right text-xs text-gray-500">
                  <p>Triggered: {new Date(a.triggeredAt).toLocaleDateString('en-GB')}</p>
                  {a.resolvedAt && <p className="text-green-600">Resolved: {new Date(a.resolvedAt).toLocaleDateString('en-GB')}</p>}
                </div>
              </div>
              {!a.resolvedAt && (
                <div className="mt-3">
                  <button
                    onClick={() => void handleResolve(a.alertId)}
                    disabled={resolvingId === a.alertId}
                    className="rounded border border-green-300 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"
                  >
                    {resolvingId === a.alertId ? 'Resolving…' : 'Mark resolved'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
