import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  PageHeader, Card, CardHeader, CardBody, Button, Input, Select, LabelledField, Badge,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, Spinner,
} from '@revelation-srs/ui';

import {
  type DisabilityCaseDetail, addDsaEntitlement, changeDisabilityCaseStatus, changeEvidenceStatus,
  getDisabilityCase, registerDisabilityEvidence,
} from '../api/wellbeingCases.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import {
  PersonCell, StatusChanger, errorText, formatDate, labelFor, usePersonNames, useWellbeingCodes,
} from './WellbeingShared.js';

export function DisabilityCaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const { roles } = useAuth();
  const canWrite = userHasAnyPermission(roles, ['disability:write']);
  const canOpenAdjustment = userHasAnyPermission(roles, ['adjustment-case:manage']);

  const [c, setC] = useState<DisabilityCaseDetail | null>(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);

  const statuses = useWellbeingCodes('disability_support_case', 'status_code');
  const supportTypes = useWellbeingCodes('disability_support_case', 'support_type_code');
  const planStatuses = useWellbeingCodes('disability_support_case', 'support_plan_status_code');
  const evidenceTypes = useWellbeingCodes('evidence_reference', 'evidence_type_code');
  const evidenceStatuses = useWellbeingCodes('evidence_reference', 'status_code');
  const entitlementTypes = useWellbeingCodes('dsa_entitlement', 'entitlement_type_code');
  const names = usePersonNames(c ? [c.personId] : []);

  const load = useCallback(async () => {
    if (!caseId) return;
    setError('');
    try {
      setC(await getDisabilityCase(caseId));
    } catch (err) {
      setError(errorText(err, 'Failed to load the case'));
    }
  }, [caseId]);

  useEffect(() => { void load(); }, [load]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setActionError('');
    try {
      await action();
      await load();
    } catch (err) {
      setActionError(errorText(err, 'The change was not saved'));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="py-8 text-sm text-danger-600">{error}</p>;
  if (!c || !caseId) return <div className="flex justify-center py-20"><Spinner /></div>;

  const adjustmentLink = `/governance/adjustment-cases?${new URLSearchParams({
    personId: c.personId, wellbeingCaseId: c.wellbeingCaseId, disabilitySupportCaseId: c.id,
  }).toString()}`;

  return (
    <div>
      <PageHeader
        title={`Disability support case ${c.caseRef}`}
        description="Every view of this case is recorded in the wellbeing audit log."
      />
      <p className="mt-2 text-sm"><Link to="/wellbeing/disability-cases" className="text-primary-600 hover:underline">Back to the caseload</Link></p>

      {actionError && <p role="alert" className="mt-4 text-sm text-danger-600">{actionError}</p>}

      <Card className="mt-4">
        <CardHeader title="Case" />
        <CardBody>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
            <div><dt className="text-neutral-500">Student</dt><dd><PersonCell personId={c.personId} names={names} /></dd></div>
            <div><dt className="text-neutral-500">Status</dt><dd><Badge value={c.statusCode} label={labelFor(statuses, c.statusCode)} /></dd></div>
            <div><dt className="text-neutral-500">Support type</dt><dd>{labelFor(supportTypes, c.supportTypeCode)}</dd></div>
            <div><dt className="text-neutral-500">Support plan</dt><dd>{labelFor(planStatuses, c.supportPlanStatusCode)}</dd></div>
            <div><dt className="text-neutral-500">DSA award reference</dt><dd>{c.dsaAwardRef ?? '—'}</dd></div>
            <div><dt className="text-neutral-500">Assigned advisor</dt><dd>{c.assignedAdvisorId ?? 'Unassigned'}</dd></div>
            <div className="md:col-span-3"><dt className="text-neutral-500">Notes</dt><dd className="whitespace-pre-wrap">{c.notes ?? '—'}</dd></div>
          </dl>
          <div className="mt-4 flex flex-wrap items-end gap-6">
            {canWrite && (
              <StatusChanger id="dc-status" allowed={c.allowedNextStatuses} members={statuses} busy={busy}
                onChange={(s) => void run(() => changeDisabilityCaseStatus(caseId, s))} />
            )}
            {canWrite && c.allowedNextStatuses.length === 0 && <p className="text-sm text-neutral-600">This case is closed and can no longer change.</p>}
            {canOpenAdjustment && c.statusCode === 'active' && (
              <Link to={adjustmentLink} className="text-sm text-primary-600 hover:underline">Open an adjustment case for this support</Link>
            )}
          </div>
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Evidence" description="The documents themselves are held in the records system; this lists what has been asked for and received." />
        <CardBody>
          {c.evidence.length === 0 ? <p className="text-sm text-neutral-600">No evidence registered.</p> : (
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Evidence</TableHeaderCell>
                  <TableHeaderCell>Document reference</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Registered</TableHeaderCell>
                  {canWrite && <TableHeaderCell><span className="sr-only">Change status</span></TableHeaderCell>}
                </tr>
              </TableHead>
              <TableBody>
                {c.evidence.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{labelFor(evidenceTypes, e.evidenceTypeCode)}</TableCell>
                    <TableCell className="font-mono text-xs">{e.edrmsDocumentRef ?? '—'}</TableCell>
                    <TableCell><Badge value={e.statusCode} label={labelFor(evidenceStatuses, e.statusCode)} /></TableCell>
                    <TableCell className="text-xs text-neutral-600">{formatDate(e.createdAt)}</TableCell>
                    {canWrite && (
                      <TableCell>
                        <StatusChanger id={`ev-${e.id}`} label="Mark as" allowed={e.allowedNextStatuses} members={evidenceStatuses} busy={busy}
                          onChange={(s) => void run(() => changeEvidenceStatus(e.id, s))} />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {canWrite && <RegisterEvidenceForm evidenceTypes={evidenceTypes} busy={busy} onSubmit={(input) => void run(() => registerDisabilityEvidence(caseId, input))} />}
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="DSA entitlements" description="What the student's Disabled Students' Allowance provides, and for how long." />
        <CardBody>
          {c.entitlements.length === 0 ? <p className="text-sm text-neutral-600">No entitlements recorded.</p> : (
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Entitlement</TableHeaderCell>
                  <TableHeaderCell>Provider reference</TableHeaderCell>
                  <TableHeaderCell>From</TableHeaderCell>
                  <TableHeaderCell>To</TableHeaderCell>
                  <TableHeaderCell>Approved by</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {c.entitlements.map((en) => (
                  <TableRow key={en.id}>
                    <TableCell>{labelFor(entitlementTypes, en.entitlementTypeCode)}</TableCell>
                    <TableCell>{en.providerRef ?? '—'}</TableCell>
                    <TableCell>{formatDate(en.effectiveFrom)}</TableCell>
                    <TableCell>{en.effectiveTo ? formatDate(en.effectiveTo) : 'Open-ended'}</TableCell>
                    <TableCell>{en.approvedBy}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {canWrite && <AddEntitlementForm entitlementTypes={entitlementTypes} busy={busy} onSubmit={(input) => void run(() => addDsaEntitlement(caseId, input))} />}
        </CardBody>
      </Card>
    </div>
  );
}

type Members = Array<{ code: string; displayLabel: string }>;

function RegisterEvidenceForm({ evidenceTypes, busy, onSubmit }: {
  evidenceTypes: Members; busy: boolean; onSubmit: (input: { evidenceTypeCode: string; filename: string; contentType: string }) => void;
}) {
  const [evidenceTypeCode, setEvidenceTypeCode] = useState('');
  const [filename, setFilename] = useState('');
  useEffect(() => { if (!evidenceTypeCode && evidenceTypes[0]) setEvidenceTypeCode(evidenceTypes[0].code); }, [evidenceTypes, evidenceTypeCode]);

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit({ evidenceTypeCode, filename: filename.trim(), contentType: contentTypeFor(filename.trim()) });
    setFilename('');
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-3 border-t border-neutral-100 pt-4">
      <LabelledField label="Evidence type" htmlFor="ev-type">
        <Select id="ev-type" value={evidenceTypeCode} onChange={(e) => setEvidenceTypeCode(e.target.value)} className="w-auto">
          {evidenceTypes.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
        </Select>
      </LabelledField>
      <LabelledField label="Document name" htmlFor="ev-filename" hint="As filed in the records system">
        <Input id="ev-filename" value={filename} onChange={(e) => setFilename(e.target.value)} />
      </LabelledField>
      <Button type="submit" size="sm" disabled={busy || !filename.trim() || !evidenceTypeCode}>Register evidence</Button>
    </form>
  );
}

function contentTypeFor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return 'application/octet-stream';
}

function AddEntitlementForm({ entitlementTypes, busy, onSubmit }: {
  entitlementTypes: Members; busy: boolean;
  onSubmit: (input: { entitlementTypeCode: string; providerRef?: string; effectiveFrom: string; effectiveTo?: string; approvedBy: string }) => void;
}) {
  const [entitlementTypeCode, setEntitlementTypeCode] = useState('');
  const [providerRef, setProviderRef] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [approvedBy, setApprovedBy] = useState('');
  useEffect(() => { if (!entitlementTypeCode && entitlementTypes[0]) setEntitlementTypeCode(entitlementTypes[0].code); }, [entitlementTypes, entitlementTypeCode]);

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit({
      entitlementTypeCode, effectiveFrom, approvedBy: approvedBy.trim(),
      ...(providerRef.trim() ? { providerRef: providerRef.trim() } : {}),
      ...(effectiveTo ? { effectiveTo } : {}),
    });
  }

  return (
    <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-3 border-t border-neutral-100 pt-4 md:grid-cols-3">
      <LabelledField label="Entitlement" htmlFor="ent-type">
        <Select id="ent-type" value={entitlementTypeCode} onChange={(e) => setEntitlementTypeCode(e.target.value)}>
          {entitlementTypes.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
        </Select>
      </LabelledField>
      <LabelledField label="Provider reference" htmlFor="ent-provider">
        <Input id="ent-provider" value={providerRef} onChange={(e) => setProviderRef(e.target.value)} />
      </LabelledField>
      <LabelledField label="Approved by (funding body)" htmlFor="ent-approved" required>
        <Input id="ent-approved" value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} />
      </LabelledField>
      <LabelledField label="From" htmlFor="ent-from" required>
        <Input id="ent-from" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
      </LabelledField>
      <LabelledField label="To" htmlFor="ent-to" hint="Leave empty if open-ended">
        <Input id="ent-to" type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} />
      </LabelledField>
      <div className="self-end">
        <Button type="submit" size="sm" disabled={busy || !entitlementTypeCode || !effectiveFrom || !approvedBy.trim()}>Add entitlement</Button>
      </div>
    </form>
  );
}
