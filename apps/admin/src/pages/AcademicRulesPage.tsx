import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  type AcademicRule,
  createAcademicRule,
  deleteAcademicRule,
  getAcademicRuleHistory,
  listAcademicRules,
} from '../api/academicRules.js';
import { ApiError } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';
import { useValueSet } from '../hooks/useValueSet.js';

export function AcademicRulesPage() {
  const { roles }              = useAuth();
  const canWrite               = userHasAnyPermission(roles, ['rule:write']);
  const { members: ruleTypes } = useValueSet('academic_rule', 'rule_type_code');
  const [rules,       setRules]       = useState<AcademicRule[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [typeFilter,  setTypeFilter]  = useState('');
  const [showCreate,  setShowCreate]  = useState(false);
  const [historyFor,  setHistoryFor]  = useState<AcademicRule | null>(null);
  const [history,     setHistory]     = useState<AcademicRule[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [deleting,    setDeleting]    = useState<string | null>(null);
  const [confirmDel,  setConfirmDel]  = useState<string | null>(null);

  const load = useCallback(async (typeCode?: string) => {
    setLoading(true); setError('');
    try {
      setRules(await listAcademicRules(typeCode ? { ruleTypeCode: typeCode } : undefined));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load rules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function handleFilter(e: FormEvent) {
    e.preventDefault();
    void load(typeFilter || undefined);
  }

  async function handleDelete(ruleId: string) {
    setDeleting(ruleId); setError('');
    try {
      await deleteAcademicRule(ruleId);
      setConfirmDel(null);
      await load(typeFilter || undefined);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Delete failed');
    } finally {
      setDeleting(null);
    }
  }

  async function handleShowHistory(rule: AcademicRule) {
    setHistoryFor(rule);
    setHistLoading(true);
    try {
      setHistory(await getAcademicRuleHistory(rule.academicRuleId));
    } catch { /* ignore */ }
    finally { setHistLoading(false); }
  }

  function handleCreated() {
    setShowCreate(false);
    void load(typeFilter || undefined);
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-4">Academic rules</h1>

      {!canWrite && (
        <p className="mb-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          You have read-only access to academic rules.
        </p>
      )}

      <div className="flex items-center justify-between mb-4">
        <form onSubmit={handleFilter} className="flex items-center gap-3">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="">All types</option>
            {ruleTypes.map(({ code, displayLabel }) => <option key={code} value={code}>{displayLabel}</option>)}
          </select>
          <button type="submit" className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
            Filter
          </button>
          {typeFilter && (
            <button type="button" onClick={() => { setTypeFilter(''); void load(); }} className="text-sm text-gray-500">
              Clear
            </button>
          )}
        </form>
        {canWrite && (
          <button
            onClick={() => setShowCreate(true)}
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            New rule
          </button>
        )}
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : rules.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-600">No academic rules found.</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Effective from</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Effective to</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Recorded</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rules.map(r => (
                <tr key={r.academicRuleId} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{r.ruleKey}</p>
                    {r.description && <p className="text-xs text-gray-600">{r.description}</p>}
                  </td>
                  <td className="px-4 py-3"><Badge value={r.ruleTypeCode} /></td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{r.validFrom ? new Date(r.validFrom).toLocaleDateString('en-GB') : '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{r.validTo ? new Date(r.validTo).toLocaleDateString('en-GB') : '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{r.recordedAt ? new Date(r.recordedAt).toLocaleDateString('en-GB') : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <span className="inline-flex items-center gap-3">
                      <button
                        onClick={() => void handleShowHistory(r)}
                        className="text-xs text-indigo-600 hover:text-indigo-800"
                      >
                        History
                      </button>
                      {canWrite && (
                        confirmDel === r.academicRuleId ? (
                          <span className="inline-flex items-center gap-2">
                            <button
                              onClick={() => void handleDelete(r.academicRuleId)}
                              disabled={deleting === r.academicRuleId}
                              className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
                            >
                              {deleting === r.academicRuleId ? 'Deleting…' : 'Confirm delete'}
                            </button>
                            <button onClick={() => setConfirmDel(null)} className="text-xs text-gray-500">
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setConfirmDel(r.academicRuleId)}
                            className="text-xs text-red-400 hover:text-red-600"
                          >
                            Delete
                          </button>
                        )
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canWrite && showCreate && (
        <CreateRuleModal onClose={() => setShowCreate(false)} onCreated={handleCreated} ruleTypes={ruleTypes} />
      )}

      {historyFor && (
        <HistoryModal
          rule={historyFor}
          history={history}
          loading={histLoading}
          onClose={() => { setHistoryFor(null); setHistory([]); }}
        />
      )}
    </div>
  );
}

// ── Create modal ──────────────────────────────────────────────────────────────

function CreateRuleModal({
  onClose,
  onCreated,
  ruleTypes,
}: {
  onClose:   () => void;
  onCreated: () => void;
  ruleTypes: { code: string; displayLabel: string }[];
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd           = new FormData(e.currentTarget);
    const ruleTypeCode = String(fd.get('ruleTypeCode') ?? '');
    const ruleKey      = String(fd.get('ruleKey')      ?? '').trim();
    const description  = String(fd.get('description')  ?? '').trim();
    const validFrom    = String(fd.get('validFrom')    ?? '').trim();
    const ruleValueRaw = String(fd.get('ruleValue')    ?? '').trim();

    if (!ruleKey || !ruleValueRaw) {
      setError('Rule key and rule value (JSON) are required.');
      return;
    }

    let ruleValue: Record<string, unknown>;
    try {
      ruleValue = JSON.parse(ruleValueRaw) as Record<string, unknown>;
    } catch {
      setError('Rule value must be valid JSON.');
      return;
    }

    setSubmitting(true); setError('');
    try {
      await createAcademicRule({
        ruleTypeCode,
        ruleKey,
        ...(description ? { description } : {}),
        ruleValue,
        ...(validFrom   ? { validFrom }   : {}),
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
      <div className="bg-white rounded-lg border border-gray-200 p-6 w-full max-w-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-gray-900 mb-4">New academic rule</h2>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Rule type *</label>
            <select name="ruleTypeCode" className="w-full rounded border border-gray-300 px-3 py-2 text-sm">
              {ruleTypes.map(({ code, displayLabel }) => <option key={code} value={code}>{displayLabel}</option>)}
            </select>
          </div>
          <ModalField name="ruleKey"     label="Rule key *" />
          <ModalField name="description" label="Description" />
          <ModalField name="validFrom"   label="Valid from (YYYY-MM-DD, optional)" />
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Rule value (JSON) *</label>
            <textarea
              name="ruleValue"
              rows={4}
              placeholder='{"threshold": 0.5, ...}'
              className="w-full rounded border border-gray-300 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── History modal ─────────────────────────────────────────────────────────────

function HistoryModal({
  rule,
  history,
  loading,
  onClose,
}: {
  rule:    AcademicRule;
  history: AcademicRule[];
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg border border-gray-200 p-6 w-full max-w-2xl shadow-xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">History — {rule.ruleKey}</h2>
          <button onClick={onClose} className="text-sm text-gray-500">Close</button>
        </div>
        {loading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : history.length === 0 ? (
          <p className="text-sm text-gray-600">No history records.</p>
        ) : (
          <div className="space-y-3">
            {history.map((h, i) => (
              <div key={i} className="rounded-lg border border-gray-100 p-3">
                <div className="flex items-center gap-3 text-xs text-gray-500 mb-1">
                  <span className="font-mono">{h.ruleKey}</span>
                  <span>Effective {h.validFrom ? new Date(h.validFrom).toLocaleDateString('en-GB') : '—'}{h.validTo ? ` → ${new Date(h.validTo).toLocaleDateString('en-GB')}` : ''}</span>
                  <span>Recorded {new Date(h.recordedAt).toLocaleDateString('en-GB')}</span>
                </div>
                <pre className="text-xs text-gray-700 font-mono whitespace-pre-wrap">
                  {JSON.stringify(h.ruleValue, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ModalField({ name, label }: { name: string; label: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      <input
        name={name}
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </div>
  );
}
