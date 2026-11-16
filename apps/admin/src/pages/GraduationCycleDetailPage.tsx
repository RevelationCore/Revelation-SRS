import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  PageHeader, Card, CardHeader, CardBody, Button, Select, Badge, Spinner,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import {
  type CycleInvitation, type GraduationCycle,
  allocateInvitation, deriveInvitations, freezeCycle, getGraduationCycle, listCycleInvitations, recordAttendance,
} from '../api/graduation.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? (err.detail ?? err.message) : fallback;
}

const RESPONSE_LABELS: Record<string, string> = {
  invited: 'No reply yet', attending: 'Attending', 'in-absentia': 'In absentia', deferred: 'Deferred', declined: 'Declined',
};

/**
 * One graduation cycle: invite graduands, allocate those attending to a
 * ceremony (capacity and guest limits are enforced by the API), freeze the
 * presentation list, and record who attended.
 */
export function GraduationCycleDetailPage() {
  const { cycleId } = useParams<{ cycleId: string }>();
  const { roles } = useAuth();
  const [cycle, setCycle] = useState<GraduationCycle | null>(null);
  const [invitations, setInvitations] = useState<CycleInvitation[]>([]);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const canManage = userHasAnyPermission(roles, ['graduation:manage']);
  const canOpenRecord = userHasAnyPermission(roles, ['student:read:all']);

  const load = useCallback(async () => {
    if (!cycleId) return;
    try {
      const [c, i] = await Promise.all([getGraduationCycle(cycleId), listCycleInvitations(cycleId)]);
      setCycle(c); setInvitations(i);
    } catch (err) { setError(message(err, 'Failed to load the cycle')); }
  }, [cycleId]);
  useEffect(() => { void load(); }, [load]);

  const act = useCallback(async (run: () => Promise<unknown>): Promise<boolean> => {
    setActionError(''); setNotice('');
    try { await run(); await load(); return true; } catch (err) { setActionError(message(err, 'The action failed')); return false; }
  }, [load]);

  if (error) return <p className="text-sm text-danger-600" role="alert">{error}</p>;
  if (!cycle) return <div className="flex justify-center py-16"><Spinner /></div>;
  const frozen = Boolean(cycle.frozenAt);
  const ceremonyCode = (id: string) => cycle.ceremonies.find((c) => c.ceremonyId === id)?.ceremonyCode ?? id;

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Graduation', to: '/graduation' }]}
        title={cycle.title}
        description={`Awards conferred ${cycle.awardsFrom} – ${cycle.awardsTo}`}
        actions={<Badge value={frozen ? 'ratified' : 'pending'} label={frozen ? 'Presentation list frozen' : cycle.statusCode} />}
      />
      {actionError && <p className="mb-4 text-sm text-danger-600" role="alert">{actionError}</p>}
      {notice && <p className="mb-4 text-sm text-success-700" role="status">{notice}</p>}

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader title="Ceremonies" />
          <Table>
            <TableHead><tr><TableHeaderCell>Ceremony</TableHeaderCell><TableHeaderCell>When</TableHeaderCell><TableHeaderCell>Venue</TableHeaderCell><TableHeaderCell>Allocated</TableHeaderCell><TableHeaderCell>Guests each</TableHeaderCell></tr></TableHead>
            <TableBody>
              {cycle.ceremonies.map((c) => (
                <TableRow key={c.ceremonyId}>
                  <TableCell className="font-mono text-xs">{c.ceremonyCode}</TableCell>
                  <TableCell className="text-sm">{new Date(c.startsAt).toLocaleString('en-GB')}</TableCell>
                  <TableCell className="text-sm">{c.venue}</TableCell>
                  <TableCell>{c.allocated} / {c.capacity}</TableCell>
                  <TableCell>{c.guestLimit}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <Card>
          <CardHeader
            title={`Graduands (${invitations.length})`}
            actions={canManage && !frozen && (
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => void act(async () => {
                  const r = await deriveInvitations(cycle.cycleId);
                  setNotice(`${r.invited} invited; ${r.alreadyInvited} already invited; ${r.previouslyPresented} presented in an earlier cycle.`);
                })}>Invite graduands</Button>
                <Button size="sm" onClick={() => void act(() => freezeCycle(cycle.cycleId))}>Freeze presentation list</Button>
              </div>
            )}
          />
          <CardBody>
            {invitations.length === 0 ? <p className="text-sm text-neutral-600">No one invited yet.</p> : (
              <Table>
                <TableHead>
                  <tr><TableHeaderCell>Graduand</TableHeaderCell><TableHeaderCell>Reply</TableHeaderCell><TableHeaderCell>Guests</TableHeaderCell><TableHeaderCell>Ceremony</TableHeaderCell><TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell></tr>
                </TableHead>
                <TableBody>
                  {invitations.map((i) => (
                    <TableRow key={i.invitationId}>
                      <TableCell>
                        {canOpenRecord ? <Link to={`/students/${i.personId}`} className="text-primary-600 hover:underline">{i.studentName}</Link> : i.studentName}
                        <div className="text-xs text-neutral-500">{i.studentNumber}{i.accessibilityRequired ? ' · accessibility support requested' : ''}</div>
                      </TableCell>
                      <TableCell>{RESPONSE_LABELS[i.responseCode] ?? i.responseCode}</TableCell>
                      <TableCell>{i.guestCount}</TableCell>
                      <TableCell className="text-sm">
                        {i.allocation ? `${ceremonyCode(i.allocation.ceremonyId)}${i.allocation.presentationOrder !== null ? ` (#${i.allocation.presentationOrder})` : ''}` : '—'}
                        {i.allocation && i.allocation.attendanceCode !== 'allocated' && <div className="text-xs text-neutral-500">{i.allocation.attendanceCode}</div>}
                      </TableCell>
                      <TableCell className="text-right">
                        {canManage && !frozen && i.responseCode === 'attending' && !i.allocation && (
                          <AllocateControl invitation={i} ceremonies={cycle.ceremonies} onAllocate={(ceremonyId) => act(() => allocateInvitation(i.invitationId, ceremonyId))} />
                        )}
                        {canManage && frozen && i.allocation && (
                          <div className="inline-flex gap-2">
                            <Button size="sm" variant="secondary" onClick={() => void act(() => recordAttendance(i.allocation!.allocationId, 'attended'))}>Attended<span className="sr-only"> {i.studentName}</span></Button>
                            <Button size="sm" variant="secondary" onClick={() => void act(() => recordAttendance(i.allocation!.allocationId, 'absent'))}>Absent<span className="sr-only"> {i.studentName}</span></Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function AllocateControl({ invitation, ceremonies, onAllocate }: { invitation: CycleInvitation; ceremonies: GraduationCycle['ceremonies']; onAllocate: (ceremonyId: string) => Promise<boolean> }) {
  const [ceremonyId, setCeremonyId] = useState('');
  const id = `allocate-${invitation.invitationId}`;
  return (
    <div className="inline-flex items-end gap-2">
      <label htmlFor={id} className="sr-only">Ceremony for {invitation.studentName}</label>
      <Select id={id} value={ceremonyId} onChange={(e) => setCeremonyId(e.target.value)} className="w-40">
        <option value="">Ceremony…</option>
        {ceremonies.map((c) => <option key={c.ceremonyId} value={c.ceremonyId} disabled={c.allocated >= c.capacity}>{c.ceremonyCode} ({c.capacity - c.allocated} left)</option>)}
      </Select>
      <Button size="sm" disabled={!ceremonyId} onClick={() => void onAllocate(ceremonyId)}>Allocate</Button>
    </div>
  );
}
