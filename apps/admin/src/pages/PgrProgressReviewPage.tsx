import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Card, CardHeader, CardBody, Button, PageHeader, LabelledField, Input, Select, Badge,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';
import {
  type ProgressReview,
  type ReviewMember,
  type ResearchMilestone,
  type PgrReviewType,
  type PgrReviewMemberRole,
  type PgrReviewOutcome,
  type PgrMilestoneType,
  openReview,
  getReview,
  addReviewMember,
  listReviewMembers,
  declareReviewConflict,
  recuseReviewMember,
  recordReviewEvidence,
  recordReviewOutcome,
  publishMilestone,
  listResearchMilestones,
} from '../api/pgr.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { ApiError } from '../api/client.js';
import { Spinner } from '../components/Spinner.js';

export function PgrProgressReviewPage() {
  const [review, setReview] = useState<ProgressReview | null>(null);

  return (
    <div>
      <PageHeader
        title="PGR progress review"
        description="Open a review, assemble the panel, record evidence and conflicts, and decide the outcome."
      />
      <div className="space-y-6 mt-4">
        {!review && <OpenReviewForm onOpened={setReview} />}
        {review && (
          <ReviewWorkspace review={review} onRefresh={setReview} onStartNew={() => setReview(null)} />
        )}
        <MilestoneLookup />
      </div>
    </div>
  );
}

function OpenReviewForm({ onOpened }: { onOpened: (r: ProgressReview) => void }) {
  const { user } = useAuth();
  const [enrolmentId, setEnrolmentId]     = useState('');
  const [reviewTypeCode, setReviewTypeCode] = useState<PgrReviewType>('annual');
  const [submitting, setSubmitting]       = useState(false);
  const [error, setError]                 = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      const { reviewId } = await openReview({
        enrolmentId: enrolmentId.trim(),
        reviewTypeCode,
        ownerId: user?.sub ?? '',
      });
      onOpened(await getReview(reviewId));
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to open review');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="Open a progress review" />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-2 gap-3 items-end">
          <LabelledField label="Enrolment ID" htmlFor="pr-enrolment" required>
            <Input id="pr-enrolment" value={enrolmentId} onChange={(e) => setEnrolmentId(e.target.value)} />
          </LabelledField>
          <LabelledField label="Review type" htmlFor="pr-type">
            <Select id="pr-type" value={reviewTypeCode} onChange={(e) => setReviewTypeCode(e.target.value as PgrReviewType)}>
              <option value="initial">Initial</option>
              <option value="annual">Annual</option>
              <option value="upgrade">Upgrade / confirmation</option>
              <option value="return-from-interruption">Return from interruption</option>
            </Select>
          </LabelledField>
          <div className="col-span-2">
            <Button type="submit" disabled={submitting}>{submitting ? 'Opening…' : 'Open review'}</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function ReviewWorkspace({
  review, onRefresh, onStartNew,
}: {
  review:     ProgressReview;
  onRefresh:  (r: ProgressReview) => void;
  onStartNew: () => void;
}) {
  const { roles } = useAuth();
  const canDecide = userHasAnyPermission(roles, ['pgr-case:decide']);
  const [members, setMembers] = useState<ReviewMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [evidenceRecorded, setEvidenceRecorded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [reviewDetail, memberList] = await Promise.all([
        getReview(review.reviewId),
        listReviewMembers(review.reviewId),
      ]);
      onRefresh(reviewDetail);
      setMembers(memberList);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load review');
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review.reviewId]);

  useEffect(() => { void load(); }, [load]);

  const isDecided = review.statusCode !== 'open';
  const hasUnresolvedConflict = members.some((m) => m.declaredAt && !m.recusedAt);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={`Review ${review.reviewId.slice(0, 8)}…`}
          actions={
            <div className="flex items-center gap-2">
              <Badge value={review.statusCode} />
              <Button variant="ghost" size="sm" onClick={onStartNew}>Start a new review</Button>
            </div>
          }
        />
        <CardBody>
          {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <InfoRow label="Enrolment" value={review.enrolmentId} mono />
            <InfoRow label="Review type" value={review.reviewTypeCode} />
          </dl>
        </CardBody>
      </Card>

      {!isDecided && <MemberForm reviewId={review.reviewId} onAdded={load} />}

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : (
        <Card>
          <CardHeader title="Panel members" />
          <CardBody>
            {members.length === 0 ? (
              <p className="text-sm text-neutral-600">No panel members yet.</p>
            ) : (
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Person</TableHeaderCell>
                    <TableHeaderCell>Role</TableHeaderCell>
                    <TableHeaderCell>Conflict</TableHeaderCell>
                    <TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {members.map((m) => (
                    <MemberRow key={m.memberId} member={m} onChanged={load} />
                  ))}
                </TableBody>
              </Table>
            )}
          </CardBody>
        </Card>
      )}

      {!isDecided && (
        <EvidenceForm reviewId={review.reviewId} onRecorded={() => { setEvidenceRecorded(true); void load(); }} />
      )}

      {!isDecided && canDecide && (
        <OutcomeForm
          reviewId={review.reviewId}
          disabled={hasUnresolvedConflict || !evidenceRecorded}
          disabledReason={hasUnresolvedConflict
            ? 'Resolve every declared conflict before deciding.'
            : !evidenceRecorded ? 'Record at least one piece of evidence before deciding.' : undefined}
          onDecided={load}
        />
      )}

      {isDecided && review.statusCode !== 'referral' && review.statusCode !== 'escalation' && (
        <MilestonePanel reviewId={review.reviewId} />
      )}
    </div>
  );
}

function MemberRow({ member, onChanged }: { member: ReviewMember; onChanged: () => void }) {
  const [conflictTypeCode, setConflictTypeCode] = useState('');
  const [declaring, setDeclaring] = useState(false);
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState('');

  async function handleDeclare() {
    setBusy(true); setError('');
    try {
      await declareReviewConflict(member.memberId, conflictTypeCode.trim());
      setDeclaring(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to declare conflict');
    } finally { setBusy(false); }
  }

  async function handleRecuse() {
    setBusy(true); setError('');
    try {
      await recuseReviewMember(member.memberId);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to recuse member');
    } finally { setBusy(false); }
  }

  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{member.personId}</TableCell>
      <TableCell><Badge value={member.roleCode} /></TableCell>
      <TableCell className="text-xs">
        {member.conflictTypeCode
          ? (member.recusedAt ? <span className="text-success-700">Resolved ({member.conflictTypeCode})</span> : <span className="text-danger-600">{member.conflictTypeCode} — unresolved</span>)
          : <span className="text-neutral-500">None declared</span>}
        {error && <p className="text-danger-600">{error}</p>}
      </TableCell>
      <TableCell className="text-right">
        {!member.conflictTypeCode && (
          declaring ? (
            <div className="inline-flex items-center gap-2">
              <input
                type="text"
                placeholder="e.g. supervisory"
                className="rounded border border-neutral-300 px-2 py-1 text-xs w-32"
                value={conflictTypeCode}
                onChange={(e) => setConflictTypeCode(e.target.value)}
              />
              <Button size="sm" disabled={busy} onClick={() => void handleDeclare()}>Declare</Button>
              <Button size="sm" variant="ghost" onClick={() => setDeclaring(false)}>Cancel</Button>
            </div>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setDeclaring(true)}>Declare conflict</Button>
          )
        )}
        {member.conflictTypeCode && !member.recusedAt && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void handleRecuse()}>Recuse</Button>
        )}
      </TableCell>
    </TableRow>
  );
}

function MemberForm({ reviewId, onAdded }: { reviewId: string; onAdded: () => void }) {
  const [personId, setPersonId] = useState('');
  const [roleCode, setRoleCode] = useState<PgrReviewMemberRole>('chair');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]       = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      await addReviewMember(reviewId, { personId: personId.trim(), roleCode });
      setPersonId('');
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to add member');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="Add a panel member" />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-3 gap-3 items-end">
          <LabelledField label="Person ID" htmlFor="pr-member-person" required>
            <Input id="pr-member-person" value={personId} onChange={(e) => setPersonId(e.target.value)} />
          </LabelledField>
          <LabelledField label="Role" htmlFor="pr-member-role">
            <Select id="pr-member-role" value={roleCode} onChange={(e) => setRoleCode(e.target.value as PgrReviewMemberRole)}>
              <option value="chair">Chair</option>
              <option value="independent-reviewer">Independent reviewer</option>
              <option value="panel-member">Panel member</option>
            </Select>
          </LabelledField>
          <div className="col-span-3">
            <Button type="submit" size="sm" variant="secondary" disabled={submitting}>
              {submitting ? 'Adding…' : 'Add member'}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function EvidenceForm({ reviewId, onRecorded }: { reviewId: string; onRecorded: () => void }) {
  const [evidenceRef, setEvidenceRef] = useState('');
  const [sourceSystem, setSourceSystem] = useState('pgr-admin-upload');
  const [submitting, setSubmitting]   = useState(false);
  const [recorded, setRecorded]       = useState(0);
  const [error, setError]             = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      await recordReviewEvidence(reviewId, {
        evidenceRef: evidenceRef.trim(),
        classificationCode: 'sensitive-academic',
        sourceSystem: sourceSystem.trim(),
      });
      setEvidenceRef('');
      setRecorded((n) => n + 1);
      onRecorded();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to record evidence');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="Record evidence considered" />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-3 gap-3 items-end">
          <LabelledField label="Evidence reference" htmlFor="pr-evidence-ref" required>
            <Input id="pr-evidence-ref" value={evidenceRef} onChange={(e) => setEvidenceRef(e.target.value)} placeholder="annual-report-2028.pdf" />
          </LabelledField>
          <LabelledField label="Source system" htmlFor="pr-evidence-source">
            <Input id="pr-evidence-source" value={sourceSystem} onChange={(e) => setSourceSystem(e.target.value)} />
          </LabelledField>
          <div className="col-span-3 flex items-center gap-3">
            <Button type="submit" size="sm" variant="secondary" disabled={submitting}>
              {submitting ? 'Recording…' : 'Record evidence'}
            </Button>
            {recorded > 0 && <span className="text-xs text-neutral-500">{recorded} record(s) added this session.</span>}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function OutcomeForm({
  reviewId, disabled, disabledReason, onDecided,
}: {
  reviewId:       string;
  disabled:       boolean;
  disabledReason?: string;
  onDecided:      () => void;
}) {
  const [outcomeCode, setOutcomeCode] = useState<PgrReviewOutcome>('satisfactory');
  const [reasonText, setReasonText]   = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      await recordReviewOutcome(reviewId, { outcomeCode, ...(reasonText.trim() ? { reasonText: reasonText.trim() } : {}) });
      onDecided();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to record outcome');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="Panel outcome" />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        {disabled && disabledReason && <p className="mb-3 text-sm text-amber-700">{disabledReason}</p>}
        <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-2 gap-3 items-end">
          <LabelledField label="Outcome" htmlFor="pr-outcome">
            <Select id="pr-outcome" value={outcomeCode} onChange={(e) => setOutcomeCode(e.target.value as PgrReviewOutcome)}>
              <option value="satisfactory">Satisfactory progress</option>
              <option value="conditions">Conditions set</option>
              <option value="referral">Referral</option>
              <option value="transfer">Transfer</option>
              <option value="escalation">Escalation</option>
            </Select>
          </LabelledField>
          <LabelledField label="Reason" htmlFor="pr-outcome-reason">
            <Input id="pr-outcome-reason" value={reasonText} onChange={(e) => setReasonText(e.target.value)} />
          </LabelledField>
          <div className="col-span-2">
            <Button type="submit" disabled={submitting || disabled}>{submitting ? 'Recording…' : 'Record outcome'}</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function MilestonePanel({ reviewId }: { reviewId: string }) {
  const [milestoneTypeCode, setMilestoneTypeCode] = useState<PgrMilestoneType>('confirmation-of-registration');
  const [achievedDate, setAchievedDate] = useState('');
  const [submitting, setSubmitting]     = useState(false);
  const [published, setPublished]       = useState(false);
  const [error, setError]               = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      await publishMilestone(reviewId, { milestoneTypeCode, achievedDate: achievedDate.trim() });
      setPublished(true);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to publish milestone');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="Publish milestone" />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        {published ? (
          <p className="text-sm text-success-700">Milestone published.</p>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-3 gap-3 items-end">
            <LabelledField label="Milestone" htmlFor="pr-milestone-type">
              <Select id="pr-milestone-type" value={milestoneTypeCode} onChange={(e) => setMilestoneTypeCode(e.target.value as PgrMilestoneType)}>
                <option value="confirmation-of-registration">Confirmation of registration</option>
                <option value="upgrade">Upgrade to PhD</option>
                <option value="thesis-submission">Thesis submission</option>
                <option value="viva">Viva voce examination</option>
              </Select>
            </LabelledField>
            <LabelledField label="Achieved date" htmlFor="pr-milestone-date" required>
              <Input id="pr-milestone-date" type="date" value={achievedDate} onChange={(e) => setAchievedDate(e.target.value)} />
            </LabelledField>
            <div className="col-span-3">
              <Button type="submit" size="sm" variant="secondary" disabled={submitting}>
                {submitting ? 'Publishing…' : 'Publish milestone'}
              </Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

function MilestoneLookup() {
  const [enrolmentId, setEnrolmentId] = useState('');
  const [milestones, setMilestones]   = useState<ResearchMilestone[] | null>(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');

  async function handleLookup(e: FormEvent) {
    e.preventDefault();
    setLoading(true); setError(''); setMilestones(null);
    try {
      setMilestones(await listResearchMilestones(enrolmentId.trim()));
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to load milestones');
    } finally { setLoading(false); }
  }

  return (
    <Card>
      <CardHeader title="Look up research milestones" />
      <CardBody>
        <form onSubmit={(e) => void handleLookup(e)} className="flex items-end gap-3 mb-4">
          <LabelledField label="Enrolment ID" htmlFor="pr-lookup-enrolment" required>
            <Input id="pr-lookup-enrolment" value={enrolmentId} onChange={(e) => setEnrolmentId(e.target.value)} />
          </LabelledField>
          <Button type="submit" variant="secondary" disabled={loading}>{loading ? 'Looking up…' : 'Look up'}</Button>
        </form>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        {milestones && (
          milestones.length === 0 ? (
            <p className="text-sm text-neutral-600">No milestones recorded for this enrolment.</p>
          ) : (
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Milestone</TableHeaderCell>
                  <TableHeaderCell>Achieved</TableHeaderCell>
                  <TableHeaderCell>Published</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {milestones.map((m) => (
                  <TableRow key={m.milestoneId}>
                    <TableCell><Badge value={m.milestoneTypeCode} /></TableCell>
                    <TableCell className="text-xs">{new Date(m.achievedDate).toLocaleDateString('en-GB')}</TableCell>
                    <TableCell className="text-xs">
                      {m.publishedAt ? new Date(m.publishedAt).toLocaleDateString('en-GB') : <span className="text-neutral-500">Not published</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        )}
      </CardBody>
    </Card>
  );
}

function InfoRow({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 flex-shrink-0 text-neutral-500 text-xs pt-0.5">{label}</dt>
      <dd className={`text-neutral-900 text-xs ${mono ? 'font-mono' : ''}`}>{value ?? <span className="text-neutral-600">—</span>}</dd>
    </div>
  );
}
