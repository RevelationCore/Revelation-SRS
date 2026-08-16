import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PageHeader, Card, CardHeader, CardBody, Button, Input, Select, LabelledField, Badge,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, Spinner,
} from '@revelation-srs/ui';
import {
  type AdjustmentCase, type AdjustmentCaseStatus,
  listAdjustmentCaseQueue, createAdjustmentCase,
} from '../api/adjustmentCases.js';
import { ApiError } from '../api/wellbeingModule.js';

const STATUS_OPTIONS: Array<AdjustmentCaseStatus | ''> = [
  '', 'referral_received', 'assessment_pending', 'under_assessment', 'determination_made',
  'under_review', 'approved', 'rejected', 'review_complete', 'closed',
];

const STATUS_LABELS: Record<string, string> = {
  referral_received:  'Referral received',
  assessment_pending: 'Assessment pending',
  under_assessment:   'Under assessment',
  determination_made: 'Determination made',
  under_review:        'Under review (panel)',
  approved:            'Approved',
  rejected:            'Rejected',
  review_complete:     'Review complete',
  closed:              'Closed',
};

export function AdjustmentCasesPage() {
  const [statusFilter, setStatusFilter] = useState<AdjustmentCaseStatus | ''>('');
  const [cases, setCases]     = useState<AdjustmentCase[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const { items } = await listAdjustmentCaseQueue(statusFilter);
      setCases(items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load adjustment cases');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <PageHeader
        title="Adjustment cases"
        description="Reasonable-adjustment referral, assessment, panel review, and approval — the wellbeing module's workflow. Approved cases distribute to the student record."
        actions={
          <div className="flex items-center gap-3">
            <label htmlFor="adj-case-status-filter" className="text-sm text-neutral-500">Status:</label>
            <Select
              id="adj-case-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as AdjustmentCaseStatus | '')}
              className="w-auto"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s ? (STATUS_LABELS[s] ?? s) : 'All statuses'}</option>
              ))}
            </Select>
            <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
              {showCreate ? 'Cancel' : 'New adjustment case'}
            </Button>
          </div>
        }
      />

      {showCreate && (
        <div className="mt-4">
          <CreateCaseForm onCreated={() => { setShowCreate(false); void load(); }} />
        </div>
      )}

      <div className="mt-6">
        {loading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : error ? (
          <p className="text-sm text-danger-600">{error}</p>
        ) : !cases || cases.length === 0 ? (
          <p className="text-sm text-neutral-600">No adjustment cases match this filter.</p>
        ) : (
          <Card>
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Person</TableHeaderCell>
                  <TableHeaderCell>Type</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Referred</TableHeaderCell>
                  <TableHeaderCell><span className="sr-only">Open</span></TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {cases.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">{c.personId}</TableCell>
                    <TableCell className="capitalize">{c.adjustmentTypeCode.replace(/-/g, ' ')}</TableCell>
                    <TableCell><Badge value={c.statusCode} label={STATUS_LABELS[c.statusCode] ?? c.statusCode} /></TableCell>
                    <TableCell className="text-xs text-neutral-600">{new Date(c.validFrom).toLocaleDateString('en-GB')}</TableCell>
                    <TableCell className="text-right">
                      <Link to={`/governance/adjustment-cases/${c.id}`} className="text-sm text-primary-600 hover:underline">
                        View
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

function CreateCaseForm({ onCreated }: { onCreated: () => void }) {
  const [personId, setPersonId] = useState('');
  const [wellbeingCaseId, setWellbeingCaseId] = useState('');
  const [disabilitySupportCaseId, setDisabilitySupportCaseId] = useState('');
  const [adjustmentTypeCode, setAdjustmentTypeCode] = useState('exam-time');
  const [rationale, setRationale] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      await createAdjustmentCase({
        personId: personId.trim(),
        wellbeingCaseId: wellbeingCaseId.trim(),
        disabilitySupportCaseId: disabilitySupportCaseId.trim(),
        adjustmentTypeCode,
        ...(rationale.trim() ? { rationale: rationale.trim() } : {}),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to create adjustment case');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="New adjustment case"
        description="Opens a referral against an existing disability support case. Find the wellbeing case ID and disability support case ID on the student's Wellbeing tab."
      />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-2 gap-3 items-end">
          <LabelledField label="Person ID" htmlFor="adj-create-person" required>
            <Input id="adj-create-person" value={personId} onChange={(e) => setPersonId(e.target.value)} />
          </LabelledField>
          <LabelledField label="Adjustment type" htmlFor="adj-create-type">
            <Select id="adj-create-type" value={adjustmentTypeCode} onChange={(e) => setAdjustmentTypeCode(e.target.value)}>
              <option value="exam-time">Exam time</option>
              <option value="venue">Venue</option>
              <option value="coursework">Coursework</option>
              <option value="placement">Placement</option>
              <option value="other">Other</option>
            </Select>
          </LabelledField>
          <LabelledField label="Wellbeing case ID" htmlFor="adj-create-wc" required>
            <Input id="adj-create-wc" value={wellbeingCaseId} onChange={(e) => setWellbeingCaseId(e.target.value)} />
          </LabelledField>
          <LabelledField label="Disability support case ID" htmlFor="adj-create-dsc" required>
            <Input id="adj-create-dsc" value={disabilitySupportCaseId} onChange={(e) => setDisabilitySupportCaseId(e.target.value)} />
          </LabelledField>
          <div className="col-span-2">
            <LabelledField label="Rationale" htmlFor="adj-create-rationale">
              <Input id="adj-create-rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} />
            </LabelledField>
          </div>
          <div className="col-span-2">
            <Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create case'}</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
