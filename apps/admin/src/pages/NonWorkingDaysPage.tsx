import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Button, Card, CardBody, CardHeader, Input, LabelledField, PageHeader,
  Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow,
} from '@revelation-srs/ui';

import { api, ApiError } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { Spinner } from '../components/Spinner.js';
import { useValueSet } from '../hooks/useValueSet.js';

interface NonWorkingDay { id: string; date: string; divisionCode: string; description: string; source: string }

/**
 * The working-day calendar statutory deadlines use (Phase 5 D-42): bank
 * holidays imported from the GOV.UK file, and the institution's own closure
 * days. The UKVI non-registration, FOI, UCAS reconciliation and Clearing
 * review deadlines all skip these.
 */
export function NonWorkingDaysPage() {
  const { roles } = useAuth();
  const canWrite = userHasAnyPermission(roles, ['calendar:write']);
  const { members: divisions } = useValueSet('non_working_day', 'division_code');
  const year = new Date().getFullYear();
  const [days, setDays] = useState<NonWorkingDay[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [date, setDate] = useState('');
  const [description, setDescription] = useState('');

  const load = useCallback(async () => {
    try { setDays(await api.get<NonWorkingDay[]>(`/api/v1/calendar/non-working-days?from=${year - 1}-01-01&to=${year + 2}-12-31`)); }
    catch (err) { setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to load'); }
  }, [year]);
  useEffect(() => { void load(); }, [load]);

  async function importFile(file: File) {
    setError(''); setNotice('');
    try {
      const data = JSON.parse(await file.text()) as Record<string, unknown>;
      const res = await api.post<{ imported: number }>('/api/v1/calendar/non-working-days/import', data);
      setNotice(`${res.imported} bank holidays added.`);
      await load();
    } catch (err) { setError(err instanceof ApiError ? (err.detail ?? err.message) : 'That file is not the GOV.UK bank-holidays.json'); }
  }

  async function addClosure(e: FormEvent) {
    e.preventDefault(); setError(''); setNotice('');
    try { await api.post('/api/v1/calendar/non-working-days', { date, description: description.trim() }); setDate(''); setDescription(''); await load(); }
    catch (err) { setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to add the closure day'); }
  }

  const divisionLabel = (code: string) => divisions.find((d) => d.code === code)?.displayLabel ?? code;
  return (
    <div>
      <PageHeader title="Working-day calendar" description="Bank holidays and closure days that statutory deadlines skip. The institution's division is set in tenant configuration (calendar.division)." />
      {error && <p className="mb-4 text-sm text-danger-600" role="alert">{error}</p>}
      {notice && <p className="mb-4 text-sm text-success-700">{notice}</p>}
      {canWrite && (
        <div className="mb-4 grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader title="Import bank holidays" description="Download bank-holidays.json from gov.uk/bank-holidays and upload it here. Days already held are kept." />
            <CardBody>
              <label htmlFor="bank-holidays-file" className="text-xs text-neutral-700">GOV.UK bank holidays file</label>
              <input id="bank-holidays-file" type="file" accept="application/json,.json" className="mt-1 block text-sm"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); }} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Add a closure day" />
            <CardBody>
              <form className="grid grid-cols-2 items-end gap-3" onSubmit={(e) => void addClosure(e)}>
                <LabelledField label="Date" htmlFor="closure-date" required><Input id="closure-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></LabelledField>
                <LabelledField label="Description" htmlFor="closure-description" required><Input id="closure-description" value={description} onChange={(e) => setDescription(e.target.value)} /></LabelledField>
                <div className="col-span-2"><Button type="submit" size="sm" disabled={!date || !description.trim()}>Add closure day</Button></div>
              </form>
            </CardBody>
          </Card>
        </div>
      )}
      <Card>
        <CardHeader title="Non-working days" />
        <CardBody>
          {!days ? <div className="flex justify-center py-8"><Spinner /></div> : days.length === 0 ? <p className="text-sm text-neutral-600">None held yet. Until bank holidays are imported, deadlines count Monday to Friday only.</p> : (
            <Table>
              <TableHead><tr><TableHeaderCell>Date</TableHeaderCell><TableHeaderCell>Day</TableHeaderCell><TableHeaderCell>Applies to</TableHeaderCell><TableHeaderCell>Source</TableHeaderCell></tr></TableHead>
              <TableBody>
                {days.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC' })}</TableCell>
                    <TableCell>{d.description}</TableCell>
                    <TableCell>{divisionLabel(d.divisionCode)}</TableCell>
                    <TableCell className="text-xs">{d.source === 'manual' ? 'Added by staff' : 'GOV.UK'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
