import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  type RegistrationWindow,
  createRegistrationWindow,
  listRegistrationWindows,
  updateRegistrationWindow,
} from '../api/registrationWindows.js';
import { type AcademicPeriod, listAcademicPeriods } from '../api/academicPeriods.js';
import { ApiError } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { Spinner } from '../components/Spinner.js';
import {
  PageHeader, Card, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
  Button, Input, Select, LabelledField, Dialog,
} from '@revelation-srs/ui';

// Module-registration open/close window per academic period. Only enforced
// by ModuleRegistrationService when the tenant's configuration sets
// registrationWindowMode to 'academic-period' (see TenantConfigPage) — a
// period with no window row here blocks registration entirely once that
// mode is on, rather than silently allowing it.
export function RegistrationWindowsPage() {
  const { roles } = useAuth();
  const canWrite  = userHasAnyPermission(roles, ['calendar:write']);

  const [windows, setWindows]   = useState<RegistrationWindow[]>([]);
  const [periods, setPeriods]   = useState<AcademicPeriod[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error,   setError]     = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing]   = useState<RegistrationWindow | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [w, p] = await Promise.all([listRegistrationWindows(), listAcademicPeriods()]);
      setWindows(w);
      setPeriods(p);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load registration windows');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const periodsWithoutWindow = periods.filter(
    p => !windows.some(w => w.academicPeriodId === p.academicPeriodId),
  );

  function handleCreated() {
    setShowCreate(false);
    void load();
  }

  function handleUpdated() {
    setEditing(null);
    void load();
  }

  return (
    <div>
      <PageHeader
        title="Registration windows"
        description="Controls when students may register for modules in a given academic period. Only enforced when the tenant's registrationWindowMode is set to 'academic-period'."
        actions={canWrite && periodsWithoutWindow.length > 0 && (
          <Button onClick={() => setShowCreate(true)}>New window</Button>
        )}
      />

      {!canWrite && (
        <p className="mb-4 text-xs text-warning-700 bg-warning-50 border border-warning-200 rounded px-3 py-2">
          You have read-only access to registration windows.
        </p>
      )}

      {error && <p className="mb-4 text-sm text-danger-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : windows.length === 0 ? (
        <p className="py-8 text-center text-sm text-neutral-600">No registration windows configured.</p>
      ) : (
        <Card>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Academic period</TableHeaderCell>
                <TableHeaderCell>Opens</TableHeaderCell>
                <TableHeaderCell>Closes</TableHeaderCell>
                <TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {windows.map(w => (
                <TableRow key={w.registrationWindowId}>
                  <TableCell>
                    <p className="font-medium text-neutral-900">{w.academicYear} — {w.periodCode}</p>
                  </TableCell>
                  <TableCell className="text-xs">{new Date(w.opensAt).toLocaleString('en-GB')}</TableCell>
                  <TableCell className="text-xs">{new Date(w.closesAt).toLocaleString('en-GB')}</TableCell>
                  <TableCell className="text-right">
                    {canWrite && (
                      <button
                        onClick={() => setEditing(w)}
                        className="text-xs text-primary-600 hover:text-primary-800"
                      >
                        Edit
                      </button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {canWrite && (
        <Dialog open={showCreate} onOpenChange={(open) => { if (!open) setShowCreate(false); }} title="New registration window">
          <WindowForm periods={periodsWithoutWindow} onClose={() => setShowCreate(false)} onSaved={handleCreated} />
        </Dialog>
      )}

      {canWrite && (
        <Dialog
          open={editing !== null}
          onOpenChange={(open) => { if (!open) setEditing(null); }}
          title={editing ? `Edit window — ${editing.academicYear} ${editing.periodCode}` : ''}
        >
          {editing && <WindowForm existing={editing} onClose={() => setEditing(null)} onSaved={handleUpdated} />}
        </Dialog>
      )}
    </div>
  );
}

function WindowForm({
  periods,
  existing,
  onClose,
  onSaved,
}: {
  periods?:  AcademicPeriod[];
  existing?: RegistrationWindow;
  onClose:   () => void;
  onSaved:   () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd       = new FormData(e.currentTarget);
    const opensAt  = String(fd.get('opensAt')  ?? '').trim();
    const closesAt = String(fd.get('closesAt') ?? '').trim();

    if (!opensAt || !closesAt) {
      setError('Both opens and closes date/time are required.');
      return;
    }

    setSubmitting(true); setError('');
    try {
      if (existing) {
        await updateRegistrationWindow(existing.registrationWindowId, {
          opensAt:  new Date(opensAt).toISOString(),
          closesAt: new Date(closesAt).toISOString(),
        });
      } else {
        const academicPeriodId = String(fd.get('academicPeriodId') ?? '');
        if (!academicPeriodId) {
          setError('An academic period is required.');
          setSubmitting(false);
          return;
        }
        await createRegistrationWindow({
          academicPeriodId,
          opensAt:  new Date(opensAt).toISOString(),
          closesAt: new Date(closesAt).toISOString(),
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
        <LabelledField label="Academic period" htmlFor="rw-period" required>
          <Select id="rw-period" name="academicPeriodId">
            {periods.map(p => (
              <option key={p.academicPeriodId} value={p.academicPeriodId}>
                {p.academicYear} — {p.periodCode}
              </option>
            ))}
          </Select>
        </LabelledField>
      )}
      <LabelledField label="Opens at" htmlFor="rw-opens" required>
        <Input
          id="rw-opens" name="opensAt" type="datetime-local"
          defaultValue={existing ? toLocalInput(existing.opensAt) : undefined}
        />
      </LabelledField>
      <LabelledField label="Closes at" htmlFor="rw-closes" required>
        <Input
          id="rw-closes" name="closesAt" type="datetime-local"
          defaultValue={existing ? toLocalInput(existing.closesAt) : undefined}
        />
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
