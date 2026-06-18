import { useCallback, useEffect, useState } from 'react';
import {
  type IntegrationExchange,
  listIntegrationExchanges,
} from '../api/integrations.js';
import { ApiError } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';

const AUDIT_ROLES = ['dpo', 'system-administrator', 'wellbeing-auditor'];

export function AuditPage() {
  const { roles } = useAuth();
  const canRead   = AUDIT_ROLES.some(r => roles.includes(r));

  return (
    <div>
      <p className="text-xs text-gray-400 mb-0.5">Tenant administration</p>
      <h1 className="text-xl font-semibold text-gray-900 mb-4">Audit log</h1>

      <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-medium text-amber-800">Residual gap — Phase 10</p>
        <p className="text-xs text-amber-700 mt-1">
          A dedicated entity-level audit log API is not yet available. The exchange log below
          covers integration events. Full entity audit trails (student record changes, enrolment
          transitions, mark corrections) are captured server-side and will be surfaced in Phase 11
          via <code className="font-mono">/api/v1/audit-log</code>.
        </p>
      </div>

      {canRead ? (
        <IntegrationExchangeAudit />
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm text-gray-500">
            Audit log access requires the <strong>dpo</strong>, <strong>system-administrator</strong>,
            or <strong>wellbeing-auditor</strong> role.
          </p>
        </div>
      )}
    </div>
  );
}

function IntegrationExchangeAudit() {
  const [exchanges, setExchanges] = useState<IntegrationExchange[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setExchanges(await listIntegrationExchanges({ limit: 50 }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load exchange log');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-700">Integration exchange log (most recent 50)</h2>
        <button
          onClick={() => void load()}
          className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : exchanges.length === 0 ? (
        <p className="text-sm text-gray-400">No exchange records found.</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Exchange ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Event type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Direction</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Occurred</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Processed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {exchanges.map(ex => (
                <tr key={ex.exchangeId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">{ex.exchangeId.slice(0, 8)}…</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{ex.eventType ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs capitalize">{ex.direction}</td>
                  <td className="px-4 py-3"><Badge value={ex.statusCode} /></td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {new Date(ex.occurredAt).toLocaleString('en-GB')}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {ex.processedAt
                      ? new Date(ex.processedAt).toLocaleString('en-GB')
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
