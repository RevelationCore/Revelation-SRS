import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Card, CardHeader, CardBody, Button, PageHeader, LabelledField, Input, Select,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, Badge,
} from '@revelation-srs/ui';
import {
  type ValidationIssueSeverity,
  type RegulatoryCollection,
  createCollection,
  createSnapshot,
  addRecord,
  addValidationIssue,
  signOffCollection,
  submitCollection,
  listCollections,
} from '../api/regulatoryCollections.js';
import { ApiError } from '../api/client.js';
import { Spinner } from '../components/Spinner.js';

// The write-only pipeline below walks one collection → snapshot → records →
// validation → signoff → submit in a single session; CollectionsList gives a
// browsable view onto the same regulatory_collection table.
export function RegulatoryCollectionsPage() {
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [snapshotId, setSnapshotId]     = useState<string | null>(null);
  const [error, setError]               = useState('');

  return (
    <div>
      <PageHeader
        title="Regulatory collections"
        description="Build a regulatory data collection: snapshot the source data, add records, validate, sign off, and submit to the regulator."
      />
      {error && <p className="mb-4 text-sm text-danger-600">{error}</p>}
      <div className="space-y-6">
        <CollectionsList />
        <CollectionStep onCreated={(id) => { setCollectionId(id); setError(''); }} onError={setError} />
        {collectionId && (
          <SnapshotStep collectionId={collectionId} onCreated={(id) => { setSnapshotId(id); setError(''); }} onError={setError} />
        )}
        {snapshotId && <RecordStep snapshotId={snapshotId} onError={setError} />}
        {collectionId && <ValidationStep collectionId={collectionId} onError={setError} />}
        {collectionId && <SignoffStep collectionId={collectionId} onError={setError} />}
        {collectionId && snapshotId && (
          <SubmitStep collectionId={collectionId} snapshotId={snapshotId} onError={setError} />
        )}
      </div>
    </div>
  );
}

function CollectionStep({ onCreated, onError }: { onCreated: (id: string) => void; onError: (msg: string) => void }) {
  const [regulatorCode, setRegulatorCode]           = useState('');
  const [collectionTypeCode, setCollectionTypeCode] = useState('');
  const [academicYear, setAcademicYear]             = useState('');
  const [submitting, setSubmitting]                 = useState(false);
  const [id, setId]                                 = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); onError('');
    try {
      const { regulatoryCollectionId } = await createCollection({
        regulatorCode: regulatorCode.trim(),
        collectionTypeCode: collectionTypeCode.trim(),
        academicYear: academicYear.trim(),
      });
      setId(regulatoryCollectionId);
      onCreated(regulatoryCollectionId);
    } catch (err) {
      onError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to create collection');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="1. Create collection" />
      <CardBody>
        {id ? (
          <p className="text-sm text-success-700">Collection created: <span className="font-mono text-xs">{id}</span></p>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-3 gap-3 items-end">
            <LabelledField label="Regulator code" htmlFor="rc-regulator" required>
              <Input id="rc-regulator" value={regulatorCode} onChange={(e) => setRegulatorCode(e.target.value)} placeholder="hesa" />
            </LabelledField>
            <LabelledField label="Collection type" htmlFor="rc-type" required>
              <Input id="rc-type" value={collectionTypeCode} onChange={(e) => setCollectionTypeCode(e.target.value)} placeholder="student-record" />
            </LabelledField>
            <LabelledField label="Academic year" htmlFor="rc-year" required>
              <Input id="rc-year" value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} placeholder="2025/26" />
            </LabelledField>
            <div className="col-span-3">
              <Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create collection'}</Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

function SnapshotStep({ collectionId, onCreated, onError }: { collectionId: string; onCreated: (id: string) => void; onError: (msg: string) => void }) {
  const [sourceTransactionTime, setSourceTransactionTime] = useState('');
  const [submitting, setSubmitting]                       = useState(false);
  const [id, setId]                                       = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); onError('');
    try {
      const { collectionSnapshotId } = await createSnapshot(collectionId, new Date(sourceTransactionTime || Date.now()).toISOString());
      setId(collectionSnapshotId);
      onCreated(collectionSnapshotId);
    } catch (err) {
      onError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to create snapshot');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="2. Snapshot source data" />
      <CardBody>
        {id ? (
          <p className="text-sm text-success-700">Snapshot created: <span className="font-mono text-xs">{id}</span></p>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="flex items-end gap-3">
            <LabelledField label="Source transaction time" htmlFor="rc-tx-time" hint="Defaults to now">
              <Input id="rc-tx-time" type="datetime-local" value={sourceTransactionTime} onChange={(e) => setSourceTransactionTime(e.target.value)} />
            </LabelledField>
            <Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create snapshot'}</Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

function RecordStep({ snapshotId, onError }: { snapshotId: string; onError: (msg: string) => void }) {
  const [enrolmentId, setEnrolmentId]     = useState('');
  const [recordPayload, setRecordPayload] = useState('{}');
  const [submitting, setSubmitting]       = useState(false);
  const [records, setRecords]             = useState<string[]>([]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(recordPayload) as Record<string, unknown>;
    } catch {
      onError('Record payload must be valid JSON.');
      return;
    }
    setSubmitting(true); onError('');
    try {
      const { regulatoryRecordId } = await addRecord(snapshotId, {
        ...(enrolmentId.trim() ? { enrolmentId: enrolmentId.trim() } : {}),
        recordPayload: payload,
      });
      setRecords(r => [...r, regulatoryRecordId]);
      setEnrolmentId(''); setRecordPayload('{}');
    } catch (err) {
      onError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to add record');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="3. Add records" />
      <CardBody>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          <LabelledField label="Enrolment ID" htmlFor="rc-enrol" hint="Optional">
            <Input id="rc-enrol" value={enrolmentId} onChange={(e) => setEnrolmentId(e.target.value)} />
          </LabelledField>
          <LabelledField label="Record payload (JSON)" htmlFor="rc-payload" required>
            <textarea
              id="rc-payload"
              value={recordPayload}
              onChange={(e) => setRecordPayload(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </LabelledField>
          <Button type="submit" size="sm" variant="secondary" disabled={submitting}>
            {submitting ? 'Adding…' : 'Add record'}
          </Button>
        </form>
        {records.length > 0 && <p className="mt-3 text-xs text-neutral-500">{records.length} record(s) added this session.</p>}
      </CardBody>
    </Card>
  );
}

function ValidationStep({ collectionId, onError }: { collectionId: string; onError: (msg: string) => void }) {
  const [severityCode, setSeverityCode] = useState<ValidationIssueSeverity>('warning');
  const [message, setMessage]           = useState('');
  const [fieldCode, setFieldCode]       = useState('');
  const [submitting, setSubmitting]     = useState(false);
  const [issues, setIssues]             = useState<string[]>([]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); onError('');
    try {
      const { issueId } = await addValidationIssue(collectionId, {
        severityCode,
        message: message.trim(),
        ...(fieldCode.trim() ? { fieldCode: fieldCode.trim() } : {}),
      });
      setIssues(i => [...i, issueId]);
      setMessage(''); setFieldCode('');
    } catch (err) {
      onError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to add validation issue');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="4. Validation issues" description="Optional — record any data-quality issues found." />
      <CardBody>
        <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-3 gap-3 items-end">
          <LabelledField label="Severity" htmlFor="rc-sev">
            <Select id="rc-sev" value={severityCode} onChange={(e) => setSeverityCode(e.target.value as ValidationIssueSeverity)}>
              <option value="warning">Warning</option>
              <option value="blocking">Blocking</option>
            </Select>
          </LabelledField>
          <LabelledField label="Field code" htmlFor="rc-field" hint="Optional">
            <Input id="rc-field" value={fieldCode} onChange={(e) => setFieldCode(e.target.value)} />
          </LabelledField>
          <LabelledField label="Message" htmlFor="rc-msg" required>
            <Input id="rc-msg" value={message} onChange={(e) => setMessage(e.target.value)} />
          </LabelledField>
          <div className="col-span-3">
            <Button type="submit" size="sm" variant="secondary" disabled={submitting}>
              {submitting ? 'Adding…' : 'Add issue'}
            </Button>
          </div>
        </form>
        {issues.length > 0 && <p className="mt-3 text-xs text-neutral-500">{issues.length} issue(s) recorded this session.</p>}
      </CardBody>
    </Card>
  );
}

function SignoffStep({ collectionId, onError }: { collectionId: string; onError: (msg: string) => void }) {
  const [commentary, setCommentary] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [signedOff, setSignedOff]   = useState(false);

  async function handleSignoff() {
    setSubmitting(true); onError('');
    try {
      await signOffCollection(collectionId, commentary.trim() || undefined);
      setSignedOff(true);
    } catch (err) {
      onError(err instanceof ApiError ? (err.detail ?? err.message) : 'Sign-off failed');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="5. Sign off" />
      <CardBody>
        {signedOff ? (
          <p className="text-sm text-success-700">Collection signed off.</p>
        ) : (
          <div className="space-y-3">
            <LabelledField label="Commentary" htmlFor="rc-commentary" hint="Optional">
              <Input id="rc-commentary" value={commentary} onChange={(e) => setCommentary(e.target.value)} />
            </LabelledField>
            <Button onClick={() => void handleSignoff()} disabled={submitting}>
              {submitting ? 'Signing off…' : 'Sign off'}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function SubmitStep({ collectionId, snapshotId, onError }: { collectionId: string; snapshotId: string; onError: (msg: string) => void }) {
  const [submissionReference, setSubmissionReference] = useState('');
  const [submitting, setSubmitting]                   = useState(false);
  const [submitted, setSubmitted]                     = useState(false);

  async function handleSubmit() {
    setSubmitting(true); onError('');
    try {
      await submitCollection(collectionId, {
        collectionSnapshotId: snapshotId,
        ...(submissionReference.trim() ? { submissionReference: submissionReference.trim() } : {}),
      });
      setSubmitted(true);
    } catch (err) {
      onError(err instanceof ApiError ? (err.detail ?? err.message) : 'Submission failed');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="6. Submit to regulator" />
      <CardBody>
        {submitted ? (
          <p className="text-sm text-success-700">Collection submitted.</p>
        ) : (
          <div className="flex items-end gap-3">
            <LabelledField label="Submission reference" htmlFor="rc-subref" hint="Optional">
              <Input id="rc-subref" value={submissionReference} onChange={(e) => setSubmissionReference(e.target.value)} />
            </LabelledField>
            <Button onClick={() => void handleSubmit()} disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit'}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function CollectionsList() {
  const [collections, setCollections] = useState<RegulatoryCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setCollections(await listCollections());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load collections');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <Card>
      <CardHeader
        title="Existing collections"
        actions={<Button variant="secondary" size="sm" onClick={() => void load()}>Refresh</Button>}
      />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        {loading ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : collections.length === 0 ? (
          <p className="text-sm text-neutral-500">No collections found.</p>
        ) : (
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Collection ID</TableHeaderCell>
                <TableHeaderCell>Regulator</TableHeaderCell>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell>Academic year</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Created</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {collections.map((c) => (
                <TableRow key={c.regulatoryCollectionId}>
                  <TableCell className="font-mono text-xs">{c.regulatoryCollectionId}</TableCell>
                  <TableCell>{c.regulatorCode}</TableCell>
                  <TableCell className="text-xs">{c.collectionTypeCode}</TableCell>
                  <TableCell>{c.academicYear}</TableCell>
                  <TableCell><Badge value={c.statusCode} /></TableCell>
                  <TableCell className="text-neutral-500">{new Date(c.createdAt).toLocaleDateString('en-GB')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}
