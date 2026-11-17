import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  type AllocationMode,
  type SelectionWindow,
  createSelectionWindow,
  listSelectionWindows,
  updateSelectionWindow,
} from '../api/moduleSelection.js';
import { type AcademicPeriod, listAcademicPeriods } from '../api/academicPeriods.js';
import { type ProgrammeSummary, listProgrammes } from '../api/applications.js';
import { ApiError } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { Spinner } from '../components/Spinner.js';
import {
  PageHeader, Card, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
  Button, Input, Select, LabelledField, Dialog, Badge,
} from '@revelation-srs/ui';

const MODE_LABEL: Record<AllocationMode, string> = {
  'ranked': 'Ranked preferences',
  'first-come': 'First come, first served',
};

/**
 * Module selection windows (Phase 4 D-29). A window belongs to an academic
 * period and may be narrowed to a programme and/or the student's current
 * level; the most specific one applies. Students submit inside it; a
 * returned proposal can be resubmitted until resubmission closes. Without a
 * window, selection is open unless the tenant requires windows
 * (moduleSelection.windowEnforcement).
 */
export function SelectionWindowsPage() {
  const { roles } = useAuth();
  const canWrite  = userHasAnyPermission(roles, ['calendar:write']);
  const canAllocate = userHasAnyPermission(roles, ['module-selection:allocate', 'module-selection:decide']);

  const [windows, setWindows]       = useState<SelectionWindow[]>([]);
  const [periods, setPeriods]       = useState<AcademicPeriod[]>([]);
  const [programmes, setProgrammes] = useState<ProgrammeSummary[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error,   setError]         = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing]       = useState<SelectionWindow | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [w, p, pr] = await Promise.all([listSelectionWindows(), listAcademicPeriods(), listProgrammes().catch(() => [])]);
      setWindows(w); setPeriods(p); setProgrammes(pr);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load selection windows');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const programmeLabel = (id: string | null) => id ? (programmes.find((p) => p.programmeId === id)?.code ?? 'One programme') : 'All programmes';

  return (
    <div>
      <PageHeader
        title="Module selection windows"
        description="When students may submit module choices. The most specific window for a student applies (programme and level, programme, level, then the whole period). Drafts can be edited at any time; registry staff can submit late with a reason."
        actions={canWrite && periods.length > 0 && <Button onClick={() => setShowCreate(true)}>New window</Button>}
      />

      {!canWrite && (
        <p className="mb-4 text-xs text-warning-700 bg-warning-50 border border-warning-200 rounded px-3 py-2">
          You have read-only access to selection windows.
        </p>
      )}
      {error && <p className="mb-4 text-sm text-danger-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : windows.length === 0 ? (
        <p className="py-8 text-center text-sm text-neutral-600">No selection windows configured. Selection is open unless the tenant requires windows.</p>
      ) : (
        <Card>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Academic period</TableHeaderCell>
                <TableHeaderCell>Applies to</TableHeaderCell>
                <TableHeaderCell>Opens</TableHeaderCell>
                <TableHeaderCell>Closes</TableHeaderCell>
                <TableHeaderCell>Resubmission closes</TableHeaderCell>
                <TableHeaderCell>Allocation</TableHeaderCell>
                <TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {windows.map(w => (
                <TableRow key={w.moduleSelectionWindowId}>
                  <TableCell><p className="font-medium text-neutral-900">{w.academicYear} — {w.periodCode}</p></TableCell>
                  <TableCell className="text-xs">{programmeLabel(w.programmeId)}{w.fheqLevel !== null ? `, level ${w.fheqLevel}` : ''}</TableCell>
                  <TableCell className="text-xs">{new Date(w.opensAt).toLocaleString('en-GB')}</TableCell>
                  <TableCell className="text-xs">{new Date(w.closesAt).toLocaleString('en-GB')}</TableCell>
                  <TableCell className="text-xs">{w.resubmissionClosesAt ? new Date(w.resubmissionClosesAt).toLocaleString('en-GB') : 'With the window'}</TableCell>
                  <TableCell className="text-xs">
                    {MODE_LABEL[w.allocationModeCode]}
                    {w.allocationSeeded && <span className="ml-2"><Badge value="in-progress" label="Allocation started" /></span>}
                  </TableCell>
                  <TableCell className="text-right space-x-3 whitespace-nowrap">
                    {w.allocationModeCode === 'ranked' && canAllocate && (
                      <Link to={`/tenant-admin/selection-windows/${w.moduleSelectionWindowId}/allocation`} className="text-xs text-primary-600 hover:text-primary-800">Allocation</Link>
                    )}
                    {canWrite && (
                      <button onClick={() => setEditing(w)} className="text-xs text-primary-600 hover:text-primary-800">Edit</button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {canWrite && (
        <Dialog open={showCreate} onOpenChange={(open) => { if (!open) setShowCreate(false); }} title="New selection window">
          <WindowForm periods={periods} programmes={programmes} onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); void load(); }} />
        </Dialog>
      )}
      {canWrite && (
        <Dialog
          open={editing !== null}
          onOpenChange={(open) => { if (!open) setEditing(null); }}
          title={editing ? `Edit window — ${editing.academicYear} ${editing.periodCode}` : ''}
        >
          {editing && <WindowForm existing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
        </Dialog>
      )}
    </div>
  );
}

function WindowForm({
  periods, programmes, existing, onClose, onSaved,
}: {
  periods?: AcademicPeriod[];
  programmes?: ProgrammeSummary[];
  existing?: SelectionWindow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const value = (k: string) => String(fd.get(k) ?? '').trim();
    const opensAt = value('opensAt');
    const closesAt = value('closesAt');
    const resubmission = value('resubmissionClosesAt');
    const mode = (value('allocationModeCode') || 'ranked') as AllocationMode;
    if (!opensAt || !closesAt) { setError('Both opens and closes date/time are required.'); return; }

    setSubmitting(true); setError('');
    try {
      const dates = {
        opensAt: new Date(opensAt).toISOString(),
        closesAt: new Date(closesAt).toISOString(),
      };
      if (existing) {
        await updateSelectionWindow(existing.moduleSelectionWindowId, {
          ...dates, resubmissionClosesAt: resubmission ? new Date(resubmission).toISOString() : null,
          ...(existing.allocationSeeded ? {} : { allocationModeCode: mode }),
        });
      } else {
        const academicPeriodId = value('academicPeriodId');
        if (!academicPeriodId) { setError('An academic period is required.'); setSubmitting(false); return; }
        const programmeId = value('programmeId');
        const level = value('fheqLevel');
        await createSelectionWindow({
          academicPeriodId, ...dates, allocationModeCode: mode,
          ...(programmeId ? { programmeId } : {}),
          ...(level ? { fheqLevel: Number(level) } : {}),
          ...(resubmission ? { resubmissionClosesAt: new Date(resubmission).toISOString() } : {}),
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
      {!existing && periods && (
        <>
          <LabelledField label="Academic period" htmlFor="sw-period" required>
            <Select id="sw-period" name="academicPeriodId">
              {periods.map(p => <option key={p.academicPeriodId} value={p.academicPeriodId}>{p.academicYear} — {p.periodCode}</option>)}
            </Select>
          </LabelledField>
          <LabelledField label="Programme" htmlFor="sw-programme" hint="Leave as all programmes for a period-wide window">
            <Select id="sw-programme" name="programmeId" defaultValue="">
              <option value="">All programmes</option>
              {(programmes ?? []).map(p => <option key={p.programmeId} value={p.programmeId}>{p.code} — {p.title}</option>)}
            </Select>
          </LabelledField>
          <LabelledField label="Student level" htmlFor="sw-level" hint="The student's current FHEQ level">
            <Select id="sw-level" name="fheqLevel" defaultValue="">
              <option value="">All levels</option>
              {[3, 4, 5, 6, 7, 8].map(l => <option key={l} value={l}>Level {l}</option>)}
            </Select>
          </LabelledField>
        </>
      )}
      <LabelledField label="Opens at" htmlFor="sw-opens" required>
        <Input id="sw-opens" name="opensAt" type="datetime-local" defaultValue={existing ? toLocalInput(existing.opensAt) : undefined} />
      </LabelledField>
      <LabelledField label="Closes at" htmlFor="sw-closes" required>
        <Input id="sw-closes" name="closesAt" type="datetime-local" defaultValue={existing ? toLocalInput(existing.closesAt) : undefined} />
      </LabelledField>
      <LabelledField label="Resubmission closes at" htmlFor="sw-resub" hint="Returned selections can be resubmitted until then; leave empty to close with the window">
        <Input id="sw-resub" name="resubmissionClosesAt" type="datetime-local" defaultValue={existing?.resubmissionClosesAt ? toLocalInput(existing.resubmissionClosesAt) : undefined} />
      </LabelledField>
      <LabelledField label="Oversubscribed modules" htmlFor="sw-mode" hint={existing?.allocationSeeded ? 'Fixed once an allocation has been previewed' : undefined}>
        <Select id="sw-mode" name="allocationModeCode" defaultValue={existing?.allocationModeCode ?? 'ranked'} disabled={existing?.allocationSeeded ?? false}>
          <option value="ranked">{MODE_LABEL.ranked} (allocated after the window)</option>
          <option value="first-come">{MODE_LABEL['first-come']}</option>
        </Select>
      </LabelledField>
      {error && <p className="text-sm text-danger-600">{error}</p>}
      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
      </div>
    </form>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
