import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  PageHeader, Card, CardHeader, CardBody, Button, Input, Select, LabelledField, Badge, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, Spinner, CodeBadge, CodeLabel, CodeSelect,
} from '@revelation-srs/ui';
import {
  type AdjustmentCase, type AdjustmentCaseStatus,
  listAdjustmentCaseQueue, createAdjustmentCase,
} from '../api/adjustmentCases.js';
import { ApiError } from '../api/wellbeingModule.js';

export function AdjustmentCasesPage() {
  const [statusFilter, setStatusFilter] = useState<AdjustmentCaseStatus | ''>('');
  const [cases, setCases]     = useState<AdjustmentCase[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  // Linked from a disability support case: open the form already filled in.
  const [params] = useSearchParams();
  const prefill = {
    personId:                params.get('personId') ?? '',
    wellbeingCaseId:         params.get('wellbeingCaseId') ?? '',
    disabilitySupportCaseId: params.get('disabilitySupportCaseId') ?? '',
  };
  const [showCreate, setShowCreate] = useState(Boolean(prefill.disabilitySupportCaseId));

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
            <CodeSelect
              entity="wellbeing.adjustment_case" field="status_code"
              id="adj-case-status-filter"
              value={statusFilter}
              onChange={(v) => setStatusFilter(v as AdjustmentCaseStatus | '')}
              className="w-auto"
              emptyLabel="All statuses"
            />
            <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
              {showCreate ? 'Cancel' : 'New adjustment case'}
            </Button>
          </div>
        }
      />

      {showCreate && (
        <div className="mt-4">
          <CreateCaseForm prefill={prefill} onCreated={() => { setShowCreate(false); void load(); }} />
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
                    <TableCell><CodeLabel entity="wellbeing.adjustment_case" field="adjustment_type_code" code={c.adjustmentTypeCode} /></TableCell>
                    <TableCell><CodeBadge entity="wellbeing.adjustment_case" field="status_code" code={c.statusCode} /></TableCell>
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

function CreateCaseForm({ onCreated, prefill }: {
  onCreated: () => void;
  prefill: { personId: string; wellbeingCaseId: string; disabilitySupportCaseId: string };
}) {
  const [personId, setPersonId] = useState(prefill.personId);
  const [wellbeingCaseId, setWellbeingCaseId] = useState(prefill.wellbeingCaseId);
  const [disabilitySupportCaseId, setDisabilitySupportCaseId] = useState(prefill.disabilitySupportCaseId);
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
        description="Opens a referral against an existing disability support case. Open it from the disability support case (Wellbeing → Disability support) to have these filled in."
      />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-2 gap-3 items-end">
          <LabelledField label="Person ID" htmlFor="adj-create-person" required>
            <Input id="adj-create-person" value={personId} onChange={(e) => setPersonId(e.target.value)} />
          </LabelledField>
          <LabelledField label="Adjustment type" htmlFor="adj-create-type">
            <CodeSelect entity="wellbeing.adjustment_case" field="adjustment_type_code" id="adj-create-type" value={adjustmentTypeCode} onChange={(v) => setAdjustmentTypeCode(v)} />
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
