import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  type ValueSet,
  type ValueSetMember,
  addValueSetMember,
  listValueSetMembers,
  listValueSets,
  updateValueSetMember,
} from '../api/valueSets.js';
import { ApiError } from '../api/client.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';

function memberStatus(m: ValueSetMember): 'active' | 'retired' | 'scheduled' {
  const now = new Date();
  if (m.activeTo && new Date(m.activeTo) <= now) return 'retired';
  if (m.activeFrom && new Date(m.activeFrom) > now) return 'scheduled';
  return 'active';
}

function StatusBadge({ member }: { member: ValueSetMember }) {
  const status = memberStatus(member);
  const cls =
    status === 'active'    ? 'bg-green-100 text-green-700' :
    status === 'retired'   ? 'bg-amber-100 text-amber-700' :
                             'bg-blue-100 text-blue-700';
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

export function ValueSetsPage() {
  const [sets,     setSets]     = useState<ValueSet[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

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
      <h1 className="text-xl font-semibold text-gray-900 mb-2">Value sets</h1>
      <p className="text-sm text-gray-500 mb-6">
        Manage the valid values that appear in picklists. Platform-managed codes are read-only;
        tenant extensions can be added, edited, or retired.
      </p>

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
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-gray-900">{s.displayName}</span>
                    <span className="font-mono text-xs text-gray-400">{s.setCode}</span>
                    {s.isExtensible && (
                      <span className="rounded bg-indigo-100 text-indigo-700 px-1.5 py-0.5 text-xs font-medium">
                        extensible
                      </span>
                    )}
                  </div>
                  {s.description && (
                    <p className="text-xs text-gray-500 mt-0.5">{s.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-3 ml-4 flex-shrink-0">
                  <span className="text-xs text-gray-400">{s.source}</span>
                  <span className="text-gray-400 text-sm">{expanded === s.setCode ? '▲' : '▼'}</span>
                </div>
              </button>

              {expanded === s.setCode && (
                <SetMembersPanel setCode={s.setCode} isExtensible={s.isExtensible} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Member panel ──────────────────────────────────────────────────────────────

function SetMembersPanel({ setCode, isExtensible }: { setCode: string; isExtensible: boolean }) {
  const [members,   setMembers]   = useState<ValueSetMember[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [showAdd,   setShowAdd]   = useState(false);
  const [editCode,  setEditCode]  = useState<string | null>(null);

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

  function handleEdited() {
    setEditCode(null);
    void load();
  }

  return (
    <div className="border-t border-gray-100 px-4 py-4">
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-4"><Spinner /></div>
      ) : (
        <>
          {members.length > 0 ? (
            <div className="overflow-x-auto mb-4">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="text-gray-400 uppercase border-b border-gray-100">
                    <th className="text-left pb-2 pr-4 font-medium">Code</th>
                    <th className="text-left pb-2 pr-4 font-medium">Label</th>
                    <th className="text-left pb-2 pr-4 font-medium">Description</th>
                    <th className="text-left pb-2 pr-4 font-medium w-10">Sort</th>
                    <th className="text-left pb-2 pr-4 font-medium">Active from</th>
                    <th className="text-left pb-2 pr-4 font-medium">Active to</th>
                    <th className="text-left pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {members.map(m =>
                    editCode === m.code ? (
                      <EditMemberRow
                        key={m.code}
                        setCode={setCode}
                        member={m}
                        onSaved={handleEdited}
                        onCancel={() => setEditCode(null)}
                        onError={setError}
                      />
                    ) : (
                      <MemberRow
                        key={m.code}
                        member={m}
                        onEdit={() => setEditCode(m.code)}
                        onRetired={() => void load()}
                        onError={setError}
                        setCode={setCode}
                      />
                    )
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-gray-400 mb-4">No members yet.</p>
          )}

          {isExtensible && (
            showAdd ? (
              <AddMemberForm
                setCode={setCode}
                onAdded={() => { setShowAdd(false); void load(); }}
                onCancel={() => setShowAdd(false)}
                onError={setError}
              />
            ) : (
              <button
                onClick={() => setShowAdd(true)}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
              >
                + Add member
              </button>
            )
          )}
        </>
      )}
    </div>
  );
}

// ── Read-only / action row ────────────────────────────────────────────────────

function MemberRow({
  member, setCode, onEdit, onRetired, onError,
}: {
  member:    ValueSetMember;
  setCode:   string;
  onEdit:    () => void;
  onRetired: () => void;
  onError:   (msg: string) => void;
}) {
  const [retiring, setRetiring] = useState(false);
  const [confirm,  setConfirm]  = useState(false);
  const status = memberStatus(member);

  async function handleRetire() {
    setRetiring(true);
    const today = new Date().toISOString().slice(0, 10);
    try {
      await updateValueSetMember(setCode, member.code, { activeTo: today });
      onRetired();
    } catch (e) {
      onError(e instanceof ApiError ? (e.detail ?? e.message) : 'Retire failed');
    } finally {
      setRetiring(false);
      setConfirm(false);
    }
  }

  return (
    <tr className={`hover:bg-gray-50 ${status === 'retired' ? 'opacity-60' : ''}`}>
      <td className="py-2 pr-4 font-mono text-gray-700">{member.code}</td>
      <td className="py-2 pr-4 text-gray-900">{member.displayLabel}</td>
      <td className="py-2 pr-4 text-gray-500 max-w-xs truncate">{member.description ?? '—'}</td>
      <td className="py-2 pr-4 text-gray-500">{member.sortOrder}</td>
      <td className="py-2 pr-4 text-gray-500">{member.activeFrom ? member.activeFrom.slice(0, 10) : '—'}</td>
      <td className="py-2 pr-4 text-gray-500">{member.activeTo ? member.activeTo.slice(0, 10) : '—'}</td>
      <td className="py-2 pr-4"><StatusBadge member={member} /></td>
      <td className="py-2 text-right whitespace-nowrap">
        {member.isTenantOwned ? (
          <span className="inline-flex items-center gap-3">
            <button onClick={onEdit} className="text-indigo-600 hover:text-indigo-800 font-medium">
              Edit
            </button>
            {status !== 'retired' && (
              confirm ? (
                <span className="inline-flex items-center gap-1.5">
                  <button
                    onClick={() => void handleRetire()}
                    disabled={retiring}
                    className="text-red-600 hover:text-red-800 font-medium disabled:opacity-50"
                  >
                    {retiring ? 'Retiring…' : 'Confirm'}
                  </button>
                  <button onClick={() => setConfirm(false)} className="text-gray-400">
                    ✕
                  </button>
                </span>
              ) : (
                <button onClick={() => setConfirm(true)} className="text-amber-600 hover:text-amber-800">
                  Retire
                </button>
              )
            )}
          </span>
        ) : (
          <span className="text-gray-300 text-xs">Platform</span>
        )}
      </td>
    </tr>
  );
}

// ── Inline edit row ───────────────────────────────────────────────────────────

function EditMemberRow({
  setCode, member, onSaved, onCancel, onError,
}: {
  setCode:  string;
  member:   ValueSetMember;
  onSaved:  () => void;
  onCancel: () => void;
  onError:  (msg: string) => void;
}) {
  const [displayLabel, setDisplayLabel] = useState(member.displayLabel);
  const [description,  setDescription]  = useState(member.description ?? '');
  const [sortOrder,    setSortOrder]     = useState(String(member.sortOrder));
  const [activeFrom,   setActiveFrom]    = useState(member.activeFrom ? member.activeFrom.slice(0, 10) : '');
  const [activeTo,     setActiveTo]      = useState(member.activeTo ? member.activeTo.slice(0, 10) : '');
  const [saving,       setSaving]        = useState(false);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!displayLabel.trim()) return;
    setSaving(true);
    try {
      await updateValueSetMember(setCode, member.code, {
        displayLabel: displayLabel.trim(),
        ...(description.trim() ? { description: description.trim() } : { description: null }),
        sortOrder: Number(sortOrder) || 0,
        activeFrom: activeFrom || null,
        activeTo: activeTo || null,
      });
      onSaved();
    } catch (err) {
      onError(err instanceof ApiError ? (err.detail ?? err.message) : 'Save failed');
      setSaving(false);
    }
  }

  const inputCls = 'rounded border border-gray-300 px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full';

  return (
    <tr className="bg-indigo-50">
      <td className="py-2 pr-4 font-mono text-gray-600">{member.code}</td>
      <td className="py-2 pr-4">
        <input
          value={displayLabel}
          onChange={e => setDisplayLabel(e.target.value)}
          className={inputCls}
          autoFocus
        />
      </td>
      <td className="py-2 pr-4">
        <input
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Optional"
          className={inputCls}
        />
      </td>
      <td className="py-2 pr-4">
        <input
          type="number"
          value={sortOrder}
          onChange={e => setSortOrder(e.target.value)}
          className={`${inputCls} w-16`}
          min={0}
        />
      </td>
      <td className="py-2 pr-4">
        <input
          type="date"
          value={activeFrom}
          onChange={e => setActiveFrom(e.target.value)}
          className={inputCls}
        />
      </td>
      <td className="py-2 pr-4">
        <input
          type="date"
          value={activeTo}
          onChange={e => setActiveTo(e.target.value)}
          className={inputCls}
          placeholder="Leave blank = never expires"
        />
      </td>
      <td className="py-2 pr-4" />
      <td className="py-2 text-right whitespace-nowrap">
        <form onSubmit={(e) => void handleSave(e)} className="inline-flex items-center gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        </form>
      </td>
    </tr>
  );
}

// ── Add member form ───────────────────────────────────────────────────────────

function AddMemberForm({
  setCode, onAdded, onCancel, onError,
}: {
  setCode:  string;
  onAdded:  () => void;
  onCancel: () => void;
  onError:  (msg: string) => void;
}) {
  const [adding, setAdding] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd          = new FormData(e.currentTarget);
    const code        = String(fd.get('code')        ?? '').trim();
    const displayLabel = String(fd.get('displayLabel') ?? '').trim();
    const description  = String(fd.get('description')  ?? '').trim();
    const sortOrder    = Number(fd.get('sortOrder') ?? 0) || 0;
    const activeFrom   = String(fd.get('activeFrom') ?? '').trim();
    const activeTo     = String(fd.get('activeTo')   ?? '').trim();

    if (!code || !displayLabel) return;

    setAdding(true);
    try {
      await addValueSetMember(setCode, {
        code,
        displayLabel,
        ...(description ? { description } : {}),
        sortOrder,
        ...(activeFrom  ? { activeFrom  } : {}),
        ...(activeTo    ? { activeTo    } : {}),
      });
      onAdded();
    } catch (err) {
      onError(err instanceof ApiError ? (err.detail ?? err.message) : 'Add failed');
      setAdding(false);
    }
  }

  const inputCls = 'rounded border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full';
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1';

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 p-4">
      <h3 className="text-xs font-semibold text-gray-700 mb-3">Add member</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className={labelCls}>Code *</label>
          <input name="code" required className={inputCls} placeholder="e.g. custom-status" />
        </div>
        <div>
          <label className={labelCls}>Label *</label>
          <input name="displayLabel" required className={inputCls} placeholder="Display label" />
        </div>
        <div>
          <label className={labelCls}>Description</label>
          <input name="description" className={inputCls} placeholder="Optional" />
        </div>
        <div>
          <label className={labelCls}>Sort order</label>
          <input name="sortOrder" type="number" min={0} defaultValue={0} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Active from <span className="font-normal text-gray-400">(blank = always)</span></label>
          <input name="activeFrom" type="date" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Active to <span className="font-normal text-gray-400">(blank = never)</span></label>
          <input name="activeTo" type="date" className={inputCls} />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="submit"
          disabled={adding}
          className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {adding ? 'Adding…' : 'Add member'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
