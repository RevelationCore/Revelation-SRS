import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  PageHeader, Card, CardHeader, CardBody, Button, Badge, Spinner, StatusNotice,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import { type Publication, applyPublication, getPublication, listPublications } from '../api/curriculumPublications.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? (err.detail ?? err.message) : fallback;
}

const STATUS: Record<string, { value: string; label: string }> = {
  validated: { value: 'pending', label: 'Ready to apply' },
  rejected: { value: 'rejected', label: 'Rejected' },
  applied: { value: 'approved', label: 'Applied' },
};

/** Curriculum publications received from the curriculum system (BP-03-001; D-7). */
const OBJECT_TYPE_LABELS: Record<string, string> = {
  programme: 'Programme', module: 'Module', route: 'Route', 'rule-set': 'Rule set', 'module-group': 'Module group',
  'module-group-member': 'Group member', 'learning-outcome': 'Learning outcome', 'module-offering': 'Module offering',
};

export function CurriculumPublicationsPage() {
  const [publications, setPublications] = useState<Publication[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { listPublications().then(setPublications).catch((err: unknown) => setError(message(err, 'Failed to load publications'))); }, []);

  return (
    <div>
      <PageHeader
        title="Curriculum publications"
        description="Programme and module releases from the curriculum system. Each is checked item by item; a valid one is applied to the catalogue in one step."
      />
      <div className="mt-6">
        {error ? <p className="text-sm text-danger-600" role="alert">{error}</p>
          : !publications ? <div className="flex justify-center py-16"><Spinner /></div>
            : publications.length === 0 ? <p className="text-sm text-neutral-600">No publications received.</p>
              : (
                <Card>
                  <Table>
                    <TableHead><tr><TableHeaderCell>Publication</TableHeaderCell><TableHeaderCell>Effective</TableHeaderCell><TableHeaderCell>Changes</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell><TableHeaderCell><span className="sr-only">Open</span></TableHeaderCell></tr></TableHead>
                    <TableBody>
                      {publications.map((p) => (
                        <TableRow key={p.publicationId}>
                          <TableCell>{p.sourcePublicationRef}<div className="text-xs text-neutral-500">{p.sourceSystemCode} v{p.publicationVersion}{p.approvalRef ? ` · ${p.approvalRef}` : ''}</div></TableCell>
                          <TableCell className="text-sm">{p.effectiveFrom}</TableCell>
                          <TableCell className="text-sm">{p.counts.added} added, {p.counts.changed} changed, {p.counts.closed} closed{p.counts.rejected ? `, ${p.counts.rejected} invalid` : ''}</TableCell>
                          <TableCell><Badge value={STATUS[p.statusCode]?.value ?? p.statusCode} label={STATUS[p.statusCode]?.label ?? p.statusCode} /></TableCell>
                          <TableCell className="text-right"><Link to={`/curriculum-publications/${p.publicationId}`} className="text-sm text-primary-600 hover:underline">View<span className="sr-only"> {p.sourcePublicationRef}</span></Link></TableCell>
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

export function CurriculumPublicationDetailPage() {
  const { publicationId } = useParams<{ publicationId: string }>();
  const { roles, user } = useAuth();
  const [publication, setPublication] = useState<Publication | null>(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const canApply = userHasAnyPermission(roles, ['curriculum-publication:apply']);
  const canApproveBindings = userHasAnyPermission(roles, ['curriculum-binding:approve']);

  const load = useCallback(async () => {
    if (!publicationId) return;
    try { setPublication(await getPublication(publicationId)); } catch (err) { setError(message(err, 'Failed to load the publication')); }
  }, [publicationId]);
  useEffect(() => { void load(); }, [load]);

  if (error) return <p className="text-sm text-danger-600" role="alert">{error}</p>;
  if (!publication) return <div className="flex justify-center py-16"><Spinner /></div>;
  const receivedByMe = publication.receivedBy === user?.sub;

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Curriculum publications', to: '/curriculum-publications' }]}
        title={publication.sourcePublicationRef}
        description={`${publication.sourceSystemCode} version ${publication.publicationVersion}, effective ${publication.effectiveFrom}`}
        actions={<Badge value={STATUS[publication.statusCode]?.value ?? publication.statusCode} label={STATUS[publication.statusCode]?.label ?? publication.statusCode} />}
      />
      {actionError && <p className="mb-4 text-sm text-danger-600" role="alert">{actionError}</p>}
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader title="Items" description={`Received ${new Date(publication.receivedAt).toLocaleString('en-GB')} by ${publication.receivedBy}${publication.appliedAt ? `; applied ${new Date(publication.appliedAt).toLocaleString('en-GB')} by ${publication.appliedBy}` : ''}.`} />
          <Table>
            <TableHead><tr><TableHeaderCell>Item</TableHeaderCell><TableHeaderCell>Type</TableHeaderCell><TableHeaderCell>Change</TableHeaderCell><TableHeaderCell>Problem</TableHeaderCell></tr></TableHead>
            <TableBody>
              {publication.items.map((i) => (
                <TableRow key={i.itemId}>
                  <TableCell className="font-mono text-xs">{i.objectCode}</TableCell>
                  <TableCell>{OBJECT_TYPE_LABELS[i.objectTypeCode] ?? i.objectTypeCode}</TableCell>
                  <TableCell><Badge value={i.changeTypeCode === 'invalid' ? 'rejected' : i.changeTypeCode === 'unchanged' ? 'pending' : 'approved'} label={i.changeTypeCode} /></TableCell>
                  <TableCell className="text-sm text-danger-700">{i.issue ?? ''}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        {(publication.affectsStudents ?? 0) > 0 && publication.statusCode === 'validated' && (
          <div className="mt-4"><StatusNotice>
            This publication changes what {publication.affectsStudents} student(s) are bound to or registered on (under its correction rationale).
            {canApproveBindings ? ' Check the change before applying it.' : ' Only a curriculum-binding approver can apply it.'}
          </StatusNotice></div>
        )}
        {publication.statusCode === 'validated' && canApply && (
          <Card>
            <CardBody>
              {receivedByMe
                ? <StatusNotice>You entered this publication, so someone else must apply it.</StatusNotice>
                : (
                  <div className="flex items-center gap-3">
                    <p className="text-sm">Applying changes the catalogue for every affected cohort from {publication.effectiveFrom}. It is refused if the catalogue changed after this publication was received.</p>
                    <Button onClick={() => void (async () => {
                      setActionError('');
                      try { setPublication(await applyPublication(publication.publicationId)); } catch (err) { setActionError(message(err, 'Failed to apply')); }
                    })()}>Apply to catalogue</Button>
                  </div>
                )}
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
