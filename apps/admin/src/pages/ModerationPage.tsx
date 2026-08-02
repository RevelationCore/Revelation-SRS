import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Card, CardHeader, CardBody, Button, PageHeader, LabelledField, Input, Select,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, Badge,
} from '@revelation-srs/ui';
import {
  type ModerationOutcomeCode,
  type ModerationReview,
  createMarkSet,
  startReview,
  recordSample,
  completeReview,
  listReviews,
} from '../api/moderation.js';
import { ApiError } from '../api/client.js';
import { Spinner } from '../components/Spinner.js';

// The write-only mark-set → review → sample → outcome sequence below walks
// one review in a single session; ReviewsList gives a browsable view onto
// the same moderation_review table so staff can find prior/open reviews.
export function ModerationPage() {
  const [markSetId, setMarkSetId] = useState<string | null>(null);
  const [reviewId, setReviewId]   = useState<string | null>(null);
  const [error, setError]         = useState('');

  return (
    <div>
      <PageHeader
        title="Mark moderation"
        description="Create a mark set, start a moderation review, record sampled marks, and complete the review with an outcome."
      />
      {error && <p className="mb-4 text-sm text-danger-600">{error}</p>}
      <div className="space-y-6">
        <ReviewsList />
        <MarkSetStep onCreated={(id) => { setMarkSetId(id); setError(''); }} onError={setError} />
        {markSetId && (
          <ReviewStep markSetId={markSetId} onStarted={(id) => { setReviewId(id); setError(''); }} onError={setError} />
        )}
        {reviewId && (
          <SampleStep reviewId={reviewId} onError={setError} />
        )}
        {reviewId && (
          <CompleteStep reviewId={reviewId} onError={setError} />
        )}
      </div>
    </div>
  );
}

function ReviewsList() {
  const [reviews, setReviews] = useState<ModerationReview[]>([]);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const load = useCallback(async (open: boolean) => {
    setLoading(true); setError('');
    try {
      setReviews(await listReviews(open));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load reviews');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(onlyOpen); }, [load, onlyOpen]);

  return (
    <Card>
      <CardHeader
        title="Moderation reviews"
        description={
          <label className="flex items-center gap-2 text-xs text-neutral-500">
            <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
            Show only open reviews
          </label>
        }
      />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        {loading ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : reviews.length === 0 ? (
          <p className="text-sm text-neutral-500">No reviews found.</p>
        ) : (
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Review ID</TableHeaderCell>
                <TableHeaderCell>Mark set</TableHeaderCell>
                <TableHeaderCell>Moderator</TableHeaderCell>
                <TableHeaderCell>Rule version</TableHeaderCell>
                <TableHeaderCell>Started</TableHeaderCell>
                <TableHeaderCell>Outcome</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {reviews.map((r) => (
                <TableRow key={r.moderationReviewId}>
                  <TableCell className="font-mono text-xs">{r.moderationReviewId}</TableCell>
                  <TableCell className="font-mono text-xs">{r.markSetId}</TableCell>
                  <TableCell className="text-xs">{r.moderatorActorId}</TableCell>
                  <TableCell className="text-xs">{r.ruleVersion}</TableCell>
                  <TableCell className="text-neutral-500">{new Date(r.startedAt).toLocaleDateString('en-GB')}</TableCell>
                  <TableCell>{r.outcomeCode ? <Badge value={r.outcomeCode} /> : <span className="text-xs text-neutral-400">In progress</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}

function MarkSetStep({ onCreated, onError }: { onCreated: (id: string) => void; onError: (msg: string) => void }) {
  const [assessmentComponentId, setAssessmentComponentId] = useState('');
  const [markIds, setMarkIds]                             = useState('');
  const [sourceQueryHash, setSourceQueryHash]              = useState('');
  const [submitting, setSubmitting]                        = useState(false);
  const [markSetId, setMarkSetId]                           = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); onError('');
    try {
      const { markSetId: id } = await createMarkSet({
        assessmentComponentId: assessmentComponentId.trim(),
        markIds: markIds.split(',').map(s => s.trim()).filter(Boolean),
        sourceQueryHash: sourceQueryHash.trim(),
      });
      setMarkSetId(id);
      onCreated(id);
    } catch (err) {
      onError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to create mark set');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="1. Create mark set" description="Group marks awaiting moderation for an assessment component." />
      <CardBody>
        {markSetId ? (
          <p className="text-sm text-success-700">Mark set created: <span className="font-mono text-xs">{markSetId}</span></p>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <LabelledField label="Assessment component ID" htmlFor="mod-comp" required>
              <Input id="mod-comp" value={assessmentComponentId} onChange={(e) => setAssessmentComponentId(e.target.value)} />
            </LabelledField>
            <LabelledField label="Mark IDs" htmlFor="mod-marks" required hint="Comma-separated mark IDs">
              <Input id="mod-marks" value={markIds} onChange={(e) => setMarkIds(e.target.value)} placeholder="mark-1, mark-2" />
            </LabelledField>
            <LabelledField label="Source query hash" htmlFor="mod-hash" required>
              <Input id="mod-hash" value={sourceQueryHash} onChange={(e) => setSourceQueryHash(e.target.value)} />
            </LabelledField>
            <Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create mark set'}</Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

function ReviewStep({ markSetId, onStarted, onError }: { markSetId: string; onStarted: (id: string) => void; onError: (msg: string) => void }) {
  const [ruleVersion, setRuleVersion] = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [reviewId, setReviewId]       = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); onError('');
    try {
      const { reviewId: id } = await startReview({ markSetId, ruleVersion: ruleVersion.trim() });
      setReviewId(id);
      onStarted(id);
    } catch (err) {
      onError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to start review');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="2. Start review" description={`Mark set ${markSetId.slice(0, 8)}…`} />
      <CardBody>
        {reviewId ? (
          <p className="text-sm text-success-700">Review started: <span className="font-mono text-xs">{reviewId}</span></p>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="flex items-end gap-3">
            <LabelledField label="Rule version" htmlFor="mod-rule" required>
              <Input id="mod-rule" value={ruleVersion} onChange={(e) => setRuleVersion(e.target.value)} placeholder="v1" />
            </LabelledField>
            <Button type="submit" disabled={submitting}>{submitting ? 'Starting…' : 'Start review'}</Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

function SampleStep({ reviewId, onError }: { reviewId: string; onError: (msg: string) => void }) {
  const [markId, setMarkId]                 = useState('');
  const [sampleReasonCode, setSampleReasonCode] = useState('');
  const [originalMark, setOriginalMark]      = useState('');
  const [submitting, setSubmitting]          = useState(false);
  const [samples, setSamples]                = useState<string[]>([]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); onError('');
    try {
      const { sampleId } = await recordSample(reviewId, {
        markId: markId.trim(),
        sampleReasonCode: sampleReasonCode.trim(),
        originalMark: Number(originalMark),
      });
      setSamples(s => [...s, sampleId]);
      setMarkId(''); setSampleReasonCode(''); setOriginalMark('');
    } catch (err) {
      onError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to record sample');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="3. Record samples" description="Log individual marks sampled during the review." />
      <CardBody>
        <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-3 gap-3 items-end">
          <LabelledField label="Mark ID" htmlFor="mod-mark-id" required>
            <Input id="mod-mark-id" value={markId} onChange={(e) => setMarkId(e.target.value)} />
          </LabelledField>
          <LabelledField label="Sample reason code" htmlFor="mod-reason" required>
            <Input id="mod-reason" value={sampleReasonCode} onChange={(e) => setSampleReasonCode(e.target.value)} />
          </LabelledField>
          <LabelledField label="Original mark" htmlFor="mod-orig" required>
            <Input id="mod-orig" type="number" value={originalMark} onChange={(e) => setOriginalMark(e.target.value)} />
          </LabelledField>
          <div className="col-span-3">
            <Button type="submit" size="sm" variant="secondary" disabled={submitting}>
              {submitting ? 'Recording…' : 'Add sample'}
            </Button>
          </div>
        </form>
        {samples.length > 0 && (
          <p className="mt-3 text-xs text-neutral-500">{samples.length} sample(s) recorded this session.</p>
        )}
      </CardBody>
    </Card>
  );
}

function CompleteStep({ reviewId, onError }: { reviewId: string; onError: (msg: string) => void }) {
  const [outcomeCode, setOutcomeCode] = useState<ModerationOutcomeCode>('no-change');
  const [submitting, setSubmitting]   = useState(false);
  const [completed, setCompleted]     = useState(false);

  async function handleComplete() {
    setSubmitting(true); onError('');
    try {
      await completeReview(reviewId, outcomeCode);
      setCompleted(true);
    } catch (err) {
      onError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to complete review');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="4. Complete review" description="Record the moderation outcome." />
      <CardBody>
        {completed ? (
          <p className="text-sm text-success-700">Review completed with outcome: {outcomeCode}</p>
        ) : (
          <div className="flex items-end gap-3">
            <LabelledField label="Outcome" htmlFor="mod-outcome">
              <Select id="mod-outcome" value={outcomeCode} onChange={(e) => setOutcomeCode(e.target.value as ModerationOutcomeCode)}>
                <option value="no-change">No change</option>
                <option value="adjusted">Adjusted</option>
                <option value="escalated">Escalated</option>
              </Select>
            </LabelledField>
            <Button onClick={() => void handleComplete()} disabled={submitting} variant="primary">
              {submitting ? 'Completing…' : 'Complete review'}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
