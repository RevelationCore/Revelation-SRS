import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PageHeader, Card, CardHeader, CardBody, Button, Input, LabelledField, Badge, Spinner, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, useCodes,
} from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import { type GraduationCycleSummary, type NewCycle, createGraduationCycle, listGraduationCycles } from '../api/graduation.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? (err.detail ?? err.message) : fallback;
}

/** Graduation cycles (BP-06-005; D-4): each invites the graduands whose awards were conferred in its window. */
export function GraduationPage() {
  const cycleStatuses = useCodes('graduation_cycle', 'status_code');
  const { roles } = useAuth();
  const [cycles, setCycles] = useState<GraduationCycleSummary[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const canManage = userHasAnyPermission(roles, ['graduation:manage']);

  const load = useCallback(async () => {
    try { setCycles(await listGraduationCycles()); } catch (err) { setError(message(err, 'Failed to load graduation cycles')); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <PageHeader
        title="Graduation"
        description="Graduation cycles and their ceremonies. Invite graduands, allocate them to ceremonies, freeze the presentation list, then record attendance. Attendance never changes an award."
        actions={canManage && <Button size="sm" onClick={() => setCreating((v) => !v)}>{creating ? 'Cancel' : 'New cycle'}</Button>}
      />
      {creating && <div className="mt-4"><CreateCycleForm onCreated={() => { setCreating(false); void load(); }} /></div>}
      <div className="mt-6">
        {error ? <p className="text-sm text-danger-600" role="alert">{error}</p>
          : !cycles ? <div className="flex justify-center py-16"><Spinner /></div>
            : cycles.length === 0 ? <p className="text-sm text-neutral-600">No graduation cycles yet.</p>
              : (
                <Card>
                  <Table>
                    <TableHead><tr><TableHeaderCell>Cycle</TableHeaderCell><TableHeaderCell>Awards conferred</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell><TableHeaderCell><span className="sr-only">Open</span></TableHeaderCell></tr></TableHead>
                    <TableBody>
                      {cycles.map((c) => (
                        <TableRow key={c.cycleId}>
                          <TableCell>{c.title}<div className="font-mono text-xs text-neutral-500">{c.cycleCode}</div></TableCell>
                          <TableCell className="text-sm">{c.awardsFrom} – {c.awardsTo}</TableCell>
                          <TableCell><Badge value={c.frozenAt ? 'ratified' : 'pending'} label={cycleStatuses.label(c.statusCode)} /></TableCell>
                          <TableCell className="text-right">
                            <Link to={`/graduation/${c.cycleId}`} className="text-sm text-primary-600 hover:underline">View<span className="sr-only"> {c.title}</span></Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              )}
      </div>
    </div>
  );
}

function CreateCycleForm({ onCreated }: { onCreated: () => void }) {
  const [cycle, setCycle] = useState({ cycleCode: '', title: '', awardsFrom: '', awardsTo: '' });
  const [ceremonies, setCeremonies] = useState<NewCycle['ceremonies']>([{ ceremonyCode: '', startsAt: '', venue: '', capacity: 100, guestLimit: 2 }]);
  const [error, setError] = useState('');
  const set = (k: keyof typeof cycle) => (e: { target: { value: string } }) => setCycle((c) => ({ ...c, [k]: e.target.value }));
  const setCeremony = (i: number, patch: Partial<NewCycle['ceremonies'][number]>) => setCeremonies((list) => list.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await createGraduationCycle({ ...cycle, ceremonies: ceremonies.map((c) => ({ ...c, startsAt: new Date(c.startsAt).toISOString() })) });
      onCreated();
    } catch (err) { setError(message(err, 'Failed to create the cycle')); }
  }
  const complete = cycle.cycleCode && cycle.title && cycle.awardsFrom && cycle.awardsTo && ceremonies.every((c) => c.ceremonyCode && c.startsAt && c.venue && c.capacity > 0);

  return (
    <Card>
      <CardHeader title="New graduation cycle" />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600" role="alert">{error}</p>}
        <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <LabelledField label="Code" htmlFor="cycle-code" required><Input id="cycle-code" value={cycle.cycleCode} onChange={set('cycleCode')} /></LabelledField>
            <LabelledField label="Title" htmlFor="cycle-title" required><Input id="cycle-title" value={cycle.title} onChange={set('title')} /></LabelledField>
            <LabelledField label="Awards conferred from" htmlFor="cycle-from" required><Input id="cycle-from" type="date" value={cycle.awardsFrom} onChange={set('awardsFrom')} /></LabelledField>
            <LabelledField label="to" htmlFor="cycle-to" required><Input id="cycle-to" type="date" value={cycle.awardsTo} onChange={set('awardsTo')} /></LabelledField>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Ceremonies</legend>
            {ceremonies.map((c, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 md:grid-cols-[8rem_1fr_1fr_7rem_7rem_auto] items-end">
                <LabelledField label={`Ceremony ${i + 1} code`} htmlFor={`cer-code-${i}`}><Input id={`cer-code-${i}`} value={c.ceremonyCode} onChange={(e) => setCeremony(i, { ceremonyCode: e.target.value })} /></LabelledField>
                <LabelledField label={`Ceremony ${i + 1} starts`} htmlFor={`cer-start-${i}`}><Input id={`cer-start-${i}`} type="datetime-local" value={c.startsAt} onChange={(e) => setCeremony(i, { startsAt: e.target.value })} /></LabelledField>
                <LabelledField label={`Ceremony ${i + 1} venue`} htmlFor={`cer-venue-${i}`}><Input id={`cer-venue-${i}`} value={c.venue} onChange={(e) => setCeremony(i, { venue: e.target.value })} /></LabelledField>
                <LabelledField label={`Ceremony ${i + 1} capacity`} htmlFor={`cer-cap-${i}`}><Input id={`cer-cap-${i}`} type="number" min={1} value={c.capacity} onChange={(e) => setCeremony(i, { capacity: Number(e.target.value) })} /></LabelledField>
                <LabelledField label={`Ceremony ${i + 1} guests each`} htmlFor={`cer-guests-${i}`}><Input id={`cer-guests-${i}`} type="number" min={0} max={20} value={c.guestLimit ?? 0} onChange={(e) => setCeremony(i, { guestLimit: Number(e.target.value) })} /></LabelledField>
                {ceremonies.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => setCeremonies((l) => l.filter((_, j) => j !== i))}>Remove<span className="sr-only"> ceremony {i + 1}</span></Button>}
              </div>
            ))}
            <div><Button type="button" variant="secondary" size="sm" onClick={() => setCeremonies((l) => [...l, { ceremonyCode: '', startsAt: '', venue: '', capacity: 100, guestLimit: 2 }])}>Add ceremony</Button></div>
          </fieldset>
          <div><Button type="submit" disabled={!complete}>Create cycle</Button></div>
        </form>
      </CardBody>
    </Card>
  );
}
