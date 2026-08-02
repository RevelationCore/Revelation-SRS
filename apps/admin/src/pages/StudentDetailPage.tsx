import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  type Adjustment,
  type DisabilityDeclaration,
  type ExceptionalCircumstances,
  type IdentityPatch,
  type Student,
  type StudentNotification,
  type PersonStatusCode,
  getStudent,
  listAdjustments,
  listDisabilityDeclarations,
  listExceptionalCircumstances,
  updateStudentIdentity,
  updateHesaId,
  updatePersonStatus,
  listStudentNotifications,
} from '../api/students.js';
import {
  type CorrectionCase,
  type AmendableEntityType,
  listCorrectionCases,
  createCorrectionCase,
  updateCaseStatus,
  addCaseAmendment,
  distributeAmendment,
} from '../api/corrections.js';
import { getAuditLog, type AuditEntry } from '../api/auditLog.js';
import {
  type CreateEnrolmentInput,
  type Enrolment,
  type TransitionAction,
  type TransitionOptions,
  AVAILABLE_TRANSITIONS,
  createEnrolment,
  getEnrolmentHistory,
  listStudentEnrolments,
  transitionEnrolment,
} from '../api/enrolments.js';
import {
  type ModuleRegistration,
  type TimetableEntry,
  completeRegistration,
  getTimetable,
  listAllModuleRegistrations,
  listModuleRegistrations,
  withdrawRegistration,
} from '../api/registrations.js';
import {
  type Mark,
  type ModuleResult,
  type AssessmentComponent,
  listMarks,
  getModuleResult,
  listComponents,
} from '../api/marks.js';
import {
  type CasCase,
  listCasCases,
  openCasCase,
  recordEligibilityCheck,
  recordAssignmentVersion,
  recordSponsorReportVersion,
} from '../api/casCases.js';
import { ApiError } from '../api/client.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';
import { useValueSet } from '../hooks/useValueSet.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import {
  PageHeader, Card, CardHeader, CardBody, Button, Input, Select, Textarea, LabelledField,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, Dialog, DialogClose,
} from '@revelation-srs/ui';

type Tab = 'identity' | 'enrolments' | 'registrations' | 'assessment' | 'history' | 'wellbeing' | 'corrections' | 'cas' | 'communications';

export function StudentDetailPage() {
  const { roles } = useAuth();
  const { personId } = useParams<{ personId: string }>();
  const [student, setStudent]  = useState<Student | null>(null);
  const [loading, setLoading]  = useState(true);
  const [error, setError]      = useState('');
  const [tab, setTab]          = useState<Tab>('identity');

  const reload = useCallback(async () => {
    if (!personId) return;
    setLoading(true);
    setError('');
    try {
      setStudent(await getStudent(personId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load student');
    } finally {
      setLoading(false);
    }
  }, [personId]);

  useEffect(() => { void reload(); }, [reload]);

  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>;
  if (error)   return <p className="text-danger-600">{error}</p>;
  if (!student) return null;

  const displayName = student.identity
    ? `${student.identity.legalFirstName} ${student.identity.legalFamilyName}`
    : student.personId;
  const canReadEnrolments = userHasAnyPermission(roles, ['enrolment:read:all']);
  const canWriteStudent = userHasAnyPermission(roles, ['student:write']);
  const canReadRegistrations = userHasAnyPermission(roles, ['module-registration:read:all']);
  const canReadAssessment = userHasAnyPermission(roles, ['mark:read:all']);
  const canReadCorrections = userHasAnyPermission(roles, ['exam-board:read']);
  const canRatify = userHasAnyPermission(roles, ['exam-board:ratify']);
  const canReadCas = userHasAnyPermission(roles, ['regulatory:read']);
  const canWriteCas = userHasAnyPermission(roles, ['regulatory:write']);
  const canReadDisability = userHasAnyPermission(roles, ['disability:read']);
  const canReadAdjustments = userHasAnyPermission(roles, ['adjustment:read:all']);
  const canReadCircumstances = userHasAnyPermission(roles, ['circumstances:read']);
  const canReadNotifications = userHasAnyPermission(roles, ['notifications:read']);
  const tabs: Tab[] = [
    'identity',
    ...(canReadEnrolments ? ['enrolments', 'history'] as Tab[] : []),
    ...(canReadEnrolments && canReadCorrections ? ['corrections'] as Tab[] : []),
    ...(canReadEnrolments && canReadCas ? ['cas'] as Tab[] : []),
    ...(canReadRegistrations ? ['registrations'] as Tab[] : []),
    ...(canReadAssessment ? ['assessment'] as Tab[] : []),
    ...(canReadDisability || canReadAdjustments || canReadCircumstances ? ['wellbeing'] as Tab[] : []),
    ...(canReadNotifications ? ['communications'] as Tab[] : []),
  ];

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Students', to: '/students' }]}
        title={displayName}
        description={<span className="font-mono">{student.studentNumber}</span>}
        actions={<Badge value={student.personStatusCode} />}
      />

      {/* Tabs */}
      <div className="border-b border-neutral-200 mb-6">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`mr-6 pb-3 text-sm font-medium capitalize border-b-2 transition-colors ${
              tab === t
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-neutral-500 hover:text-neutral-700'
            }`}
          >
            {t === 'cas' ? 'CAS' : t}
          </button>
        ))}
      </div>

      {tab === 'identity' && (
        <IdentityTab student={student} onUpdated={reload} canWrite={canWriteStudent} />
      )}
      {tab === 'enrolments' && personId && (
        <EnrolmentsTab personId={personId} student={student} onUpdated={reload} />
      )}
      {tab === 'registrations' && personId && (
        <RegistrationsTab personId={personId} />
      )}
      {tab === 'assessment' && personId && (
        <AssessmentTab personId={personId} />
      )}
      {tab === 'history' && personId && (
        <HistoryTab personId={personId} />
      )}
      {tab === 'wellbeing' && personId && (
        <WellbeingTab personId={personId} canReadDisability={canReadDisability}
          canReadAdjustments={canReadAdjustments} canReadCircumstances={canReadCircumstances} />
      )}
      {tab === 'corrections' && personId && (
        <CorrectionsTab personId={personId} canRatify={canRatify} />
      )}
      {tab === 'cas' && personId && (
        <CasTab personId={personId} canWrite={canWriteCas} />
      )}
      {tab === 'communications' && personId && (
        <CommunicationsTab personId={personId} />
      )}
    </div>
  );
}

// ── Identity tab ──────────────────────────────────────────────────────────────

function IdentityTab({
  student,
  onUpdated,
  canWrite,
}: {
  student: Student;
  onUpdated: () => void;
  canWrite: boolean;
}) {
  const [editing, setEditing]     = useState(false);
  const [editHesa, setEditHesa]   = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const { members: nationalities } = useValueSet('person_identity', 'nationality_code');
  const id = student.identity;

  async function handleIdentitySave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const patch: IdentityPatch = {};
    const fields: Array<keyof IdentityPatch> = [
      'legalFirstName', 'legalFamilyName', 'preferredName',
      'emailInstitutional', 'emailPersonal', 'phoneMobile', 'dateOfBirth',
    ];
    for (const f of fields) {
      const v = String(fd.get(f) ?? '').trim();
      if (v) patch[f] = v;
    }
    setSaving(true); setError('');
    try {
      await updateStudentIdentity(student.personId, patch);
      setEditing(false);
      onUpdated();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Save failed');
    } finally { setSaving(false); }
  }

  async function handleHesaSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const hesaId = String(fd.get('hesaId') ?? '').trim();
    if (!hesaId) return;
    setSaving(true); setError('');
    try {
      await updateHesaId(student.personId, hesaId);
      setEditHesa(false);
      onUpdated();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Save failed');
    } finally { setSaving(false); }
  }

  async function handleStatusChange(statusCode: PersonStatusCode) {
    setSaving(true); setError('');
    try {
      await updatePersonStatus(student.personId, statusCode);
      onUpdated();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Save failed');
    } finally { setSaving(false); }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Identity card */}
      <Card>
        <CardHeader
          title="Personal identity"
          actions={canWrite && !editing && (
            <button onClick={() => setEditing(true)} className="text-xs text-primary-600 hover:underline">
              Edit
            </button>
          )}
        />
        <CardBody>
        {editing ? (
          <form onSubmit={(e) => void handleIdentitySave(e)} className="space-y-3">
            <IdentityField name="legalFirstName"    label="Legal first name"     defaultValue={id?.legalFirstName} />
            <IdentityField name="legalFamilyName"   label="Legal family name"    defaultValue={id?.legalFamilyName} />
            <IdentityField name="preferredName"     label="Preferred name"       defaultValue={id?.preferredName ?? ''} />
            <IdentityField name="dateOfBirth"       label="Date of birth"        defaultValue={id?.dateOfBirth ?? ''} type="date" />
            <IdentityField name="emailInstitutional" label="Institutional email" defaultValue={id?.emailInstitutional ?? ''} type="email" />
            <IdentityField name="emailPersonal"     label="Personal email"       defaultValue={id?.emailPersonal ?? ''} type="email" />
            <IdentityField name="phoneMobile"       label="Mobile phone"         defaultValue={id?.phoneMobile ?? ''} />
            {error && <p className="text-xs text-danger-600">{error}</p>}
            <div className="flex gap-2 pt-1">
              <Button type="submit" size="sm" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </form>
        ) : (
          <dl className="space-y-2 text-sm">
            <IdentityRow label="Legal name"   value={id ? `${id.legalFirstName} ${id.legalFamilyName}` : '—'} />
            <IdentityRow label="Preferred"    value={id?.preferredName} />
            <IdentityRow label="Date of birth" value={id?.dateOfBirth} />
            <IdentityRow
              label="Nationality"
              value={
                id?.nationalityCode
                  ? (nationalities.find(n => n.code === id.nationalityCode)?.displayLabel ?? id.nationalityCode)
                  : undefined
              }
            />
            <IdentityRow label="Email (inst.)" value={id?.emailInstitutional} />
            <IdentityRow label="Email (pers.)" value={id?.emailPersonal} />
            <IdentityRow label="Mobile"        value={id?.phoneMobile} />
            {id && (
              <p className="text-xs text-neutral-600 pt-1">
                Updated {new Date(id.recordedAt).toLocaleDateString()}
              </p>
            )}
          </dl>
        )}
        </CardBody>
      </Card>

      {/* Right column: HESA ID + status */}
      <div className="space-y-4">
        {/* HESA ID */}
        <Card>
          <CardHeader
            title="HESA identifier"
            actions={canWrite && !editHesa && (
              <button onClick={() => setEditHesa(true)} className="text-xs text-primary-600 hover:underline">
                {student.hesaId ? 'Update' : 'Add'}
              </button>
            )}
          />
          <CardBody>
          {editHesa ? (
            <form onSubmit={(e) => void handleHesaSave(e)} className="flex gap-2">
              <Input
                name="hesaId"
                defaultValue={student.hesaId ?? ''}
                className="flex-1 font-mono"
              />
              <Button type="submit" size="sm" disabled={saving}>Save</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditHesa(false)}>Cancel</Button>
            </form>
          ) : (
            <p className="text-sm font-mono text-neutral-900">{student.hesaId ?? <span className="text-neutral-600 font-sans">Not set</span>}</p>
          )}
          </CardBody>
        </Card>

        {/* Person status */}
        <Card>
          <CardHeader title="Lifecycle status" />
          <CardBody>
          <div className="flex items-center gap-3 flex-wrap">
            <Badge value={student.personStatusCode} />
            {canWrite && (['prospective','student','alumnus','deceased','merged'] as PersonStatusCode[]).map((s) => (
              s !== student.personStatusCode && (
                <button
                  key={s}
                  disabled={saving}
                  onClick={() => void handleStatusChange(s)}
                  className="text-xs text-neutral-500 hover:text-primary-600 hover:underline disabled:opacity-40"
                >
                  → {s}
                </button>
              )
            ))}
          </div>
          {error && <p className="mt-2 text-xs text-danger-600">{error}</p>}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function IdentityField({ name, label, defaultValue, type = 'text' }: {
  name: string; label: string; defaultValue?: string | null; type?: string;
}) {
  return (
    <LabelledField label={label} htmlFor={`id-${name}`}>
      <Input id={`id-${name}`} name={name} type={type} defaultValue={defaultValue ?? ''} />
    </LabelledField>
  );
}

function IdentityRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 flex-shrink-0 text-neutral-500">{label}</dt>
      <dd className="text-neutral-900">{value ?? <span className="text-neutral-600">—</span>}</dd>
    </div>
  );
}

// ── Enrolments tab ────────────────────────────────────────────────────────────

function EnrolmentsTab({
  personId,
  student,
  onUpdated,
}: {
  personId:  string;
  student:   Student;
  onUpdated: () => void;
}) {
  const [enrolments, setEnrolments] = useState<Enrolment[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [expanded, setExpanded]     = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setEnrolments(await listStudentEnrolments(personId));
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load enrolments');
    } finally { setLoading(false); }
  }, [personId]);

  useEffect(() => { void reload(); }, [reload]);

  function handleCreated() {
    setShowCreate(false);
    void reload();
    onUpdated(); // person status may change
  }

  function handleTransitioned() {
    void reload();
    onUpdated();
  }

  if (loading) return <div className="flex justify-center py-8"><Spinner /></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-neutral-700">Enrolments</h2>
        <Button size="sm" onClick={() => setShowCreate(true)}>New enrolment</Button>
      </div>

      {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}

      {enrolments.length === 0 ? (
        <p className="text-sm text-neutral-600">No enrolments on record.</p>
      ) : (
        <div className="space-y-3">
          {enrolments.map((e) => (
            <EnrolmentCard
              key={e.enrolmentId}
              enrolment={e}
              expanded={expanded === e.enrolmentId}
              onToggle={() => setExpanded(expanded === e.enrolmentId ? null : e.enrolmentId)}
              onTransitioned={handleTransitioned}
            />
          ))}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={(open) => { if (!open) setShowCreate(false); }} title="New enrolment">
        <CreateEnrolmentForm
          personId={personId}
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      </Dialog>
    </div>
  );
}

function EnrolmentCard({
  enrolment,
  expanded,
  onToggle,
  onTransitioned,
}: {
  enrolment:      Enrolment;
  expanded:       boolean;
  onToggle:       () => void;
  onTransitioned: () => void;
}) {
  const [transitioning, setTransitioning] = useState(false);
  const [showTransitionModal, setShowTransitionModal] = useState<TransitionAction | null>(null);
  const [timetable, setTimetable]          = useState<TimetableEntry[] | null>(null);
  const [registrations, setRegistrations]  = useState<ModuleRegistration[] | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [transitionError, setTransitionError] = useState('');

  const available = AVAILABLE_TRANSITIONS[enrolment.statusCode] ?? [];

  useEffect(() => {
    if (!expanded) return;
    setLoadingDetails(true);
    Promise.all([
      listModuleRegistrations(enrolment.enrolmentId),
      getTimetable(enrolment.enrolmentId),
    ])
      .then(([regs, tt]) => { setRegistrations(regs); setTimetable(tt); })
      .catch(() => { /* non-critical */ })
      .finally(() => setLoadingDetails(false));
  }, [expanded, enrolment.enrolmentId]);

  async function handleTransition(action: TransitionAction, opts?: TransitionOptions) {
    setTransitioning(true);
    setTransitionError('');
    try {
      await transitionEnrolment(enrolment.enrolmentId, action, opts);
      setShowTransitionModal(null);
      onTransitioned();
    } catch (e) {
      setTransitionError(e instanceof ApiError ? (e.detail ?? e.message) : 'Transition failed');
    } finally { setTransitioning(false); }
  }

  const TRANSITION_STYLES: Record<TransitionAction, string> = {
    intermit:  'bg-warning-50 text-warning-700 border-warning-200 hover:bg-warning-100',
    suspend:   'bg-warning-50 text-warning-700 border-warning-200 hover:bg-warning-100',
    withdraw:  'bg-danger-50    text-danger-700    border-danger-200    hover:bg-danger-100',
    graduate:  'bg-success-50  text-success-700  border-success-200  hover:bg-success-100',
    reinstate: 'bg-primary-50   text-primary-700   border-primary-200   hover:bg-primary-100',
  };

  return (
    <Card className="overflow-hidden">
      <div
        className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-neutral-50"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-neutral-900">
            {enrolment.academicYearOfEntry} · {enrolment.modeOfStudyCode}
          </p>
          <p className="text-xs text-neutral-500 mt-0.5 truncate">
            {enrolment.programmeName
              ? <>{enrolment.programmeCode && <span className="font-mono mr-1">{enrolment.programmeCode}</span>}{enrolment.programmeName}</>
              : <span className="text-neutral-600 italic">No programme assigned</span>
            }
          </p>
        </div>
        <Badge value={enrolment.statusCode} />
        {expanded
          ? <ChevronUp className="h-4 w-4 text-neutral-500" aria-hidden="true" />
          : <ChevronDown className="h-4 w-4 text-neutral-500" aria-hidden="true" />}
      </div>

      {expanded && (
        <div className="border-t border-neutral-100 px-4 py-4 space-y-4">
          {/* Details row */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <InfoRow label="Start date"     value={enrolment.startDate} />
            <InfoRow label="Expected end"   value={enrolment.expectedEndDate} />
            <InfoRow label="Funding source" value={enrolment.fundingSourceCode} />
            <InfoRow label="Fee band"       value={enrolment.feeBandCode} />
            {enrolment.actualEndDate && <InfoRow label="Actual end" value={enrolment.actualEndDate} />}
          </div>

          {/* Transition actions */}
          {available.length > 0 && (
            <div>
              <p className="text-xs text-neutral-500 mb-2">Actions</p>
              <div className="flex gap-2 flex-wrap">
                {available.map((action) => (
                  <button
                    key={action}
                    disabled={transitioning}
                    onClick={() => setShowTransitionModal(action)}
                    className={`px-3 py-1 text-xs font-medium rounded border capitalize disabled:opacity-40 ${TRANSITION_STYLES[action] ?? ''}`}
                  >
                    {action}
                  </button>
                ))}
              </div>
              {transitionError && <p className="mt-2 text-xs text-danger-600">{transitionError}</p>}
            </div>
          )}

          {/* Module registrations */}
          {loadingDetails ? (
            <div className="flex justify-center py-4"><Spinner size="sm" /></div>
          ) : timetable && timetable.length > 0 ? (
            <div>
              <p className="text-xs text-neutral-500 mb-2">Active registrations</p>
              <div className="divide-y divide-neutral-100 rounded border border-neutral-100 overflow-hidden">
                {timetable.map((t) => (
                  <div key={t.moduleRegistrationId} className="flex items-center gap-3 px-3 py-2 text-sm bg-neutral-50">
                    <span className="font-mono text-xs text-neutral-600 w-20 flex-shrink-0">{t.moduleCode}</span>
                    <span className="flex-1 text-neutral-900 truncate">{t.moduleTitle}</span>
                    <span className="text-xs text-neutral-600">{t.periodCode}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : registrations !== null && registrations.length === 0 ? (
            <p className="text-xs text-neutral-600">No active module registrations.</p>
          ) : null}
        </div>
      )}

      <Dialog
        open={showTransitionModal !== null}
        onOpenChange={(open) => { if (!open) setShowTransitionModal(null); }}
        title={showTransitionModal ? `${showTransitionModal} enrolment` : ''}
      >
        {showTransitionModal && (
          <TransitionForm
            action={showTransitionModal}
            onConfirm={(opts) => void handleTransition(showTransitionModal, opts)}
            saving={transitioning}
          />
        )}
      </Dialog>
    </Card>
  );
}

function TransitionForm({
  action,
  onConfirm,
  saving,
}: {
  action:    TransitionAction;
  onConfirm: (opts?: TransitionOptions) => void;
  saving:    boolean;
}) {
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const reasonCode = String(fd.get('reasonCode') ?? '').trim() || undefined;
    const reasonText = String(fd.get('reasonText') ?? '').trim() || undefined;
    onConfirm({ reasonCode, reasonText });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <LabelledField label="Reason code" htmlFor="tr-reason-code">
        <Input id="tr-reason-code" name="reasonCode" />
      </LabelledField>
      <LabelledField label="Reason" htmlFor="tr-reason-text" hint="Optional note">
        <Textarea id="tr-reason-text" name="reasonText" rows={2} />
      </LabelledField>
      <div className="flex justify-end gap-2 pt-1">
        <DialogClose asChild>
          <Button type="button" variant="ghost" size="sm">Cancel</Button>
        </DialogClose>
        <Button type="submit" size="sm" disabled={saving} className="capitalize">
          {saving ? 'Saving…' : action}
        </Button>
      </div>
    </form>
  );
}

function CreateEnrolmentForm({
  personId,
  onClose,
  onCreated,
}: {
  personId:  string;
  onClose:   () => void;
  onCreated: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const input: CreateEnrolmentInput = {
      personId,
      modeOfStudyCode:     String(fd.get('modeOfStudyCode') ?? '').trim(),
      academicYearOfEntry: String(fd.get('academicYearOfEntry') ?? '').trim(),
      startDate:           String(fd.get('startDate') ?? '').trim(),
    };
    const expectedEndDate  = String(fd.get('expectedEndDate') ?? '').trim();
    const fundingSourceCode = String(fd.get('fundingSourceCode') ?? '').trim();
    const feeBandCode       = String(fd.get('feeBandCode') ?? '').trim();
    if (expectedEndDate)  input.expectedEndDate   = expectedEndDate;
    if (fundingSourceCode) input.fundingSourceCode = fundingSourceCode;
    if (feeBandCode)       input.feeBandCode        = feeBandCode;

    if (!input.modeOfStudyCode || !input.academicYearOfEntry || !input.startDate) {
      setError('Mode of study, academic year, and start date are required.');
      return;
    }
    setSaving(true); setError('');
    try {
      await createEnrolment(input);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to create enrolment');
    } finally { setSaving(false); }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
      <EnrolField name="modeOfStudyCode"     label="Mode of study"     required placeholder="full-time" />
      <EnrolField name="academicYearOfEntry" label="Academic year"     required placeholder="2025-26" />
      <EnrolField name="startDate"           label="Start date"        required placeholder="2025-09-22" />
      <EnrolField name="expectedEndDate"     label="Expected end date" placeholder="2028-06-30" />
      <EnrolField name="fundingSourceCode"   label="Funding source"    placeholder="slc" />
      <EnrolField name="feeBandCode"         label="Fee band"          placeholder="home-undergraduate" />
      {error && <p className="text-xs text-danger-600">{error}</p>}
      <div className="flex justify-end gap-3 pt-2">
        <DialogClose asChild>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </DialogClose>
        <Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create'}</Button>
      </div>
    </form>
  );
}

function EnrolField({ name, label, placeholder, required }: { name: string; label: string; placeholder?: string; required?: boolean }) {
  return (
    <LabelledField label={label} htmlFor={`enrol-${name}`} required={required}>
      <Input id={`enrol-${name}`} name={name} placeholder={placeholder} />
    </LabelledField>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 flex-shrink-0 text-neutral-500 text-xs pt-0.5">{label}</dt>
      <dd className="text-neutral-900">{value ?? <span className="text-neutral-600">—</span>}</dd>
    </div>
  );
}

// ── Registrations tab ─────────────────────────────────────────────────────────

function RegistrationsTab({ personId }: { personId: string }) {
  const [enrolments,    setEnrolments]    = useState<Enrolment[]>([]);
  const [registrations, setRegistrations] = useState<ModuleRegistration[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState('');
  const [confirmId,     setConfirmId]     = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<'complete' | 'withdraw' | null>(null);
  const [acting,        setActing]        = useState(false);
  const [selectedEnrolmentId, setSelectedEnrolmentId] = useState('');

  const load = useCallback(async (enrolmentId: string) => {
    if (!enrolmentId) return;
    setLoading(true); setError('');
    try {
      setRegistrations(await listAllModuleRegistrations(enrolmentId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load registrations');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const enrols = await listStudentEnrolments(personId);
        setEnrolments(enrols);
        const first = enrols[0];
        if (first) {
          setSelectedEnrolmentId(first.enrolmentId);
          await load(first.enrolmentId);
        } else { setLoading(false); }
      } catch { setLoading(false); }
    })();
  }, [personId, load]);

  async function handleAction(regId: string, action: 'complete' | 'withdraw') {
    setActing(true); setError('');
    try {
      if (action === 'complete') await completeRegistration(regId);
      else                       await withdrawRegistration(regId);
      setConfirmId(null); setConfirmAction(null);
      await load(selectedEnrolmentId);
    } catch (e) {
      setError(e instanceof ApiError ? (e.detail ?? e.message) : 'Action failed');
    } finally { setActing(false); }
  }

  return (
    <div>
      {enrolments.length > 1 && (
        <div className="mb-4 flex items-center gap-3">
          <label className="text-sm text-neutral-500" htmlFor="reg-enrol-select">Enrolment:</label>
          <Select
            id="reg-enrol-select"
            value={selectedEnrolmentId}
            onChange={(e) => { setSelectedEnrolmentId(e.target.value); void load(e.target.value); }}
            className="w-auto"
          >
            {enrolments.map(e => (
              <option key={e.enrolmentId} value={e.enrolmentId}>
                {e.academicYearOfEntry} ({e.statusCode})
              </option>
            ))}
          </Select>
        </div>
      )}
      {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : registrations.length === 0 ? (
        <p className="text-sm text-neutral-600">No module registrations found.</p>
      ) : (
        <Card>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Module</TableHeaderCell>
                <TableHeaderCell>Period</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Registered</TableHeaderCell>
                <TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {registrations.map(r => (
                <TableRow key={r.moduleRegistrationId}>
                  <TableCell className="text-neutral-900">
                    <span className="font-mono text-xs text-neutral-500 mr-1">{r.moduleCode}</span>
                    {r.moduleTitle}
                  </TableCell>
                  <TableCell>{r.periodCode}</TableCell>
                  <TableCell><Badge value={r.statusCode} /></TableCell>
                  <TableCell className="text-xs">{r.registrationDate}</TableCell>
                  <TableCell className="text-right">
                    {r.statusCode === 'registered' && (
                      confirmId === r.moduleRegistrationId ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="text-xs text-neutral-600">
                            {confirmAction === 'complete' ? 'Mark complete?' : 'Withdraw?'}
                          </span>
                          <Button
                            size="sm"
                            disabled={acting}
                            className={confirmAction === 'complete' ? 'bg-success-600 hover:bg-success-700' : 'bg-danger-600 hover:bg-danger-700'}
                            onClick={() => void handleAction(r.moduleRegistrationId, confirmAction!)}
                          >
                            {acting ? 'Saving…' : 'Confirm'}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => { setConfirmId(null); setConfirmAction(null); }}>
                            Cancel
                          </Button>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            className="border-success-300 text-success-700 hover:bg-success-50"
                            onClick={() => { setConfirmId(r.moduleRegistrationId); setConfirmAction('complete'); }}
                          >
                            Complete
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="border-danger-300 text-danger-600 hover:bg-danger-50"
                            onClick={() => { setConfirmId(r.moduleRegistrationId); setConfirmAction('withdraw'); }}
                          >
                            Withdraw
                          </Button>
                        </span>
                      )
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

// ── Assessment tab ────────────────────────────────────────────────────────────

interface AssessmentRow {
  registration: ModuleRegistration;
  marks:        Mark[];
  components:   Map<string, AssessmentComponent>;
  result:       ModuleResult | null;
  error:        string;
}

function AssessmentTab({ personId }: { personId: string }) {
  const [enrolments,          setEnrolments]          = useState<Enrolment[]>([]);
  const [selectedEnrolmentId, setSelectedEnrolmentId] = useState('');
  const [rows,                setRows]                = useState<AssessmentRow[]>([]);
  const [loading,             setLoading]             = useState(true);
  const [error,               setError]               = useState('');

  const loadAll = useCallback(async (enrolmentId: string) => {
    if (!enrolmentId) return;
    setLoading(true); setError('');
    try {
      const regs = await listAllModuleRegistrations(enrolmentId);
      const loaded = await Promise.all(
        regs.map(async (reg) => {
          try {
            const [marks, result, comps] = await Promise.all([
              listMarks(reg.moduleRegistrationId),
              getModuleResult(reg.moduleRegistrationId).catch(() => null),
              listComponents(reg.moduleOfferingId).catch(() => [] as AssessmentComponent[]),
            ]);
            const components = new Map(comps.map(c => [c.assessmentComponentId, c]));
            return { registration: reg, marks, components, result, error: '' };
          } catch (e) {
            const msg = e instanceof ApiError ? (e.detail ?? e.message) : 'Failed to load marks';
            return { registration: reg, marks: [], components: new Map<string, AssessmentComponent>(), result: null, error: msg };
          }
        }),
      );
      setRows(loaded);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load registrations');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const enrols = await listStudentEnrolments(personId);
        setEnrolments(enrols);
        const first = enrols[0];
        if (first) {
          setSelectedEnrolmentId(first.enrolmentId);
          await loadAll(first.enrolmentId);
        } else { setLoading(false); }
      } catch { setLoading(false); }
    })();
  }, [personId, loadAll]);

  return (
    <div>
      {enrolments.length > 1 && (
        <div className="mb-4 flex items-center gap-3">
          <label className="text-sm text-neutral-500" htmlFor="assess-enrol-select">Enrolment:</label>
          <Select
            id="assess-enrol-select"
            value={selectedEnrolmentId}
            onChange={(e) => { setSelectedEnrolmentId(e.target.value); void loadAll(e.target.value); }}
            className="w-auto"
          >
            {enrolments.map(e => (
              <option key={e.enrolmentId} value={e.enrolmentId}>
                {e.academicYearOfEntry} ({e.statusCode})
              </option>
            ))}
          </Select>
        </div>
      )}
      {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-neutral-600">No module registrations found.</p>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => (
            <Card key={row.registration.moduleRegistrationId} className="overflow-hidden">
              <div className="flex items-center gap-4 px-4 py-3 bg-neutral-50 border-b border-neutral-100">
                <div className="flex-1 min-w-0">
                  <span className="font-mono text-xs text-neutral-500 mr-2">{row.registration.moduleCode}</span>
                  <span className="text-sm font-medium text-neutral-900">{row.registration.moduleTitle}</span>
                </div>
                <span className="text-xs text-neutral-600">{row.registration.periodCode}</span>
                <Badge value={row.registration.statusCode} />
                {row.result && <Badge value={row.result.resultCode} />}
                {row.result && (
                  <span className="text-sm font-semibold text-neutral-800">{row.result.aggregateMark}%</span>
                )}
                {row.result && (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                    row.result.locked
                      ? 'bg-success-100 text-success-700'
                      : 'bg-warning-100 text-warning-700'
                  }`}>
                    {row.result.locked ? 'Locked' : 'Provisional'}
                  </span>
                )}
              </div>
              <div className="px-4 py-3">
                {row.error ? (
                  <p className="text-xs text-danger-600">{row.error}</p>
                ) : row.marks.length === 0 ? (
                  <p className="text-xs text-neutral-600">No marks recorded.</p>
                ) : (
                  <Table>
                    <TableHead>
                      <tr>
                        <TableHeaderCell>Component</TableHeaderCell>
                        <TableHeaderCell>Attempt</TableHeaderCell>
                        <TableHeaderCell>Raw</TableHeaderCell>
                        <TableHeaderCell>Adjusted</TableHeaderCell>
                        <TableHeaderCell>Penalty</TableHeaderCell>
                      </tr>
                    </TableHead>
                    <TableBody>
                      {row.marks.map((m) => {
                        const comp = row.components.get(m.assessmentComponentId);
                        return (
                        <TableRow key={m.markId}>
                          <TableCell>
                            {comp ? comp.title : <span className="text-xs text-neutral-600 font-mono">{m.assessmentComponentId.slice(0, 8)}</span>}
                          </TableCell>
                          <TableCell>{m.attemptNumber}</TableCell>
                          <TableCell className="font-semibold text-neutral-900">{m.rawMark}</TableCell>
                          <TableCell>{m.adjustedMark ?? '—'}</TableCell>
                          <TableCell>
                            {m.penaltyApplied ? `${m.penaltyPercent ?? '?'}%` : '—'}
                          </TableCell>
                        </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── History tab ───────────────────────────────────────────────────────────────

function HistoryTab({ personId }: { personId: string }) {
  const [enrolments,      setEnrolments]      = useState<Enrolment[]>([]);
  const [history,         setHistory]         = useState<Enrolment[]>([]);
  const [selectedEnrolId, setSelectedEnrolId] = useState('');
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState('');

  const loadHistory = useCallback(async (enrolmentId: string) => {
    if (!enrolmentId) return;
    setLoading(true); setError('');
    try {
      setHistory(await getEnrolmentHistory(enrolmentId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load history');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const enrols = await listStudentEnrolments(personId);
        setEnrolments(enrols);
        const first = enrols[0];
        if (first) {
          setSelectedEnrolId(first.enrolmentId);
          await loadHistory(first.enrolmentId);
        } else { setLoading(false); }
      } catch { setLoading(false); }
    })();
  }, [personId, loadHistory]);

  return (
    <div>
      <p className="mb-4 text-xs text-neutral-500">
        Bitemporal history — all recorded versions of this enrolment.
      </p>
      {enrolments.length > 1 && (
        <div className="mb-4 flex items-center gap-3">
          <label className="text-sm text-neutral-500" htmlFor="hist-enrol-select">Enrolment:</label>
          <Select
            id="hist-enrol-select"
            value={selectedEnrolId}
            onChange={(e) => { setSelectedEnrolId(e.target.value); void loadHistory(e.target.value); }}
            className="w-auto"
          >
            {enrolments.map(e => (
              <option key={e.enrolmentId} value={e.enrolmentId}>
                {e.academicYearOfEntry} ({e.statusCode})
              </option>
            ))}
          </Select>
        </div>
      )}
      {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : history.length === 0 ? (
        <p className="text-sm text-neutral-600">No history records found.</p>
      ) : (
        <Card>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Valid from</TableHeaderCell>
                <TableHeaderCell>Recorded at</TableHeaderCell>
                <TableHeaderCell>Mode</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {history.map((h, i) => (
                <TableRow key={i}>
                  <TableCell><Badge value={h.statusCode} /></TableCell>
                  <TableCell className="text-xs font-mono">{h.validFrom}</TableCell>
                  <TableCell className="text-xs font-mono">{h.recordedAt}</TableCell>
                  <TableCell>{h.modeOfStudyCode}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

// Valid forward transitions — mirrors correction-service.ts ALLOWED_STATUS_TRANSITIONS
const CASE_FORWARD_TRANSITIONS: Record<string, string[]> = {
  'open':         ['under-review', 'not-upheld', 'withdrawn'],
  'under-review': ['upheld', 'not-upheld', 'withdrawn'],
  'upheld':       [],
  'not-upheld':   [],
  'withdrawn':    [],
};

// ── Corrections tab ───────────────────────────────────────────────────────────

function CorrectionsTab({ personId, canRatify }: { personId: string; canRatify: boolean }) {
  const { members: caseTypes }   = useValueSet('post_ratification_case', 'case_type_code');
  const { members: caseStatuses } = useValueSet('post_ratification_case', 'status_code');
  const { members: errorCategories } = useValueSet('post_ratification_case', 'error_category_code');
  const [enrolments,   setEnrolments]   = useState<Enrolment[]>([]);
  const [cases,        setCases]        = useState<CorrectionCase[]>([]);
  const [selectedEnrolId, setSelectedEnrolId] = useState('');
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [showCreate,   setShowCreate]   = useState(false);
  const [creating,     setCreating]     = useState(false);
  const [newCaseType,    setNewCaseType]    = useState<string>('');
  const [newCaseRef,     setNewCaseRef]     = useState<string>('');
  const [newErrorCategory, setNewErrorCategory] = useState<string>('');
  const [newEvidenceRef,   setNewEvidenceRef]   = useState<string>('');
  const [newAuthorisedBy,  setNewAuthorisedBy]  = useState<string>('');
  const [updatingId,     setUpdatingId]     = useState<string | null>(null);

  useEffect(() => {
    if (newCaseType === '' && caseTypes.length > 0) {
      setNewCaseType(caseTypes[0]!.code);
    }
  }, [caseTypes, newCaseType]);

  const loadCases = useCallback(async (enrolmentId: string) => {
    if (!enrolmentId) return;
    setLoading(true); setError('');
    try {
      setCases(await listCorrectionCases(enrolmentId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load cases');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const enrols = await listStudentEnrolments(personId);
        setEnrolments(enrols);
        const first = enrols[0];
        if (first) {
          setSelectedEnrolId(first.enrolmentId);
          await loadCases(first.enrolmentId);
        } else { setLoading(false); }
      } catch { setLoading(false); }
    })();
  }, [personId, loadCases]);

  async function handleCreateCase(e: FormEvent) {
    e.preventDefault();
    if (!selectedEnrolId) return;
    setCreating(true); setError('');
    try {
      await createCorrectionCase(selectedEnrolId, newCaseType, newCaseRef.trim() || undefined, {
        ...(newErrorCategory ? { errorCategoryCode: newErrorCategory } : {}),
        ...(newEvidenceRef.trim() ? { evidenceRef: newEvidenceRef.trim() } : {}),
        ...(newAuthorisedBy.trim() ? { authorisedBy: newAuthorisedBy.trim() } : {}),
      });
      setShowCreate(false);
      setNewCaseRef('');
      setNewErrorCategory('');
      setNewEvidenceRef('');
      setNewAuthorisedBy('');
      await loadCases(selectedEnrolId);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to create case');
    } finally { setCreating(false); }
  }

  async function handleStatusChange(caseId: string, statusCode: string) {
    setUpdatingId(caseId); setError('');
    try {
      await updateCaseStatus(caseId, statusCode);
      await loadCases(selectedEnrolId);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 422 || err.status === 400)) {
        setError('This status transition is not permitted.');
      } else {
        setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Update failed');
      }
    } finally { setUpdatingId(null); }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-neutral-700">Correction &amp; appeal cases</h2>
        <Button size="sm" onClick={() => setShowCreate(s => !s)}>New case</Button>
      </div>

      {showCreate && (
        <Card className="mb-4 border-primary-200 bg-primary-50">
          <CardBody>
          <form onSubmit={(e) => void handleCreateCase(e)} className="space-y-3">
            <LabelledField label="Type" htmlFor="cc-type">
              <Select id="cc-type" value={newCaseType} onChange={(e) => setNewCaseType(e.target.value)}>
                {caseTypes.map(({ code, displayLabel }) => <option key={code} value={code}>{displayLabel}</option>)}
              </Select>
            </LabelledField>
            <LabelledField label="Description" htmlFor="cc-desc">
              <Textarea
                id="cc-desc"
                value={newCaseRef}
                onChange={(e) => setNewCaseRef(e.target.value)}
                rows={3}
                placeholder="Brief description of the issue…"
              />
            </LabelledField>
            <LabelledField label="Error category" htmlFor="cc-error-category" hint="Optional — category of error this correction addresses">
              <Select id="cc-error-category" value={newErrorCategory} onChange={(e) => setNewErrorCategory(e.target.value)}>
                <option value="">Not specified</option>
                {errorCategories.map(({ code, displayLabel }) => <option key={code} value={code}>{displayLabel}</option>)}
              </Select>
            </LabelledField>
            <LabelledField label="Evidence reference" htmlFor="cc-evidence-ref" hint="Optional — evidence record ID supporting this case">
              <Input id="cc-evidence-ref" value={newEvidenceRef} onChange={(e) => setNewEvidenceRef(e.target.value)} />
            </LabelledField>
            <LabelledField label="Authorised by" htmlFor="cc-authorised-by" hint="Optional — actor who authorised opening this case, if different from the submitter">
              <Input id="cc-authorised-by" value={newAuthorisedBy} onChange={(e) => setNewAuthorisedBy(e.target.value)} />
            </LabelledField>
            <div className="flex gap-2 justify-end">
              <Button type="submit" disabled={creating}>{creating ? 'Creating…' : 'Create'}</Button>
              <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
          </form>
          </CardBody>
        </Card>
      )}

      {enrolments.length > 1 && (
        <div className="mb-4 flex items-center gap-3">
          <label className="text-sm text-neutral-500" htmlFor="cc-enrol-select">Enrolment:</label>
          <Select
            id="cc-enrol-select"
            value={selectedEnrolId}
            onChange={(e) => { setSelectedEnrolId(e.target.value); void loadCases(e.target.value); }}
            className="w-auto"
          >
            {enrolments.map(e => (
              <option key={e.enrolmentId} value={e.enrolmentId}>
                {e.academicYearOfEntry} ({e.statusCode})
              </option>
            ))}
          </Select>
        </div>
      )}

      {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : cases.length === 0 ? (
        <p className="text-sm text-neutral-600">No correction or appeal cases on record.</p>
      ) : (
        <div className="space-y-3">
          {cases.map(c => (
            <Card key={c.caseId}>
              <CardBody>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-neutral-900">{caseTypes.find(s => s.code === c.caseTypeCode)?.displayLabel ?? c.caseTypeCode}</p>
                  <p className="text-xs text-neutral-500 font-mono mt-0.5">{c.reference}</p>
                  {c.errorCategoryCode && (
                    <p className="text-xs text-neutral-500 mt-1">
                      Error category: {errorCategories.find(s => s.code === c.errorCategoryCode)?.displayLabel ?? c.errorCategoryCode}
                    </p>
                  )}
                  {c.evidenceRef && (
                    <p className="text-xs text-neutral-500 font-mono mt-0.5">Evidence: {c.evidenceRef}</p>
                  )}
                  {c.authorisedBy && (
                    <p className="text-xs text-neutral-500 mt-0.5">Authorised by: {c.authorisedBy}</p>
                  )}
                </div>
                <Badge value={c.statusCode} label={caseStatuses.find(s => s.code === c.statusCode)?.displayLabel} />
              </div>
              {(() => {
                const validTargets = CASE_FORWARD_TRANSITIONS[c.statusCode] ?? [];
                const targetButtons = caseStatuses.filter(({ code }) => validTargets.includes(code));
                if (targetButtons.length === 0) return null;
                return (
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-neutral-500">Move to:</span>
                    {targetButtons.map(({ code, displayLabel }) => (
                      <Button
                        key={code}
                        variant="secondary"
                        size="sm"
                        disabled={updatingId === c.caseId}
                        onClick={() => void handleStatusChange(c.caseId, code)}
                      >
                        {displayLabel}
                      </Button>
                    ))}
                  </div>
                );
              })()}
              {canRatify && c.statusCode === 'upheld' && (
                <AmendmentSection caseId={c.caseId} />
              )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {selectedEnrolId && (
        <VleOverrideAuditSection enrolmentId={selectedEnrolId} />
      )}
    </div>
  );
}

const AMENDABLE_ENTITY_TYPES: AmendableEntityType[] = ['mark', 'module_result', 'progression_decision'];

// Post-ratification amendment + downstream distribution (BPR-D13). Only
// reachable once a case is upheld — applyAmendment/distribute both require
// exam-board:ratify, mirroring the backend's permission gate.
function AmendmentSection({ caseId }: { caseId: string }) {
  const [open, setOpen]           = useState(false);
  const [entityType, setEntityType] = useState<AmendableEntityType>('mark');
  const [entityId, setEntityId]   = useState('');
  const [afterValueJson, setAfterValueJson] = useState('{}');
  const [applying, setApplying]   = useState(false);
  const [error, setError]         = useState('');
  const [amendmentId, setAmendmentId] = useState<string | null>(null);

  const [targetSystemCodes, setTargetSystemCodes] = useState('');
  const [distributing, setDistributing] = useState(false);
  const [distributedIds, setDistributedIds] = useState<string[] | null>(null);

  async function handleApply(e: FormEvent) {
    e.preventDefault();
    let afterValue: Record<string, unknown>;
    try {
      afterValue = JSON.parse(afterValueJson) as Record<string, unknown>;
    } catch {
      setError('After-value must be valid JSON.');
      return;
    }
    if (!entityId.trim()) {
      setError('Entity ID is required.');
      return;
    }
    setApplying(true); setError('');
    try {
      const { amendmentId: id } = await addCaseAmendment(caseId, { entityType, entityId: entityId.trim(), afterValue });
      setAmendmentId(id);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to apply amendment');
    } finally { setApplying(false); }
  }

  async function handleDistribute(e: FormEvent) {
    e.preventDefault();
    const codes = targetSystemCodes.split(',').map(s => s.trim()).filter(Boolean);
    if (codes.length === 0 || !amendmentId) return;
    setDistributing(true); setError('');
    try {
      const { distributionItemIds } = await distributeAmendment(amendmentId, codes);
      setDistributedIds(distributionItemIds);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to distribute amendment');
    } finally { setDistributing(false); }
  }

  if (!open) {
    return (
      <div className="mt-3">
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Apply amendment</Button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-3 space-y-3">
      {!amendmentId ? (
        <form onSubmit={(e) => void handleApply(e)} className="space-y-2">
          <p className="text-xs font-semibold text-neutral-700">Apply post-ratification amendment</p>
          <LabelledField label="Entity type" htmlFor="am-entity-type">
            <Select id="am-entity-type" value={entityType} onChange={(e) => setEntityType(e.target.value as AmendableEntityType)}>
              {AMENDABLE_ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </Select>
          </LabelledField>
          <LabelledField label="Entity ID" htmlFor="am-entity-id">
            <Input id="am-entity-id" value={entityId} onChange={(e) => setEntityId(e.target.value)} className="font-mono" />
          </LabelledField>
          <LabelledField label="After value" htmlFor="am-after-value">
            <Textarea
              id="am-after-value"
              value={afterValueJson}
              onChange={(e) => setAfterValueJson(e.target.value)}
              rows={3}
              className="font-mono"
              placeholder='{"rawMark": 62}'
            />
          </LabelledField>
          {error && <p className="text-xs text-danger-600">{error}</p>}
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" size="sm" disabled={applying}>{applying ? 'Applying…' : 'Apply amendment'}</Button>
          </div>
        </form>
      ) : distributedIds ? (
        <p className="text-xs text-success-700">
          Distributed to {distributedIds.length} downstream {distributedIds.length === 1 ? 'system' : 'systems'}.
        </p>
      ) : (
        <form onSubmit={(e) => void handleDistribute(e)} className="space-y-2">
          <p className="text-xs font-semibold text-neutral-700">
            Amendment applied. Distribute to downstream systems:
          </p>
          <Input
            value={targetSystemCodes}
            onChange={(e) => setTargetSystemCodes(e.target.value)}
            placeholder="hesa, slc, ucas"
          />
          {error && <p className="text-xs text-danger-600">{error}</p>}
          <div className="flex gap-2 justify-end">
            <Button type="submit" size="sm" disabled={distributing}>{distributing ? 'Distributing…' : 'Distribute'}</Button>
          </div>
        </form>
      )}
    </div>
  );
}

// ── CAS tab ────────────────────────────────────────────────────────────────────
// cas_case is a separate governed aggregate from ukvi_cas_request (see
// UkviPage's CAS tab), adding an eligibility-check/assignment-version/
// sponsor-report-version evidence trail per enrolment.

function CasTab({ personId, canWrite }: { personId: string; canWrite: boolean }) {
  const [enrolments,     setEnrolments]     = useState<Enrolment[]>([]);
  const [cases,          setCases]          = useState<CasCase[]>([]);
  const [selectedEnrolId, setSelectedEnrolId] = useState('');
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState('');
  const [showCreate,     setShowCreate]     = useState(false);
  const [creating,       setCreating]       = useState(false);
  const [newCasReference, setNewCasReference] = useState('');

  const loadCases = useCallback(async (enrolmentId: string) => {
    if (!enrolmentId) return;
    setLoading(true); setError('');
    try {
      setCases(await listCasCases(enrolmentId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load CAS cases');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const enrols = await listStudentEnrolments(personId);
        setEnrolments(enrols);
        const first = enrols[0];
        if (first) {
          setSelectedEnrolId(first.enrolmentId);
          await loadCases(first.enrolmentId);
        } else { setLoading(false); }
      } catch { setLoading(false); }
    })();
  }, [personId, loadCases]);

  async function handleOpenCase(e: FormEvent) {
    e.preventDefault();
    if (!selectedEnrolId) return;
    setCreating(true); setError('');
    try {
      await openCasCase(selectedEnrolId, newCasReference.trim() || undefined);
      setShowCreate(false);
      setNewCasReference('');
      await loadCases(selectedEnrolId);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to open CAS case');
    } finally { setCreating(false); }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-neutral-700">CAS cases</h2>
        {canWrite && <Button size="sm" onClick={() => setShowCreate(s => !s)}>New CAS case</Button>}
      </div>

      {showCreate && (
        <Card className="mb-4 border-primary-200 bg-primary-50">
          <CardBody>
            <form onSubmit={(e) => void handleOpenCase(e)} className="space-y-3">
              <LabelledField label="CAS reference" htmlFor="cas-ref" hint="Optional — leave blank if not yet assigned">
                <Input id="cas-ref" value={newCasReference} onChange={(e) => setNewCasReference(e.target.value)} />
              </LabelledField>
              <div className="flex gap-2 justify-end">
                <Button type="submit" disabled={creating}>{creating ? 'Opening…' : 'Open case'}</Button>
                <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {enrolments.length > 1 && (
        <div className="mb-4 flex items-center gap-3">
          <label className="text-sm text-neutral-500" htmlFor="cas-enrol-select">Enrolment:</label>
          <Select
            id="cas-enrol-select"
            value={selectedEnrolId}
            onChange={(e) => { setSelectedEnrolId(e.target.value); void loadCases(e.target.value); }}
            className="w-auto"
          >
            {enrolments.map(e => (
              <option key={e.enrolmentId} value={e.enrolmentId}>
                {e.academicYearOfEntry} ({e.statusCode})
              </option>
            ))}
          </Select>
        </div>
      )}

      {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : cases.length === 0 ? (
        <p className="text-sm text-neutral-600">No CAS cases on record for this enrolment.</p>
      ) : (
        <div className="space-y-3">
          {cases.map(c => (
            <Card key={c.casCaseId}>
              <CardBody>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-neutral-900">
                      {c.casReference ?? <span className="text-neutral-400">No reference yet</span>}
                    </p>
                    <p className="text-xs text-neutral-500 font-mono mt-0.5">{c.casCaseId}</p>
                  </div>
                  <Badge value={c.statusCode} />
                </div>
                {canWrite && c.statusCode !== 'assigned' && (
                  <CasCaseActions casCaseId={c.casCaseId} onChanged={() => void loadCases(selectedEnrolId)} />
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// Sequential eligibility-check → assignment-version → sponsor-report-version
// actions for a single CAS case, mirroring the service's own status
// progression (opened → eligibility-checked → assigned).
function CasCaseActions({ casCaseId, onChanged }: { casCaseId: string; onChanged: () => void }) {
  const [step, setStep] = useState<'eligibility' | 'assignment' | 'report' | 'done'>('eligibility');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [guidanceVersion, setGuidanceVersion] = useState('');
  const [checkTypeCode, setCheckTypeCode]     = useState('');
  const [resultCode, setResultCode]           = useState('');

  const [assignedPayloadHash, setAssignedPayloadHash] = useState('');
  const [casNumber, setCasNumber]                     = useState('');

  const [reportPayloadRef, setReportPayloadRef] = useState('');

  async function handleEligibility(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      await recordEligibilityCheck(casCaseId, { guidanceVersion, checkTypeCode, resultCode });
      setStep('assignment');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to record eligibility check');
    } finally { setSubmitting(false); }
  }

  async function handleAssignment(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      await recordAssignmentVersion(casCaseId, {
        assignedPayloadHash,
        ...(casNumber.trim() ? { casNumber: casNumber.trim() } : {}),
      });
      setStep('report');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to record assignment version');
    } finally { setSubmitting(false); }
  }

  async function handleReport(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      await recordSponsorReportVersion(casCaseId, { reportPayloadRef });
      setStep('done');
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to record sponsor report version');
    } finally { setSubmitting(false); }
  }

  if (step === 'done') {
    return <p className="mt-3 text-xs text-success-700">Sponsor report version recorded.</p>;
  }

  return (
    <div className="mt-3 border-t border-neutral-100 pt-3">
      {error && <p className="mb-2 text-xs text-danger-600">{error}</p>}
      {step === 'eligibility' && (
        <form onSubmit={(e) => void handleEligibility(e)} className="grid grid-cols-3 gap-2 items-end">
          <LabelledField label="Guidance version" htmlFor={`cas-guidance-${casCaseId}`} required>
            <Input id={`cas-guidance-${casCaseId}`} value={guidanceVersion} onChange={(e) => setGuidanceVersion(e.target.value)} />
          </LabelledField>
          <LabelledField label="Check type" htmlFor={`cas-checktype-${casCaseId}`} required>
            <Input id={`cas-checktype-${casCaseId}`} value={checkTypeCode} onChange={(e) => setCheckTypeCode(e.target.value)} placeholder="right-to-study" />
          </LabelledField>
          <LabelledField label="Result" htmlFor={`cas-result-${casCaseId}`} required>
            <Input id={`cas-result-${casCaseId}`} value={resultCode} onChange={(e) => setResultCode(e.target.value)} placeholder="pass" />
          </LabelledField>
          <div className="col-span-3">
            <Button type="submit" size="sm" variant="secondary" disabled={submitting}>
              {submitting ? 'Recording…' : 'Record eligibility check'}
            </Button>
          </div>
        </form>
      )}
      {step === 'assignment' && (
        <form onSubmit={(e) => void handleAssignment(e)} className="grid grid-cols-2 gap-2 items-end">
          <LabelledField label="Assigned payload hash" htmlFor={`cas-hash-${casCaseId}`} required>
            <Input id={`cas-hash-${casCaseId}`} value={assignedPayloadHash} onChange={(e) => setAssignedPayloadHash(e.target.value)} />
          </LabelledField>
          <LabelledField label="CAS number" htmlFor={`cas-number-${casCaseId}`} hint="Optional">
            <Input id={`cas-number-${casCaseId}`} value={casNumber} onChange={(e) => setCasNumber(e.target.value)} />
          </LabelledField>
          <div className="col-span-2">
            <Button type="submit" size="sm" variant="secondary" disabled={submitting}>
              {submitting ? 'Recording…' : 'Record assignment version'}
            </Button>
          </div>
        </form>
      )}
      {step === 'report' && (
        <form onSubmit={(e) => void handleReport(e)} className="grid grid-cols-1 gap-2 items-end">
          <LabelledField label="Sponsor report payload reference" htmlFor={`cas-report-${casCaseId}`} required>
            <Input id={`cas-report-${casCaseId}`} value={reportPayloadRef} onChange={(e) => setReportPayloadRef(e.target.value)} />
          </LabelledField>
          <div>
            <Button type="submit" size="sm" variant="secondary" disabled={submitting}>
              {submitting ? 'Recording…' : 'Record sponsor report version'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

// ── Communications tab ────────────────────────────────────────────────────────

function CommunicationsTab({ personId }: { personId: string }) {
  const [notifications, setNotifications] = useState<StudentNotification[]>([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState('');

  useEffect(() => {
    setLoading(true);
    listStudentNotifications(personId)
      .then(rows => { setNotifications(rows); setError(''); })
      .catch(e => setError(e instanceof ApiError ? e.message : 'Failed to load communications'))
      .finally(() => setLoading(false));
  }, [personId]);

  if (loading) return <div className="flex justify-center py-8"><Spinner /></div>;

  return (
    <div>
      <h2 className="text-sm font-semibold text-neutral-700 mb-4">Communications</h2>
      {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
      {notifications.length === 0 ? (
        <p className="text-sm text-neutral-600">No communications on record for this student.</p>
      ) : (
        <div className="space-y-3">
          {notifications.map((n) => (
            <Card key={n.id}>
              <CardBody className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-neutral-900">{n.title}</p>
                  <p className="text-sm text-neutral-600 mt-0.5">{n.body}</p>
                  {n.linkUrl && (
                    <a href={n.linkUrl} className="text-xs text-primary-600 hover:underline mt-1 inline-block">
                      {n.linkUrl}
                    </a>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-neutral-100 text-neutral-600">
                    {n.category}
                  </span>
                  <p className="text-xs text-neutral-600 mt-1">
                    {new Date(n.createdAt).toLocaleString('en-GB')}
                  </p>
                  {n.readAt && (
                    <p className="text-xs text-success-600 mt-0.5">
                      Read {new Date(n.readAt).toLocaleString('en-GB')}
                    </p>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── VLE enrolment override audit trail (R-VLE-002) ───────────────────────────

function VleOverrideAuditSection({ enrolmentId }: { enrolmentId: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getAuditLog('enrolment', enrolmentId)
      .then(all => setEntries(all.filter(e =>
        e.actorId.includes('vle') || e.actorType === 'integration-service' ||
        (e.changes as { sourceSystem?: string } | null)?.sourceSystem === 'vle',
      )))
      .catch(() => { /* non-critical — audit trail may not be available */ })
      .finally(() => setLoading(false));
  }, [enrolmentId]);

  if (loading || entries.length === 0) return null;

  return (
    <div className="mt-6">
      <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-3">
        VLE enrolment override history (R-VLE-002)
      </h3>
      <Card className="overflow-hidden">
        <Table className="text-xs">
          <TableHead>
            <tr>
              <TableHeaderCell>When</TableHeaderCell>
              <TableHeaderCell>Event</TableHeaderCell>
              <TableHeaderCell>Actor</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {entries.map(e => (
              <TableRow key={e.id}>
                <TableCell className="whitespace-nowrap font-mono">
                  {new Date(e.recordedAt).toLocaleString('en-GB')}
                </TableCell>
                <TableCell>{e.eventType}</TableCell>
                <TableCell className="font-mono">{e.actorId}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

// ── Wellbeing tab ─────────────────────────────────────────────────────────────

function WellbeingTab({
  personId,
  canReadDisability,
  canReadAdjustments,
  canReadCircumstances,
}: {
  personId: string;
  canReadDisability: boolean;
  canReadAdjustments: boolean;
  canReadCircumstances: boolean;
}) {
  const [declarations, setDeclarations] = useState<DisabilityDeclaration[] | null>(null);
  const [adjustments,  setAdjustments]  = useState<Adjustment[] | null>(null);
  const [ecs,          setEcs]          = useState<ExceptionalCircumstances[] | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');

  const { members: disabilityCategories } = useValueSet('disability_declaration', 'disability_category_code');
  const { members: declarationStatuses }  = useValueSet('disability_declaration', 'declaration_status_code');
  const { members: adjustmentTypes }      = useValueSet('reasonable_adjustment',  'adjustment_type_code');
  const { members: adjustmentScopes }     = useValueSet('reasonable_adjustment',  'scope_code');
  const { members: ecOutcomes }           = useValueSet('exceptional_circumstances', 'outcome_code');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      canReadDisability ? listDisabilityDeclarations(personId) : Promise.resolve([]),
      canReadAdjustments ? listAdjustments(personId) : Promise.resolve([]),
      canReadCircumstances ? listExceptionalCircumstances(personId) : Promise.resolve([]),
    ])
      .then(([d, a, e]) => { setDeclarations(d); setAdjustments(a); setEcs(e); })
      .catch(err => setError(err instanceof ApiError ? err.message : 'Failed to load wellbeing data'))
      .finally(() => setLoading(false));
  }, [canReadAdjustments, canReadCircumstances, canReadDisability, personId]);

  if (loading) return <div className="flex justify-center py-10"><Spinner /></div>;
  if (error)   return <p className="text-danger-600 text-sm">{error}</p>;

  const label = (members: { code: string; displayLabel: string }[], code: string) =>
    members.find(m => m.code === code)?.displayLabel ?? code;

  return (
    <div className="space-y-8">

      {/* Disability declarations */}
      <section>
        <h2 className="text-sm font-semibold text-neutral-700 uppercase tracking-wide mb-3">Disability Declarations</h2>
        {declarations?.length === 0 ? (
          <p className="text-sm text-neutral-600">No disability declarations on record.</p>
        ) : (
          <Card>
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Category</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Declared</TableHeaderCell>
                  <TableHeaderCell>Notes</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {declarations?.map(d => (
                  <TableRow key={d.declarationId}>
                    <TableCell className="text-neutral-800">{label(disabilityCategories, d.disabilityCategoryCode)}</TableCell>
                    <TableCell><Badge value={d.declarationStatusCode} label={label(declarationStatuses, d.declarationStatusCode)} /></TableCell>
                    <TableCell>{new Date(d.declaredAt).toLocaleDateString('en-GB')}</TableCell>
                    <TableCell className="text-neutral-500">{d.notes ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>

      {/* Reasonable adjustments */}
      <section>
        <h2 className="text-sm font-semibold text-neutral-700 uppercase tracking-wide mb-3">Reasonable Adjustments</h2>
        {adjustments?.length === 0 ? (
          <p className="text-sm text-neutral-600">No reasonable adjustments on record.</p>
        ) : (
          <Card>
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Type</TableHeaderCell>
                  <TableHeaderCell>Scope</TableHeaderCell>
                  <TableHeaderCell>Valid From</TableHeaderCell>
                  <TableHeaderCell>Valid To</TableHeaderCell>
                  <TableHeaderCell>Notes</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {adjustments?.filter(a => a.recordedUntil === null).map(a => (
                  <TableRow key={a.adjustmentId}>
                    <TableCell className="text-neutral-800">{label(adjustmentTypes, a.adjustmentTypeCode)}</TableCell>
                    <TableCell>{label(adjustmentScopes, a.scopeCode)}</TableCell>
                    <TableCell>{new Date(a.validFrom).toLocaleDateString('en-GB')}</TableCell>
                    <TableCell>{a.validTo ? new Date(a.validTo).toLocaleDateString('en-GB') : 'Open-ended'}</TableCell>
                    <TableCell className="text-neutral-500">{a.notes ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>

      {/* Exceptional circumstances */}
      <section>
        <h2 className="text-sm font-semibold text-neutral-700 uppercase tracking-wide mb-3">Exceptional Circumstances</h2>
        {ecs?.length === 0 ? (
          <p className="text-sm text-neutral-600">No exceptional circumstances on record.</p>
        ) : (
          <Card>
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Module</TableHeaderCell>
                  <TableHeaderCell>Outcome</TableHeaderCell>
                  <TableHeaderCell>Determination Date</TableHeaderCell>
                  <TableHeaderCell>Notes</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {ecs?.filter(e => e.recordedUntil === null).map(e => (
                  <TableRow key={e.exceptionalCircumstancesId}>
                    <TableCell className="text-neutral-800">
                      {e.moduleCode
                        ? <><span className="font-mono text-xs text-neutral-500 mr-1">{e.moduleCode}</span>{e.moduleTitle}</>
                        : <span className="text-neutral-600">—</span>}
                    </TableCell>
                    <TableCell><Badge value={e.outcomeCode} label={label(ecOutcomes, e.outcomeCode)} /></TableCell>
                    <TableCell>{new Date(e.determinationDate).toLocaleDateString('en-GB')}</TableCell>
                    <TableCell className="text-neutral-500">{e.notes ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>

    </div>
  );
}
