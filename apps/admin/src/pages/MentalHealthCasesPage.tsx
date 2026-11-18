import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  PageHeader, Card, CardHeader, CardBody, Button, Select, Textarea, LabelledField, Badge, Checkbox,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, Spinner,
} from '@revelation-srs/ui';

import {
  type MentalHealthCase, createMentalHealthCase, listMentalHealthCaseload, listMentalHealthCasesForPerson,
} from '../api/wellbeingCases.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import {
  PersonCell, StudentPicker, errorText, formatDate, labelFor, usePersonNames, useWellbeingCodes,
} from './WellbeingShared.js';

/** Mental health caseload: open cases, highest risk first, or one student's cases. */
export function MentalHealthCasesPage() {
  const { roles } = useAuth();
  const canManage = userHasAnyPermission(roles, ['mental-health-case:manage']);
  const [params, setParams] = useSearchParams();
  const personId = params.get('personId') ?? '';

  const [riskFilter, setRiskFilter] = useState('');
  const [mine, setMine] = useState(false);
  const [cases, setCases] = useState<MentalHealthCase[] | null>(null);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(Boolean(personId) && canManage);

  const statuses = useWellbeingCodes('mental_health_case', 'status_code');
  const risks = useWellbeingCodes('mental_health_case', 'risk_level_code');
  const concerns = useWellbeingCodes('mental_health_case', 'presenting_concern_code');
  const names = usePersonNames((cases ?? []).map((c) => c.personId));

  const load = useCallback(async () => {
    setCases(null); setError('');
    try {
      const { items } = personId
        ? await listMentalHealthCasesForPerson(personId)
        : await listMentalHealthCaseload({ ...(riskFilter ? { riskLevelCode: riskFilter } : {}), ...(mine ? { assignedTo: 'me' as const } : {}) });
      setCases(items);
    } catch (err) {
      setError(errorText(err, 'Failed to load mental health cases'));
    }
  }, [personId, riskFilter, mine]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <PageHeader
        title="Mental health cases"
        description={personId
          ? 'Every mental health case for this student, closed ones included.'
          : 'Open cases, highest risk first. Session notes are only on the case, and every view of them is recorded.'}
        actions={canManage ? <Button size="sm" onClick={() => setShowCreate((v) => !v)}>{showCreate ? 'Cancel' : 'Open a case'}</Button> : undefined}
      />

      {personId ? (
        <p className="mt-2 text-sm">
          <button type="button" className="text-primary-600 hover:underline" onClick={() => setParams({})}>Show the whole caseload</button>
        </p>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label htmlFor="mh-risk-filter" className="text-sm text-neutral-500">Risk:</label>
            <Select id="mh-risk-filter" value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)} className="w-auto">
              <option value="">Any</option>
              {risks.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
            </Select>
          </div>
          <label htmlFor="mh-mine" className="flex items-center gap-2 text-sm text-neutral-700">
            <Checkbox id="mh-mine" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only cases assigned to me
          </label>
        </div>
      )}

      {showCreate && (
        <div className="mt-4">
          <CreateMentalHealthCaseForm concerns={concerns} risks={risks} initialPersonId={personId} />
        </div>
      )}

      <div className="mt-6">
        {error ? <p className="text-sm text-danger-600">{error}</p>
          : cases === null ? <div className="flex justify-center py-16"><Spinner /></div>
          : cases.length === 0 ? <p className="text-sm text-neutral-600">No mental health cases match.</p>
          : (
            <Card>
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Student</TableHeaderCell>
                    <TableHeaderCell>Risk</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell>Concern</TableHeaderCell>
                    <TableHeaderCell>Consent</TableHeaderCell>
                    <TableHeaderCell>Since</TableHeaderCell>
                    <TableHeaderCell><span className="sr-only">Open</span></TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {cases.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell><PersonCell personId={c.personId} names={names} /></TableCell>
                      <TableCell><Badge value={`risk-${c.riskLevelCode}`} label={labelFor(risks, c.riskLevelCode)} /></TableCell>
                      <TableCell><Badge value={c.statusCode} label={labelFor(statuses, c.statusCode)} /></TableCell>
                      <TableCell>{labelFor(concerns, c.presentingConcernCode)}</TableCell>
                      <TableCell>{c.consentGiven ? `Given ${formatDate(c.consentDate)}` : 'Not recorded'}</TableCell>
                      <TableCell className="text-xs text-neutral-600">{formatDate(c.validFrom)}</TableCell>
                      <TableCell className="text-right">
                        <Link to={`/wellbeing/mental-health-cases/${c.id}`} className="text-sm text-primary-600 hover:underline">
                          View<span className="sr-only"> case for {names[c.personId] ?? c.personId}</span>
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

function CreateMentalHealthCaseForm({ concerns, risks, initialPersonId }: {
  concerns: Array<{ code: string; displayLabel: string }>; risks: Array<{ code: string; displayLabel: string }>; initialPersonId: string;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [personId, setPersonId] = useState(initialPersonId);
  const [presentingConcernCode, setConcern] = useState('');
  const [riskLevelCode, setRisk] = useState('low');
  const [notes, setNotes] = useState('');
  const [assignToMe, setAssignToMe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (!presentingConcernCode && concerns[0]) setConcern(concerns[0].code); }, [concerns, presentingConcernCode]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const { id } = await createMentalHealthCase({
        personId, presentingConcernCode, riskLevelCode,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(assignToMe && user?.sub ? { assignedAdvisorId: user.sub } : {}),
      });
      void navigate(`/wellbeing/mental-health-cases/${id}`);
    } catch (err) {
      setError(errorText(err, 'Could not open the case'));
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Open a mental health case" description="Starts at Referral received. Record consent before sharing anything beyond the wellbeing team." />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <form onSubmit={(e) => void submit(e)} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <LabelledField label="Student" htmlFor="mh-create-student" required>
            {initialPersonId
              ? <p className="font-mono text-xs">{initialPersonId}</p>
              : <StudentPicker id="mh-create-student" value={personId} onChange={(id) => setPersonId(id)} />}
          </LabelledField>
          <LabelledField label="Presenting concern" htmlFor="mh-create-concern" required>
            <Select id="mh-create-concern" value={presentingConcernCode} onChange={(e) => setConcern(e.target.value)}>
              {concerns.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
            </Select>
          </LabelledField>
          <LabelledField label="Initial risk level" htmlFor="mh-create-risk">
            <Select id="mh-create-risk" value={riskLevelCode} onChange={(e) => setRisk(e.target.value)}>
              {risks.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
            </Select>
          </LabelledField>
          <label htmlFor="mh-assign-me" className="flex items-center gap-2 self-end text-sm text-neutral-700">
            <Checkbox id="mh-assign-me" checked={assignToMe} onChange={(e) => setAssignToMe(e.target.checked)} /> Assign the case to me
          </label>
          <div className="md:col-span-2">
            <LabelledField label="Referral notes" htmlFor="mh-create-notes" hint="Kept in the wellbeing service only">
              <Textarea id="mh-create-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </LabelledField>
          </div>
          <div className="md:col-span-2">
            <Button type="submit" disabled={busy || !personId || !presentingConcernCode}>{busy ? 'Opening…' : 'Open case'}</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
