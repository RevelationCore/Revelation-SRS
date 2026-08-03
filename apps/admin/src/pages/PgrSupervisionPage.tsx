import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Card, CardHeader, CardBody, Button, PageHeader, LabelledField, Input, Select, Badge,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';
import {
  type SupervisionCase,
  type SupervisorNomination,
  type StaffAssignment,
  type PgrSupervisorRole,
  openSupervisionCase,
  getSupervisionCase,
  nominateSupervisor,
  listNominations,
  recordEligibilityCheck,
  recordDirectorDecision,
  publishSupervisionToCris,
  listCurrentSupervision,
} from '../api/pgr.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { ApiError } from '../api/client.js';
import { Spinner } from '../components/Spinner.js';

export function PgrSupervisionPage() {
  const [supervisionCase, setSupervisionCase] = useState<SupervisionCase | null>(null);

  return (
    <div>
      <PageHeader
        title="PGR supervision"
        description="Open a supervision case, nominate the supervisory team, check eligibility, and record the Director's decision."
      />
      <div className="space-y-6 mt-4">
        {!supervisionCase && <OpenCaseForm onOpened={setSupervisionCase} />}
        {supervisionCase && (
          <SupervisionCaseWorkspace
            supervisionCase={supervisionCase}
            onRefresh={setSupervisionCase}
            onStartNew={() => setSupervisionCase(null)}
          />
        )}
        <CurrentSupervisionLookup />
      </div>
    </div>
  );
}

function OpenCaseForm({ onOpened }: { onOpened: (c: SupervisionCase) => void }) {
  const { user } = useAuth();
  const [enrolmentId, setEnrolmentId]   = useState('');
  const [researchArea, setResearchArea] = useState('');
  const [degreeAim, setDegreeAim]       = useState('');
  const [schoolOwner, setSchoolOwner]   = useState('');
  const [submitting, setSubmitting]     = useState(false);
  const [error, setError]               = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      const { supervisionCaseId } = await openSupervisionCase({
        enrolmentId: enrolmentId.trim(),
        ownerId:     user?.sub ?? '',
        ...(degreeAim.trim() ? { degreeAim: degreeAim.trim() } : {}),
        ...(researchArea.trim() ? { researchArea: researchArea.trim() } : {}),
        ...(schoolOwner.trim() ? { schoolOwner: schoolOwner.trim() } : {}),
      });
      onOpened(await getSupervisionCase(supervisionCaseId));
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to open supervision case');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="Open a supervision case" />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-2 gap-3 items-end">
          <LabelledField label="Enrolment ID" htmlFor="pgr-enrolment" required>
            <Input id="pgr-enrolment" value={enrolmentId} onChange={(e) => setEnrolmentId(e.target.value)} />
          </LabelledField>
          <LabelledField label="Degree aim" htmlFor="pgr-degree">
            <Input id="pgr-degree" value={degreeAim} onChange={(e) => setDegreeAim(e.target.value)} placeholder="PhD" />
          </LabelledField>
          <LabelledField label="Research area" htmlFor="pgr-area">
            <Input id="pgr-area" value={researchArea} onChange={(e) => setResearchArea(e.target.value)} />
          </LabelledField>
          <LabelledField label="School / department" htmlFor="pgr-school">
            <Input id="pgr-school" value={schoolOwner} onChange={(e) => setSchoolOwner(e.target.value)} />
          </LabelledField>
          <div className="col-span-2">
            <Button type="submit" disabled={submitting}>{submitting ? 'Opening…' : 'Open case'}</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function SupervisionCaseWorkspace({
  supervisionCase, onRefresh, onStartNew,
}: {
  supervisionCase: SupervisionCase;
  onRefresh:       (c: SupervisionCase) => void;
  onStartNew:      () => void;
}) {
  const { roles } = useAuth();
  const canDecide = userHasAnyPermission(roles, ['pgr-case:decide']);
  const [nominations, setNominations] = useState<SupervisorNomination[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [caseDetail, nominationList] = await Promise.all([
        getSupervisionCase(supervisionCase.supervisionCaseId),
        listNominations(supervisionCase.supervisionCaseId),
      ]);
      onRefresh(caseDetail);
      setNominations(nominationList);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load case');
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supervisionCase.supervisionCaseId]);

  useEffect(() => { void load(); }, [load]);

  const isDecided = supervisionCase.statusCode !== 'proposed';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={`Case ${supervisionCase.supervisionCaseId.slice(0, 8)}…`}
          actions={
            <div className="flex items-center gap-2">
              <Badge value={supervisionCase.statusCode} />
              <Button variant="ghost" size="sm" onClick={onStartNew}>Start a new case</Button>
            </div>
          }
        />
        <CardBody>
          {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <InfoRow label="Enrolment" value={supervisionCase.enrolmentId} mono />
            <InfoRow label="Degree aim" value={supervisionCase.degreeAim} />
            <InfoRow label="Research area" value={supervisionCase.researchArea} />
            <InfoRow label="School" value={supervisionCase.schoolOwner} />
          </dl>
        </CardBody>
      </Card>

      {!isDecided && <NominationForm caseId={supervisionCase.supervisionCaseId} onNominated={load} />}

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : (
        <Card>
          <CardHeader title="Nominated supervisors" />
          <CardBody>
            {nominations.length === 0 ? (
              <p className="text-sm text-neutral-600">No nominations yet.</p>
            ) : (
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Person</TableHeaderCell>
                    <TableHeaderCell>Role</TableHeaderCell>
                    <TableHeaderCell>Eligibility check</TableHeaderCell>
                    <TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {nominations.map((n) => (
                    <NominationRow key={n.nominationId} caseId={supervisionCase.supervisionCaseId} nomination={n} onChecked={load} />
                  ))}
                </TableBody>
              </Table>
            )}
          </CardBody>
        </Card>
      )}

      {!isDecided && canDecide && (
        <DecisionForm caseId={supervisionCase.supervisionCaseId} onDecided={load} />
      )}

      {supervisionCase.statusCode === 'approved' && (
        <PublishPanel caseId={supervisionCase.supervisionCaseId} enrolmentId={supervisionCase.enrolmentId} />
      )}
    </div>
  );
}

function NominationRow({
  caseId, nomination, onChecked,
}: {
  caseId:     string;
  nomination: SupervisorNomination;
  onChecked:  () => void;
}) {
  const [checking, setChecking] = useState(false);
  const [error, setError]       = useState('');

  async function handleCheck() {
    setChecking(true); setError('');
    try {
      await recordEligibilityCheck(caseId, nomination.nominationId);
      onChecked();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to record eligibility check');
    } finally { setChecking(false); }
  }

  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{nomination.personId}</TableCell>
      <TableCell><Badge value={nomination.roleDetailCode} /></TableCell>
      <TableCell className="text-xs">
        {nomination.eligibilityCheckedAt
          ? new Date(nomination.eligibilityCheckedAt).toLocaleString('en-GB')
          : <span className="text-neutral-500">Not checked</span>}
        {error && <p className="text-danger-600">{error}</p>}
      </TableCell>
      <TableCell className="text-right">
        {!nomination.eligibilityCheckedAt && (
          <Button size="sm" variant="secondary" disabled={checking} onClick={() => void handleCheck()}>
            {checking ? 'Checking…' : 'Record HR check'}
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

function NominationForm({ caseId, onNominated }: { caseId: string; onNominated: () => void }) {
  const [personId, setPersonId]           = useState('');
  const [roleDetailCode, setRoleDetailCode] = useState<PgrSupervisorRole>('principal');
  const [orgOwner, setOrgOwner]           = useState('');
  const [submitting, setSubmitting]       = useState(false);
  const [error, setError]                 = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      await nominateSupervisor(caseId, {
        personId: personId.trim(),
        roleDetailCode,
        ...(orgOwner.trim() ? { orgOwner: orgOwner.trim() } : {}),
      });
      setPersonId(''); setOrgOwner('');
      onNominated();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to nominate supervisor');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="Nominate a supervisor" />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-3 gap-3 items-end">
          <LabelledField label="Person ID" htmlFor="pgr-nom-person" required>
            <Input id="pgr-nom-person" value={personId} onChange={(e) => setPersonId(e.target.value)} />
          </LabelledField>
          <LabelledField label="Role" htmlFor="pgr-nom-role">
            <Select id="pgr-nom-role" value={roleDetailCode} onChange={(e) => setRoleDetailCode(e.target.value as PgrSupervisorRole)}>
              <option value="principal">Principal supervisor</option>
              <option value="additional">Additional supervisor</option>
              <option value="external">External supervisor</option>
            </Select>
          </LabelledField>
          <LabelledField label="School / department" htmlFor="pgr-nom-org">
            <Input id="pgr-nom-org" value={orgOwner} onChange={(e) => setOrgOwner(e.target.value)} />
          </LabelledField>
          <div className="col-span-3">
            <Button type="submit" size="sm" variant="secondary" disabled={submitting}>
              {submitting ? 'Nominating…' : 'Nominate'}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function DecisionForm({ caseId, onDecided }: { caseId: string; onDecided: () => void }) {
  const [decisionTypeCode, setDecisionTypeCode] = useState<'approve' | 'return' | 'reject'>('approve');
  const [reasonText, setReasonText]             = useState('');
  const [submitting, setSubmitting]             = useState(false);
  const [error, setError]                       = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      await recordDirectorDecision(caseId, {
        decisionTypeCode,
        ...(reasonText.trim() ? { reasonText: reasonText.trim() } : {}),
      });
      onDecided();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to record decision');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="Director decision" />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-2 gap-3 items-end">
          <LabelledField label="Decision" htmlFor="pgr-decision">
            <Select id="pgr-decision" value={decisionTypeCode} onChange={(e) => setDecisionTypeCode(e.target.value as typeof decisionTypeCode)}>
              <option value="approve">Approve</option>
              <option value="return">Return</option>
              <option value="reject">Reject</option>
            </Select>
          </LabelledField>
          <LabelledField label="Reason" htmlFor="pgr-reason" hint="Required for return/reject">
            <Input id="pgr-reason" value={reasonText} onChange={(e) => setReasonText(e.target.value)} />
          </LabelledField>
          <div className="col-span-2">
            <Button type="submit" disabled={submitting}>{submitting ? 'Recording…' : 'Record decision'}</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function PublishPanel({ caseId, enrolmentId }: { caseId: string; enrolmentId: string }) {
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished]   = useState(false);
  const [error, setError]           = useState('');

  async function handlePublish() {
    setPublishing(true); setError('');
    try {
      await publishSupervisionToCris(caseId);
      setPublished(true);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to publish to CRIS');
    } finally { setPublishing(false); }
  }

  return (
    <Card>
      <CardHeader title="Publish to CRIS" description={`Enrolment ${enrolmentId}`} />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        {published ? (
          <p className="text-sm text-success-700">Published to CRIS.</p>
        ) : (
          <Button onClick={() => void handlePublish()} disabled={publishing}>
            {publishing ? 'Publishing…' : 'Publish approved team'}
          </Button>
        )}
      </CardBody>
    </Card>
  );
}

function CurrentSupervisionLookup() {
  const [enrolmentId, setEnrolmentId] = useState('');
  const [assignments, setAssignments] = useState<StaffAssignment[] | null>(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');

  async function handleLookup(e: FormEvent) {
    e.preventDefault();
    setLoading(true); setError(''); setAssignments(null);
    try {
      setAssignments(await listCurrentSupervision(enrolmentId.trim()));
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to load supervision');
    } finally { setLoading(false); }
  }

  return (
    <Card>
      <CardHeader title="Look up current supervision" />
      <CardBody>
        <form onSubmit={(e) => void handleLookup(e)} className="flex items-end gap-3 mb-4">
          <LabelledField label="Enrolment ID" htmlFor="pgr-lookup-enrolment" required>
            <Input id="pgr-lookup-enrolment" value={enrolmentId} onChange={(e) => setEnrolmentId(e.target.value)} />
          </LabelledField>
          <Button type="submit" variant="secondary" disabled={loading}>{loading ? 'Looking up…' : 'Look up'}</Button>
        </form>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        {assignments && (
          assignments.length === 0 ? (
            <p className="text-sm text-neutral-600">No current supervisors for this enrolment.</p>
          ) : (
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Person</TableHeaderCell>
                  <TableHeaderCell>Role</TableHeaderCell>
                  <TableHeaderCell>Since</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {assignments.map((a) => (
                  <TableRow key={a.assignmentId}>
                    <TableCell className="font-mono text-xs">{a.personId}</TableCell>
                    <TableCell><Badge value={a.roleDetailCode} /></TableCell>
                    <TableCell className="text-xs">{new Date(a.validFrom).toLocaleDateString('en-GB')}</TableCell>
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
