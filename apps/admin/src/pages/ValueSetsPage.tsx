import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  type ValueSet,
  type ValueSetMember,
  addValueSetMember,
  listValueSetMembers,
  listValueSets,
} from '../api/valueSets.js';
import { ApiError } from '../api/client.js';
import { Spinner } from '../components/Spinner.js';

export function ValueSetsPage() {
  const [sets,      setSets]      = useState<ValueSet[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [expanded,  setExpanded]  = useState<string | null>(null);

  useEffect(() => {
    listValueSets()
      .then(setSets)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Failed to load value sets'))
      .finally(() => setLoading(false));
  }, []);

  function toggle(setCode: string) {
    setExpanded(prev => prev === setCode ? null : setCode);
  }

  return (
    <div>
      <p className="text-xs text-gray-400 mb-0.5">Tenant administration</p>
      <h1 className="text-xl font-semibold text-gray-900 mb-6">Value sets</h1>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : sets.length === 0 ? (
        <p className="text-sm text-gray-400">No value sets found.</p>
      ) : (
        <div className="space-y-2">
          {sets.map(s => (
            <div key={s.setCode} className="bg-white rounded-lg border border-gray-200">
              <button
                onClick={() => toggle(s.setCode)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
              >
                <div>
                  <span className="font-medium text-sm text-gray-900">{s.label}</span>
                  <span className="ml-2 font-mono text-xs text-gray-400">{s.setCode}</span>
                  {s.description && <p className="text-xs text-gray-500 mt-0.5">{s.description}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400">{s.memberCount} member{s.memberCount !== 1 ? 's' : ''}</span>
                  <span className="text-gray-400 text-sm">{expanded === s.setCode ? '▲' : '▼'}</span>
                </div>
              </button>
              {expanded === s.setCode && (
                <SetMembersPanel setCode={s.setCode} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SetMembersPanel({ setCode }: { setCode: string }) {
  const [members,   setMembers]   = useState<ValueSetMember[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [showAdd,   setShowAdd]   = useState(false);
  const [adding,    setAdding]    = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMembers(await listValueSetMembers(setCode));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load members');
    } finally {
      setLoading(false);
    }
  }, [setCode]);

  useEffect(() => { void load(); }, [load]);

  async function handleAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd         = new FormData(e.currentTarget);
    const memberCode = String(fd.get('memberCode') ?? '').trim();
    const label      = String(fd.get('label')      ?? '').trim();
    if (!memberCode || !label) return;

    setAdding(true); setError('');
    try {
      await addValueSetMember(setCode, { memberCode, label });
      setShowAdd(false);
      e.currentTarget.reset();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Add failed');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="border-t border-gray-100 px-4 py-3">
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-4"><Spinner /></div>
      ) : (
        <>
          {members.length > 0 ? (
            <table className="min-w-full text-xs mb-3">
              <thead>
                <tr className="text-gray-400 uppercase">
                  <th className="text-left pb-1 pr-6">Code</th>
                  <th className="text-left pb-1 pr-6">Label</th>
                  <th className="text-left pb-1 pr-6">Order</th>
                  <th className="text-left pb-1">Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {members.map(m => (
                  <tr key={m.memberId} className="hover:bg-gray-50">
                    <td className="py-1 pr-6 font-mono text-gray-700">{m.memberCode}</td>
                    <td className="py-1 pr-6 text-gray-900">{m.label}</td>
                    <td className="py-1 pr-6 text-gray-500">{m.sortOrder ?? '—'}</td>
                    <td className="py-1 text-gray-500">
                      {m.activeTo
                        ? <span className="text-amber-600">Until {m.activeTo}</span>
                        : <span className="text-green-600">Yes</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-gray-400 mb-3">No members yet.</p>
          )}

          {showAdd ? (
            <form onSubmit={(e) => void handleAdd(e)} className="flex items-center gap-2 mt-1">
              <input
                name="memberCode"
                placeholder="Code"
                required
                className="rounded border border-gray-300 px-2 py-1 text-xs w-28 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <input
                name="label"
                placeholder="Label"
                required
                className="rounded border border-gray-300 px-2 py-1 text-xs flex-1 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="submit"
                disabled={adding}
                className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
              >
                {adding ? 'Adding…' : 'Add'}
              </button>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="text-xs text-gray-500"
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              onClick={() => setShowAdd(true)}
              className="text-xs text-indigo-600 hover:text-indigo-800"
            >
              + Add member
            </button>
          )}
        </>
      )}
    </div>
  );
}
