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
import {
  PageHeader, Card, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
  Button, Input, Select, LabelledField, Dialog, DialogClose,
} from '@revelation-srs/ui';

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
      <PageHeader title="Academic rules" actions={canWrite && <Button onClick={() => setShowCreate(true)}>New rule</Button>} />

      {!canWrite && (
        <p className="mb-4 text-xs text-warning-700 bg-warning-50 border border-warning-200 rounded px-3 py-2">
          You have read-only access to academic rules.
        </p>
      )}

      <form onSubmit={handleFilter} className="flex items-center gap-3 mb-4">
        <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-auto">
          <option value="">All types</option>
          {ruleTypes.map(({ code, displayLabel }) => <option key={code} value={code}>{displayLabel}</option>)}
        </Select>
        <Button type="submit">Filter</Button>
        {typeFilter && (
          <Button type="button" variant="ghost" onClick={() => { setTypeFilter(''); void load(); }}>Clear</Button>
        )}
      </form>

      {error && <p className="mb-4 text-sm text-danger-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : rules.length === 0 ? (
        <p className="py-8 text-center text-sm text-neutral-600">No academic rules found.</p>
      ) : (
        <Card>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell>Effective from</TableHeaderCell>
                <TableHeaderCell>Effective to</TableHeaderCell>
                <TableHeaderCell>Recorded</TableHeaderCell>
                <TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {rules.map(r => (
                <TableRow key={r.academicRuleId}>
                  <TableCell>
                    <p className="font-medium text-neutral-900">{r.ruleKey}</p>
                    {r.description && <p className="text-xs text-neutral-600">{r.description}</p>}
                  </TableCell>
                  <TableCell><Badge value={r.ruleTypeCode} /></TableCell>
                  <TableCell className="text-xs">{r.validFrom ? new Date(r.validFrom).toLocaleDateString('en-GB') : '—'}</TableCell>
                  <TableCell className="text-xs">{r.validTo ? new Date(r.validTo).toLocaleDateString('en-GB') : '—'}</TableCell>
                  <TableCell className="text-xs">{r.recordedAt ? new Date(r.recordedAt).toLocaleDateString('en-GB') : '—'}</TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex items-center gap-3">
                      <button
                        onClick={() => void handleShowHistory(r)}
                        className="text-xs text-primary-600 hover:text-primary-800"
                      >
                        History
                      </button>
                      {canWrite && (
                        confirmDel === r.academicRuleId ? (
                          <span className="inline-flex items-center gap-2">
                            <button
                              onClick={() => void handleDelete(r.academicRuleId)}
                              disabled={deleting === r.academicRuleId}
                              className="text-xs font-medium text-danger-600 hover:text-danger-800 disabled:opacity-50"
                            >
                              {deleting === r.academicRuleId ? 'Deleting…' : 'Confirm delete'}
                            </button>
                            <button onClick={() => setConfirmDel(null)} className="text-xs text-neutral-500">
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setConfirmDel(r.academicRuleId)}
                            className="text-xs text-danger-400 hover:text-danger-600"
                          >
                            Delete
                          </button>
                        )
                      )}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {canWrite && (
        <Dialog open={showCreate} onOpenChange={(open) => { if (!open) setShowCreate(false); }} title="New academic rule">
          <CreateRuleForm onClose={() => setShowCreate(false)} onCreated={handleCreated} ruleTypes={ruleTypes} />
        </Dialog>
      )}

      <Dialog
        open={historyFor !== null}
        onOpenChange={(open) => { if (!open) { setHistoryFor(null); setHistory([]); } }}
        title={historyFor ? `History — ${historyFor.ruleKey}` : ''}
      >
        <HistoryList history={history} loading={histLoading} />
      </Dialog>
    </div>
  );
}

// ── Create form ───────────────────────────────────────────────────────────────

function CreateRuleForm({
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
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
      <LabelledField label="Rule type" htmlFor="ar-type" required>
        <Select id="ar-type" name="ruleTypeCode">
          {ruleTypes.map(({ code, displayLabel }) => <option key={code} value={code}>{displayLabel}</option>)}
        </Select>
      </LabelledField>
      <LabelledField label="Rule key" htmlFor="ar-key" required><Input id="ar-key" name="ruleKey" /></LabelledField>
      <LabelledField label="Description" htmlFor="ar-desc" hint="Optional"><Input id="ar-desc" name="description" /></LabelledField>
      <LabelledField label="Valid from" htmlFor="ar-from" hint="YYYY-MM-DD, optional"><Input id="ar-from" name="validFrom" /></LabelledField>
      <LabelledField label="Rule value (JSON)" htmlFor="ar-value" required>
        <textarea
          id="ar-value"
          name="ruleValue"
          rows={4}
          placeholder='{"threshold": 0.5, ...}'
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </LabelledField>
      {error && <p className="text-sm text-danger-600">{error}</p>}
      <div className="flex justify-end gap-3 pt-2">
        <DialogClose asChild>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </DialogClose>
        <Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create'}</Button>
      </div>
    </form>
  );
}

// ── History list ──────────────────────────────────────────────────────────────

function HistoryList({ history, loading }: { history: AcademicRule[]; loading: boolean }) {
  if (loading) return <div className="flex justify-center py-8"><Spinner /></div>;
  if (history.length === 0) return <p className="text-sm text-neutral-600">No history records.</p>;
  return (
    <div className="space-y-3 max-h-[60vh] overflow-y-auto">
      {history.map((h, i) => (
        <div key={i} className="rounded-lg border border-neutral-100 p-3">
          <div className="flex items-center gap-3 text-xs text-neutral-500 mb-1">
            <span className="font-mono">{h.ruleKey}</span>
            <span>Effective {h.validFrom ? new Date(h.validFrom).toLocaleDateString('en-GB') : '—'}{h.validTo ? ` → ${new Date(h.validTo).toLocaleDateString('en-GB')}` : ''}</span>
            <span>Recorded {new Date(h.recordedAt).toLocaleDateString('en-GB')}</span>
          </div>
          <pre className="text-xs text-neutral-700 font-mono whitespace-pre-wrap">
            {JSON.stringify(h.ruleValue, null, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
}
