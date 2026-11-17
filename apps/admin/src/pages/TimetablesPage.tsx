import { type ChangeEvent, useCallback, useEffect, useState } from 'react';
import {
  PageHeader, Card, CardHeader, CardBody, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
  Button, Select, LabelledField, Badge,
} from '@revelation-srs/ui';

import { type AcademicPeriod, listAcademicPeriods } from '../api/academicPeriods.js';
import { ApiError } from '../api/client.js';
import {
  type TimetablePublication, getTimetableStatus, listTimetablePublications, simulateTimetable, uploadTimetablePublication,
} from '../api/timetabling.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { Spinner } from '../components/Spinner.js';

const SOURCE_LABEL: Record<string, string> = { ttb: 'Timetabling system', 'srs-admin': 'Entered by registry', simulator: 'Simulator' };

/**
 * Timetables received from the timetabling system (Phase 4 D-24,
 * F-TTB-SIS-01). A publication is applied only if every offering it names
 * is found; otherwise it is rejected whole and the previous one stays
 * current. Selection uses the current timetable for clash checks (D-25).
 */
export function TimetablesPage() {
  const { roles } = useAuth();
  const canManage = userHasAnyPermission(roles, ['timetable:manage']);
  const [periods, setPeriods] = useState<AcademicPeriod[]>([]);
  const [periodId, setPeriodId] = useState('');
  const [publications, setPublications] = useState<TimetablePublication[]>([]);
  const [status, setStatus] = useState<{ lastAppliedAt: string | null; stale: boolean; staleAfterHours: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    listAcademicPeriods().then((p) => { setPeriods(p); setPeriodId((cur) => cur || p[0]?.academicPeriodId || ''); }).catch(() => setError('Failed to load academic periods'));
  }, []);

  const load = useCallback(async () => {
    if (!periodId) { setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const [pubs, st] = await Promise.all([listTimetablePublications(periodId), getTimetableStatus(periodId)]);
      setPublications(pubs); setStatus(st);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load timetables');
    } finally { setLoading(false); }
  }, [periodId]);
  useEffect(() => { void load(); }, [load]);

  async function run(action: () => Promise<TimetablePublication>) {
    setBusy(true); setError(''); setNotice('');
    try {
      const pub = await action();
      setNotice(pub.statusCode === 'applied'
        ? `Applied: ${pub.rowCount} activit${pub.rowCount === 1 ? 'y' : 'ies'}.`
        : `Rejected, so the previous timetable stays current: ${pub.rejectionReasons.join('; ')}`);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? (e.detail ?? e.message) : 'The timetable could not be received');
    } finally { setBusy(false); }
  }

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    let body: Record<string, unknown>;
    try { body = JSON.parse(await file.text()) as Record<string, unknown>; } catch { setError('The file is not valid JSON (contract timetable-publication.v1)'); return; }
    await run(() => uploadTimetablePublication({ ...body, academicPeriodId: periodId }));
  }

  return (
    <div>
      <PageHeader
        title="Timetables"
        description="Timetables published by the timetabling system, used to check module selections for clashes and shown on students' timetables."
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-64">
          <LabelledField label="Academic period" htmlFor="tt-period">
            <Select id="tt-period" value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
              {periods.map((p) => <option key={p.academicPeriodId} value={p.academicPeriodId}>{p.academicYear} — {p.periodCode}</option>)}
            </Select>
          </LabelledField>
        </div>
        {canManage && periodId && (
          <>
            <label className="inline-flex cursor-pointer items-center rounded border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50">
              Upload a publication file
              <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => void upload(e)} disabled={busy} />
            </label>
            <Button variant="secondary" disabled={busy} onClick={() => void run(() => simulateTimetable(periodId))}>Generate with the simulator</Button>
          </>
        )}
      </div>

      {error && <p className="mb-4 text-sm text-danger-600" role="alert">{error}</p>}
      {notice && <p className="mb-4 text-sm text-neutral-700" role="status">{notice}</p>}
      {status && (
        <p className={`mb-4 text-sm ${status.stale ? 'text-warning-700' : 'text-neutral-600'}`}>
          {status.lastAppliedAt ? `Timetable last updated ${new Date(status.lastAppliedAt).toLocaleString('en-GB')}` : 'No timetable has been applied for this period yet'}
          {status.stale && ` — older than ${status.staleAfterHours} hours, so clash checks may be out of date`}
        </p>
      )}

      {loading ? <div className="flex justify-center py-16"><Spinner /></div> : (
        <Card>
          <CardHeader title="Publications" />
          <CardBody>
            {publications.length === 0 ? <p className="text-sm text-neutral-600">None received for this period.</p> : (
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Received</TableHeaderCell>
                    <TableHeaderCell>Source</TableHeaderCell>
                    <TableHeaderCell>Version</TableHeaderCell>
                    <TableHeaderCell>Activities</TableHeaderCell>
                    <TableHeaderCell>Outcome</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {publications.map((p) => (
                    <TableRow key={p.timetablePublicationId}>
                      <TableCell className="text-xs">{new Date(p.receivedAt).toLocaleString('en-GB')}<span className="block text-neutral-500">{p.receivedBy}</span></TableCell>
                      <TableCell className="text-xs">{SOURCE_LABEL[p.sourceSystemCode] ?? p.sourceSystemCode}{p.fullPeriod ? ', whole period' : ''}</TableCell>
                      <TableCell className="font-mono text-xs">{p.sourceVersion}</TableCell>
                      <TableCell>{p.rowCount}</TableCell>
                      <TableCell>
                        <Badge value={p.statusCode === 'applied' ? 'approved' : 'rejected'} label={p.statusCode === 'applied' ? 'Applied' : 'Rejected'} />
                        {p.rejectionReasons.length > 0 && (
                          <ul className="mt-1 ml-4 list-disc text-xs text-danger-700">{p.rejectionReasons.map((r) => <li key={r}>{r}</li>)}</ul>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
