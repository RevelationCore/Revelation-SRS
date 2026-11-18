import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  PageHeader, Card, CardHeader, CardBody, Button, Input, Select, Textarea, LabelledField, Badge, Checkbox,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, Spinner,
} from '@revelation-srs/ui';

import {
  type DisabilityCase, createDisabilityCase, listDisabilityCaseload, listDisabilityCasesForPerson,
} from '../api/wellbeingCases.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import {
  PersonCell, StudentPicker, errorText, formatDate, labelFor, usePersonNames, useWellbeingCodes,
} from './WellbeingShared.js';

/** Disability support caseload: open cases across students, or one student's cases. */
export function DisabilityCasesPage() {
  const { roles } = useAuth();
  const canWrite = userHasAnyPermission(roles, ['disability:write']);
  const [params, setParams] = useSearchParams();
  const personId = params.get('personId') ?? '';

  const [statusFilter, setStatusFilter] = useState('');
  const [mine, setMine] = useState(false);
  const [cases, setCases] = useState<DisabilityCase[] | null>(null);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const statuses = useWellbeingCodes('disability_support_case', 'status_code');
  const supportTypes = useWellbeingCodes('disability_support_case', 'support_type_code');
  const names = usePersonNames((cases ?? []).map((c) => c.personId));

  const load = useCallback(async () => {
    setCases(null); setError('');
    try {
      const { items } = personId
        ? await listDisabilityCasesForPerson(personId)
        : await listDisabilityCaseload({ ...(statusFilter ? { statusCode: statusFilter } : {}), ...(mine ? { assignedTo: 'me' as const } : {}) });
      setCases(items);
    } catch (err) {
      setError(errorText(err, 'Failed to load disability cases'));
    }
  }, [personId, statusFilter, mine]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <PageHeader
        title="Disability support cases"
        description={personId
          ? 'Every disability support case for this student, closed ones included.'
          : 'Open cases across all students: awaiting assessment, awaiting evidence, or in active support.'}
        actions={canWrite ? <Button size="sm" onClick={() => setShowCreate((v) => !v)}>{showCreate ? 'Cancel' : 'Open a case'}</Button> : undefined}
      />

      {personId ? (
        <p className="mt-2 text-sm">
          <button type="button" className="text-primary-600 hover:underline" onClick={() => setParams({})}>Show the whole caseload</button>
        </p>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label htmlFor="dc-status-filter" className="text-sm text-neutral-500">Status:</label>
            <Select id="dc-status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-auto">
              <option value="">All open</option>
              {statuses.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
            </Select>
          </div>
          <label htmlFor="dc-mine" className="flex items-center gap-2 text-sm text-neutral-700">
            <Checkbox id="dc-mine" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only cases assigned to me
          </label>
        </div>
      )}

      {showCreate && (
        <div className="mt-4">
          <CreateDisabilityCaseForm supportTypes={supportTypes} initialPersonId={personId} />
        </div>
      )}

      <div className="mt-6">
        {error ? <p className="text-sm text-danger-600">{error}</p>
          : cases === null ? <div className="flex justify-center py-16"><Spinner /></div>
          : cases.length === 0 ? <p className="text-sm text-neutral-600">No disability support cases match.</p>
          : (
            <Card>
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Case</TableHeaderCell>
                    <TableHeaderCell>Student</TableHeaderCell>
                    <TableHeaderCell>Support</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell>Last changed</TableHeaderCell>
                    <TableHeaderCell><span className="sr-only">Open</span></TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {cases.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs">{c.caseRef}</TableCell>
                      <TableCell><PersonCell personId={c.personId} names={names} /></TableCell>
                      <TableCell>{labelFor(supportTypes, c.supportTypeCode)}</TableCell>
                      <TableCell><Badge value={c.statusCode} label={labelFor(statuses, c.statusCode)} /></TableCell>
                      <TableCell className="text-xs text-neutral-600">{formatDate(c.recordedAt)}</TableCell>
                      <TableCell className="text-right">
                        <Link to={`/wellbeing/disability-cases/${c.id}`} className="text-sm text-primary-600 hover:underline">
                          View<span className="sr-only"> case {c.caseRef}</span>
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

function CreateDisabilityCaseForm({ supportTypes, initialPersonId }: {
  supportTypes: Array<{ code: string; displayLabel: string }>; initialPersonId: string;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [personId, setPersonId] = useState(initialPersonId);
  const [supportTypeCode, setSupportTypeCode] = useState('');
  const [dsaAwardRef, setDsaAwardRef] = useState('');
  const [notes, setNotes] = useState('');
  const [assignToMe, setAssignToMe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (!supportTypeCode && supportTypes[0]) setSupportTypeCode(supportTypes[0].code); }, [supportTypes, supportTypeCode]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const { id } = await createDisabilityCase({
        personId, supportTypeCode,
        ...(dsaAwardRef.trim() ? { dsaAwardRef: dsaAwardRef.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(assignToMe && user?.sub ? { assignedAdvisorId: user.sub } : {}),
      });
      void navigate(`/wellbeing/disability-cases/${id}`);
    } catch (err) {
      setError(errorText(err, 'Could not open the case'));
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Open a disability support case" description="Starts at Assessment pending. Evidence and DSA entitlements are added on the case." />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <form onSubmit={(e) => void submit(e)} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <LabelledField label="Student" htmlFor="dc-create-student" required>
            {initialPersonId
              ? <p className="font-mono text-xs">{initialPersonId}</p>
              : <StudentPicker id="dc-create-student" value={personId} onChange={(id) => setPersonId(id)} />}
          </LabelledField>
          <LabelledField label="Support type" htmlFor="dc-create-type" required>
            <Select id="dc-create-type" value={supportTypeCode} onChange={(e) => setSupportTypeCode(e.target.value)}>
              {supportTypes.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
            </Select>
          </LabelledField>
          <LabelledField label="DSA award reference" htmlFor="dc-create-dsa" hint="If the student has a DSA award letter">
            <Input id="dc-create-dsa" value={dsaAwardRef} onChange={(e) => setDsaAwardRef(e.target.value)} />
          </LabelledField>
          <label htmlFor="dc-assign-me" className="flex items-center gap-2 self-end text-sm text-neutral-700">
            <Checkbox id="dc-assign-me" checked={assignToMe} onChange={(e) => setAssignToMe(e.target.checked)} /> Assign the case to me
          </label>
          <div className="md:col-span-2">
            <LabelledField label="Notes" htmlFor="dc-create-notes">
              <Textarea id="dc-create-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </LabelledField>
          </div>
          <div className="md:col-span-2">
            <Button type="submit" disabled={busy || !personId || !supportTypeCode}>{busy ? 'Opening…' : 'Open case'}</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
