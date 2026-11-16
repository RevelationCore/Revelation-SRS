import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PageHeader, Card, Button, Select, Badge, Spinner,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import { type Application, type ProgrammeSummary, listApplicationWorklist, listProgrammes } from '../api/applications.js';

/** Worklists an application can be on (BP-01-001 step 3 and the assessment stages). */
const WORKLISTS: Array<{ value: string; label: string; matches: (a: Application) => boolean }> = [
  { value: '', label: 'All open applications', matches: () => true },
  { value: 'identity', label: 'Identity to confirm', matches: (a) => a.identityMatchCode === 'needs-review' },
  { value: 'incomplete', label: 'Incomplete', matches: (a) => a.statusCode === 'incomplete' },
  { value: 'duplicate', label: 'Possible duplicate', matches: (a) => a.routingReasonCode === 'duplicate' },
  { value: 'restricted', label: 'Restricted', matches: (a) => a.routingReasonCode === 'restricted' },
  { value: 'received', label: 'Ready to assess', matches: (a) => a.statusCode === 'received' && !a.routingReasonCode },
  { value: 'under-assessment', label: 'Under assessment', matches: (a) => a.statusCode === 'under-assessment' },
  { value: 'recommended', label: 'Awaiting decision', matches: (a) => a.statusCode === 'recommended' },
];

export const ROUTING_LABELS: Record<string, string> = {
  identity: 'Identity to confirm', incomplete: 'Incomplete', duplicate: 'Possible duplicate', restricted: 'Restricted',
};

export const APPLICATION_STATUS_LABELS: Record<string, string> = {
  received: 'Received', incomplete: 'Incomplete', 'under-assessment': 'Under assessment', recommended: 'Recommended',
  rejected: 'Rejected', offered: 'Offered', withdrawn: 'Withdrawn',
};

/** Loads programme names where the user may read the catalogue; falls back to IDs otherwise. */
export function useProgrammeNames(): Map<string, ProgrammeSummary> {
  const [programmes, setProgrammes] = useState<ProgrammeSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    listProgrammes().then((p) => { if (!cancelled) setProgrammes(p); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  return useMemo(() => new Map(programmes.map((p) => [p.programmeId, p])), [programmes]);
}

export function ApplicationsPage() {
  const [applications, setApplications] = useState<Application[] | null>(null);
  const [worklist, setWorklist] = useState('');
  const [error, setError] = useState('');
  const programmes = useProgrammeNames();

  const load = useCallback(async () => {
    setError('');
    try {
      setApplications(await listApplicationWorklist());
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to load applications');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filter = WORKLISTS.find((w) => w.value === worklist) ?? WORKLISTS[0]!;
  const shown = (applications ?? []).filter(filter.matches);

  return (
    <div>
      <PageHeader
        title="Applications"
        description="Applications from every channel, including UCAS. Confirm uncertain identities, complete or route applications, assess and recommend; someone other than the recommender decides the offer."
        actions={
          <div className="flex items-center gap-3">
            <label htmlFor="application-worklist" className="text-sm text-neutral-500">Worklist:</label>
            <Select id="application-worklist" value={worklist} onChange={(e) => setWorklist(e.target.value)} className="w-auto">
              {WORKLISTS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
            </Select>
            <Button variant="secondary" size="sm" onClick={() => void load()}>Refresh</Button>
          </div>
        }
      />

      <div className="mt-6">
        {error ? (
          <p className="text-sm text-danger-600" role="alert">{error}</p>
        ) : applications === null ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : shown.length === 0 ? (
          <p className="text-sm text-neutral-600">No applications on this worklist.</p>
        ) : (
          <Card>
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Reference</TableHeaderCell>
                  <TableHeaderCell>Programme</TableHeaderCell>
                  <TableHeaderCell>Intake</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Needs</TableHeaderCell>
                  <TableHeaderCell>Received</TableHeaderCell>
                  <TableHeaderCell><span className="sr-only">Open</span></TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {shown.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <span className="text-xs uppercase text-neutral-500">{a.channelCode}</span>{' '}
                      <span className="font-mono text-xs">{a.sourceReference}</span>
                    </TableCell>
                    <TableCell className="text-sm">{programmeLabel(programmes, a.programmeId)}</TableCell>
                    <TableCell className="text-sm">{a.intakeCode ?? '—'}</TableCell>
                    <TableCell><Badge value={a.statusCode} label={APPLICATION_STATUS_LABELS[a.statusCode] ?? a.statusCode} /></TableCell>
                    <TableCell className="text-sm">{a.routingReasonCode ? (ROUTING_LABELS[a.routingReasonCode] ?? a.routingReasonCode) : '—'}</TableCell>
                    <TableCell className="text-xs text-neutral-600">{new Date(a.createdAt).toLocaleDateString('en-GB')}</TableCell>
                    <TableCell className="text-right">
                      <Link to={`/applications/${a.id}`} className="text-sm text-primary-600 hover:underline">
                        View<span className="sr-only"> application {a.sourceReference}</span>
                      </Link>
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

export function programmeLabel(programmes: Map<string, ProgrammeSummary>, programmeId: string | null): string {
  if (!programmeId) return 'Not yet known';
  const p = programmes.get(programmeId);
  return p ? `${p.code} — ${p.title}` : programmeId;
}
