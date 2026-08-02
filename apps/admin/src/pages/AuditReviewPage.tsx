import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Card, CardHeader, CardBody, Button, PageHeader, LabelledField, Input, Select,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, Badge,
} from '@revelation-srs/ui';
import { type FindingTypeCode, type AuditReviewCase, openReviewCase, addFinding, sealPartition, listCases } from '../api/auditReview.js';
import { useAuth } from '../auth/AuthContext.js';
import { ApiError } from '../api/client.js';
import { Spinner } from '../components/Spinner.js';

// The open-case/add-finding flow below carries one case's ID forward within
// a session; CasesList gives a read-side view onto the same audit_review_case
// table so staff can find prior/open review cases.
export function AuditReviewPage() {
  const { user } = useAuth();
  const [caseId, setCaseId]         = useState<string | null>(null);
  const [opening, setOpening]       = useState(false);
  const [error, setError]           = useState('');

  async function handleOpen() {
    setOpening(true); setError('');
    try {
      const { auditReviewCaseId } = await openReviewCase(user?.sub ?? '');
      setCaseId(auditReviewCaseId);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to open review case');
    } finally { setOpening(false); }
  }

  return (
    <div>
      <PageHeader
        title="Audit review"
        description="Open a review case against audit-log records, record findings, and seal audit partitions for compliance retention."
      />
      {error && <p className="mb-4 text-sm text-danger-600">{error}</p>}
      <div className="space-y-6">
        <CasesList />
        <Card>
          <CardHeader title="1. Open review case" />
          <CardBody>
            {caseId ? (
              <p className="text-sm text-success-700">Case opened: <span className="font-mono text-xs">{caseId}</span></p>
            ) : (
              <Button onClick={() => void handleOpen()} disabled={opening}>
                {opening ? 'Opening…' : 'Open review case'}
              </Button>
            )}
          </CardBody>
        </Card>
        {caseId && <FindingStep caseId={caseId} onError={setError} />}
        <SealPartitionCard onError={setError} />
      </div>
    </div>
  );
}

function CasesList() {
  const [cases, setCases] = useState<AuditReviewCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setCases(await listCases());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load cases');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <Card>
      <CardHeader
        title="Review cases"
        actions={<Button variant="secondary" size="sm" onClick={() => void load()}>Refresh</Button>}
      />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        {loading ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : cases.length === 0 ? (
          <p className="text-sm text-neutral-500">No review cases found.</p>
        ) : (
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Case ID</TableHeaderCell>
                <TableHeaderCell>Owner</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Opened</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {cases.map((c) => (
                <TableRow key={c.auditReviewCaseId}>
                  <TableCell className="font-mono text-xs">{c.auditReviewCaseId}</TableCell>
                  <TableCell className="text-xs">{c.ownerId}</TableCell>
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

function FindingStep({ caseId, onError }: { caseId: string; onError: (msg: string) => void }) {
  const [auditRecordId, setAuditRecordId]         = useState('');
  const [findingTypeCode, setFindingTypeCode]     = useState<FindingTypeCode>('no-concern');
  const [description, setDescription]             = useState('');
  const [submitting, setSubmitting]               = useState(false);
  const [findings, setFindings]                   = useState<string[]>([]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); onError('');
    try {
      const { findingId } = await addFinding(caseId, {
        auditRecordId: auditRecordId.trim(),
        findingTypeCode,
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      setFindings(f => [...f, findingId]);
      setAuditRecordId(''); setDescription('');
    } catch (err) {
      onError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to add finding');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader
        title="2. Record findings"
        description="Look up the audit record ID from the Audit log page, then attach a finding here."
      />
      <CardBody>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <LabelledField label="Audit record ID" htmlFor="ar-record" required>
              <Input id="ar-record" value={auditRecordId} onChange={(e) => setAuditRecordId(e.target.value)} />
            </LabelledField>
            <LabelledField label="Finding type" htmlFor="ar-type">
              <Select id="ar-type" value={findingTypeCode} onChange={(e) => setFindingTypeCode(e.target.value as FindingTypeCode)}>
                <option value="no-concern">No concern</option>
                <option value="policy-breach">Policy breach</option>
                <option value="tamper-suspected">Tamper suspected</option>
                <option value="investigation-required">Investigation required</option>
              </Select>
            </LabelledField>
          </div>
          <LabelledField label="Description" htmlFor="ar-desc" hint="Optional">
            <Input id="ar-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </LabelledField>
          <Button type="submit" size="sm" variant="secondary" disabled={submitting}>
            {submitting ? 'Recording…' : 'Add finding'}
          </Button>
        </form>
        {findings.length > 0 && <p className="mt-3 text-xs text-neutral-500">{findings.length} finding(s) recorded this session.</p>}
      </CardBody>
    </Card>
  );
}

function SealPartitionCard({ onError }: { onError: (msg: string) => void }) {
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd]     = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sealId, setSealId]         = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onError('');
    if (!rangeStart || !rangeEnd) { onError('Both range dates are required.'); return; }
    setSubmitting(true);
    try {
      const { sealId: id } = await sealPartition(new Date(rangeStart).toISOString(), new Date(rangeEnd).toISOString());
      setSealId(id);
    } catch (err) {
      onError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to seal partition');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="Seal audit partition" description="Cryptographically seals a date range of the audit hash-chain (retention:enforce)." />
      <CardBody>
        {sealId ? (
          <p className="text-sm text-success-700">Partition sealed: <span className="font-mono text-xs">{sealId}</span></p>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-3 gap-3 items-end">
            <LabelledField label="Range start" htmlFor="ar-range-start" required>
              <Input id="ar-range-start" type="date" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} />
            </LabelledField>
            <LabelledField label="Range end" htmlFor="ar-range-end" required>
              <Input id="ar-range-end" type="date" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} />
            </LabelledField>
            <Button type="submit" disabled={submitting}>{submitting ? 'Sealing…' : 'Seal partition'}</Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
