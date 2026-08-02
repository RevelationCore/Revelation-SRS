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
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import {
  PageHeader, Card, Button, Input, LabelledField,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';

function memberStatus(m: ValueSetMember): 'active' | 'retired' | 'scheduled' {
  const now = new Date();
  if (m.activeTo && new Date(m.activeTo) <= now) return 'retired';
  if (m.activeFrom && new Date(m.activeFrom) > now) return 'scheduled';
  return 'active';
}

function StatusBadge({ member }: { member: ValueSetMember }) {
  const status = memberStatus(member);
  const cls =
    status === 'active'    ? 'bg-success-100 text-success-700' :
    status === 'retired'   ? 'bg-warning-100 text-warning-700' :
                             'bg-primary-100 text-primary-700';
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

export function ValueSetsPage() {
  const { roles }              = useAuth();
  const canWrite               = userHasAnyPermission(roles, ['config:write']);
  const [sets,     setSets]    = useState<ValueSet[]>([]);
  const [loading,  setLoading] = useState(true);
  const [error,    setError]   = useState('');
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
      <PageHeader title="Value sets" description="Manage the valid values that appear in picklists. Platform-managed codes are read-only; tenant extensions can be added, edited, or retired." />

      {error && <p className="mb-4 text-sm text-danger-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : sets.length === 0 ? (
        <p className="text-sm text-neutral-600">No value sets found.</p>
      ) : (
        <div className="space-y-2">
          {sets.map(s => (
            <Card key={s.setCode}>
              <button
                onClick={() => toggle(s.setCode)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-neutral-50"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-neutral-900">{s.displayName}</span>
                    <span className="font-mono text-xs text-neutral-600">{s.setCode}</span>
                    {s.isExtensible && (
                      <span className="rounded bg-primary-100 text-primary-700 px-1.5 py-0.5 text-xs font-medium">
                        extensible
                      </span>
                    )}
                  </div>
                  {s.description && (
                    <p className="text-xs text-neutral-500 mt-0.5">{s.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-3 ml-4 flex-shrink-0">
                  <span className="text-xs text-neutral-600">{s.source}</span>
                  {expanded === s.setCode
                    ? <ChevronUp className="h-4 w-4 text-neutral-500" aria-hidden="true" />
                    : <ChevronDown className="h-4 w-4 text-neutral-500" aria-hidden="true" />}
                </div>
              </button>

              {expanded === s.setCode && (
                <SetMembersPanel setCode={s.setCode} isExtensible={s.isExtensible} canWrite={canWrite} />
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Member panel ──────────────────────────────────────────────────────────────

function SetMembersPanel({ setCode, isExtensible, canWrite }: { setCode: string; isExtensible: boolean; canWrite: boolean }) {
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
    <div className="border-t border-neutral-100 px-4 py-4">
      {error && <p className="mb-2 text-sm text-danger-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-4"><Spinner /></div>
      ) : (
        <>
          {members.length > 0 ? (
            <div className="mb-4">
              <Table className="text-xs">
                <TableHead>
                  <tr>
                    <TableHeaderCell>Code</TableHeaderCell>
                    <TableHeaderCell>Label</TableHeaderCell>
                    <TableHeaderCell>Description</TableHeaderCell>
                    <TableHeaderCell>Sort</TableHeaderCell>
                    <TableHeaderCell>Active from</TableHeaderCell>
                    <TableHeaderCell>Active to</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {members.map(m =>
                    canWrite && editCode === m.code ? (
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
                        canWrite={canWrite}
                        onEdit={() => setEditCode(m.code)}
                        onRetired={() => void load()}
                        onError={setError}
                        setCode={setCode}
                      />
                    )
                  )}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-xs text-neutral-600 mb-4">No members yet.</p>
          )}

          {isExtensible && canWrite && (
            showAdd ? (
              <AddMemberForm
                setCode={setCode}
                onAdded={() => { setShowAdd(false); void load(); }}
                onCancel={() => setShowAdd(false)}
                onError={setError}
              />
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setShowAdd(true)}>+ Add member</Button>
            )
          )}
        </>
      )}
    </div>
  );
}

// ── Read-only / action row ────────────────────────────────────────────────────

function MemberRow({
  member, setCode, canWrite, onEdit, onRetired, onError,
}: {
  member:    ValueSetMember;
  setCode:   string;
  canWrite:  boolean;
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
    <TableRow className={status === 'retired' ? 'opacity-60' : ''}>
      <TableCell className="font-mono">{member.code}</TableCell>
      <TableCell className="text-neutral-900">{member.displayLabel}</TableCell>
      <TableCell className="max-w-xs truncate">{member.description ?? '—'}</TableCell>
      <TableCell>{member.sortOrder}</TableCell>
      <TableCell>{member.activeFrom ? member.activeFrom.slice(0, 10) : '—'}</TableCell>
      <TableCell>{member.activeTo ? member.activeTo.slice(0, 10) : '—'}</TableCell>
      <TableCell><StatusBadge member={member} /></TableCell>
      <TableCell className="text-right whitespace-nowrap">
        {member.isTenantOwned && canWrite ? (
          <span className="inline-flex items-center gap-3">
            <button onClick={onEdit} className="text-primary-600 hover:text-primary-800 font-medium">
              Edit
            </button>
            {status !== 'retired' && (
              confirm ? (
                <span className="inline-flex items-center gap-1.5">
                  <button
                    onClick={() => void handleRetire()}
                    disabled={retiring}
                    className="text-danger-600 hover:text-danger-800 font-medium disabled:opacity-50"
                  >
                    {retiring ? 'Retiring…' : 'Confirm'}
                  </button>
                  <button onClick={() => setConfirm(false)} className="text-neutral-600" aria-label="Cancel">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ) : (
                <button onClick={() => setConfirm(true)} className="text-warning-600 hover:text-warning-800">
                  Retire
                </button>
              )
            )}
          </span>
        ) : (
          <span className="text-neutral-300 text-xs">Platform</span>
        )}
      </TableCell>
    </TableRow>
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

  const inputCls = 'rounded border border-neutral-300 px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary-500 w-full';

  return (
    <tr className="bg-primary-50">
      <td className="py-2 pr-4 font-mono text-neutral-600">{member.code}</td>
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
            className="rounded bg-primary-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-neutral-500 hover:text-neutral-700"
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

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="mt-3 rounded-lg border border-primary-200 bg-primary-50 p-4">
      <h3 className="text-xs font-semibold text-neutral-700 mb-3">Add member</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <LabelledField label="Code" htmlFor="vs-add-code" required>
          <Input id="vs-add-code" name="code" required placeholder="e.g. custom-status" />
        </LabelledField>
        <LabelledField label="Label" htmlFor="vs-add-label" required>
          <Input id="vs-add-label" name="displayLabel" required placeholder="Display label" />
        </LabelledField>
        <LabelledField label="Description" htmlFor="vs-add-desc" hint="Optional">
          <Input id="vs-add-desc" name="description" />
        </LabelledField>
        <LabelledField label="Sort order" htmlFor="vs-add-sort">
          <Input id="vs-add-sort" name="sortOrder" type="number" min={0} defaultValue={0} />
        </LabelledField>
        <LabelledField label="Active from" htmlFor="vs-add-from" hint="Blank = always">
          <Input id="vs-add-from" name="activeFrom" type="date" />
        </LabelledField>
        <LabelledField label="Active to" htmlFor="vs-add-to" hint="Blank = never">
          <Input id="vs-add-to" name="activeTo" type="date" />
        </LabelledField>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button type="submit" size="sm" disabled={adding}>{adding ? 'Adding…' : 'Add member'}</Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
