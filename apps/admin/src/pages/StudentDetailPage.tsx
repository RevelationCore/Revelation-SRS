import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
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
  listCorrectionCases,
  createCorrectionCase,
  updateCaseStatus,
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
import { ApiError } from '../api/client.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';
import { useValueSet } from '../hooks/useValueSet.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';

type Tab = 'identity' | 'enrolments' | 'registrations' | 'assessment' | 'history' | 'wellbeing' | 'corrections' | 'communications';

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
  if (error)   return <p className="text-red-600">{error}</p>;
  if (!student) return null;

  const displayName = student.identity
    ? `${student.identity.legalFirstName} ${student.identity.legalFamilyName}`
    : student.personId;
  const canReadEnrolments = userHasAnyPermission(roles, ['enrolment:read:all']);
  const canWriteStudent = userHasAnyPermission(roles, ['student:write']);
  const canReadRegistrations = userHasAnyPermission(roles, ['module-registration:read:all']);
  const canReadAssessment = userHasAnyPermission(roles, ['mark:read:all']);
  const canReadCorrections = userHasAnyPermission(roles, ['exam-board:read']);
  const canReadDisability = userHasAnyPermission(roles, ['disability:read']);
  const canReadAdjustments = userHasAnyPermission(roles, ['adjustment:read:all']);
  const canReadCircumstances = userHasAnyPermission(roles, ['circumstances:read']);
  const canReadNotifications = userHasAnyPermission(roles, ['notifications:read']);
  const tabs: Tab[] = [
    'identity',
    ...(canReadEnrolments ? ['enrolments', 'history'] as Tab[] : []),
    ...(canReadEnrolments && canReadCorrections ? ['corrections'] as Tab[] : []),
    ...(canReadRegistrations ? ['registrations'] as Tab[] : []),
    ...(canReadAssessment ? ['assessment'] as Tab[] : []),
    ...(canReadDisability || canReadAdjustments || canReadCircumstances ? ['wellbeing'] as Tab[] : []),
    ...(canReadNotifications ? ['communications'] as Tab[] : []),
  ];

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-4 text-sm text-gray-500">
        <Link to="/students" className="hover:text-indigo-600">Students</Link>
        <span className="mx-2">›</span>
        <span className="text-gray-900">{displayName}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{displayName}</h1>
          <p className="text-sm text-gray-500 mt-0.5 font-mono">{student.studentNumber}</p>
        </div>
        <Badge value={student.personStatusCode} />
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`mr-6 pb-3 text-sm font-medium capitalize border-b-2 transition-colors ${
              tab === t
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
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
        <CorrectionsTab personId={personId} />
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
      <section className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700">Personal identity</h2>
          {canWrite && !editing && (
            <button onClick={() => setEditing(true)} className="text-xs text-indigo-600 hover:underline">
              Edit
            </button>
          )}
        </div>

        {editing ? (
          <form onSubmit={(e) => void handleIdentitySave(e)} className="space-y-3">
            <IdentityField name="legalFirstName"    label="Legal first name"     defaultValue={id?.legalFirstName} />
            <IdentityField name="legalFamilyName"   label="Legal family name"    defaultValue={id?.legalFamilyName} />
            <IdentityField name="preferredName"     label="Preferred name"       defaultValue={id?.preferredName ?? ''} />
            <IdentityField name="dateOfBirth"       label="Date of birth"        defaultValue={id?.dateOfBirth ?? ''} type="date" />
            <IdentityField name="emailInstitutional" label="Institutional email" defaultValue={id?.emailInstitutional ?? ''} type="email" />
            <IdentityField name="emailPersonal"     label="Personal email"       defaultValue={id?.emailPersonal ?? ''} type="email" />
            <IdentityField name="phoneMobile"       label="Mobile phone"         defaultValue={id?.phoneMobile ?? ''} />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={saving} className="px-3 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button type="button" onClick={() => setEditing(false)} className="px-3 py-1 text-xs text-gray-600 hover:text-gray-900">
                Cancel
              </button>
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
              <p className="text-xs text-gray-600 pt-1">
                Updated {new Date(id.recordedAt).toLocaleDateString()}
              </p>
            )}
          </dl>
        )}
      </section>

      {/* Right column: HESA ID + status */}
      <div className="space-y-4">
        {/* HESA ID */}
        <section className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">HESA identifier</h2>
            {canWrite && !editHesa && (
              <button onClick={() => setEditHesa(true)} className="text-xs text-indigo-600 hover:underline">
                {student.hesaId ? 'Update' : 'Add'}
              </button>
            )}
          </div>
          {editHesa ? (
            <form onSubmit={(e) => void handleHesaSave(e)} className="flex gap-2">
              <input
                name="hesaId"
                defaultValue={student.hesaId ?? ''}
                className="flex-1 rounded border border-gray-300 px-3 py-1 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button type="submit" disabled={saving} className="px-3 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700 disabled:opacity-50">
                Save
              </button>
              <button type="button" onClick={() => setEditHesa(false)} className="text-xs text-gray-500">
                Cancel
              </button>
            </form>
          ) : (
            <p className="text-sm font-mono text-gray-900">{student.hesaId ?? <span className="text-gray-600 font-sans">Not set</span>}</p>
          )}
        </section>

        {/* Person status */}
        <section className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Lifecycle status</h2>
          <div className="flex items-center gap-3 flex-wrap">
            <Badge value={student.personStatusCode} />
            {canWrite && (['prospective','student','alumnus','deceased','merged'] as PersonStatusCode[]).map((s) => (
              s !== student.personStatusCode && (
                <button
                  key={s}
                  disabled={saving}
                  onClick={() => void handleStatusChange(s)}
                  className="text-xs text-gray-500 hover:text-indigo-600 hover:underline disabled:opacity-40"
                >
                  → {s}
                </button>
              )
            ))}
          </div>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </section>
      </div>
    </div>
  );
}

function IdentityField({ name, label, defaultValue, type = 'text' }: {
  name: string; label: string; defaultValue?: string | null; type?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-0.5">{label}</label>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ''}
        className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
    </div>
  );
}

function IdentityRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 flex-shrink-0 text-gray-500">{label}</dt>
      <dd className="text-gray-900">{value ?? <span className="text-gray-600">—</span>}</dd>
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
        <h2 className="text-sm font-semibold text-gray-700">Enrolments</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded hover:bg-indigo-700"
        >
          New enrolment
        </button>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {enrolments.length === 0 ? (
        <p className="text-sm text-gray-600">No enrolments on record.</p>
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

      {showCreate && (
        <CreateEnrolmentModal
          personId={personId}
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
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
    intermit:  'bg-yellow-50 text-yellow-700 border-yellow-200 hover:bg-yellow-100',
    suspend:   'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100',
    withdraw:  'bg-red-50    text-red-700    border-red-200    hover:bg-red-100',
    graduate:  'bg-green-50  text-green-700  border-green-200  hover:bg-green-100',
    reinstate: 'bg-blue-50   text-blue-700   border-blue-200   hover:bg-blue-100',
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div
        className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-gray-50"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900">
            {enrolment.academicYearOfEntry} · {enrolment.modeOfStudyCode}
          </p>
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            {enrolment.programmeName
              ? <>{enrolment.programmeCode && <span className="font-mono mr-1">{enrolment.programmeCode}</span>}{enrolment.programmeName}</>
              : <span className="text-gray-600 italic">No programme assigned</span>
            }
          </p>
        </div>
        <Badge value={enrolment.statusCode} />
        <span className="text-gray-600 text-sm">{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 px-4 py-4 space-y-4">
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
              <p className="text-xs text-gray-500 mb-2">Actions</p>
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
              {transitionError && <p className="mt-2 text-xs text-red-600">{transitionError}</p>}
            </div>
          )}

          {/* Module registrations */}
          {loadingDetails ? (
            <div className="flex justify-center py-4"><Spinner size="sm" /></div>
          ) : timetable && timetable.length > 0 ? (
            <div>
              <p className="text-xs text-gray-500 mb-2">Active registrations</p>
              <div className="divide-y divide-gray-100 rounded border border-gray-100 overflow-hidden">
                {timetable.map((t) => (
                  <div key={t.moduleRegistrationId} className="flex items-center gap-3 px-3 py-2 text-sm bg-gray-50">
                    <span className="font-mono text-xs text-gray-600 w-20 flex-shrink-0">{t.moduleCode}</span>
                    <span className="flex-1 text-gray-900 truncate">{t.moduleTitle}</span>
                    <span className="text-xs text-gray-600">{t.periodCode}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : registrations !== null && registrations.length === 0 ? (
            <p className="text-xs text-gray-600">No active module registrations.</p>
          ) : null}
        </div>
      )}

      {showTransitionModal && (
        <TransitionModal
          action={showTransitionModal}
          onClose={() => setShowTransitionModal(null)}
          onConfirm={(opts) => void handleTransition(showTransitionModal, opts)}
          saving={transitioning}
        />
      )}
    </div>
  );
}

function TransitionModal({
  action,
  onClose,
  onConfirm,
  saving,
}: {
  action:    TransitionAction;
  onClose:   () => void;
  onConfirm: (opts?: TransitionOptions) => void;
  saving:    boolean;
}) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const reasonCode = String(fd.get('reasonCode') ?? '').trim() || undefined;
    const reasonText = String(fd.get('reasonText') ?? '').trim() || undefined;
    onConfirm({ reasonCode, reasonText });
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg border border-gray-200 p-6 w-full max-w-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-gray-900 mb-4 capitalize">{action} enrolment</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-0.5">Reason code</label>
            <input name="reasonCode" className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-0.5">Reason (optional note)</label>
            <textarea name="reasonText" rows={2} className="w-full rounded border border-gray-300 px-2 py-1 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded hover:bg-indigo-700 disabled:opacity-50 capitalize"
            >
              {saving ? 'Saving…' : action}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CreateEnrolmentModal({
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

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

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
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg border border-gray-200 p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-gray-900 mb-4">New enrolment</h2>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          <EnrolField name="modeOfStudyCode"     label="Mode of study *"    placeholder="full-time" />
          <EnrolField name="academicYearOfEntry" label="Academic year *"    placeholder="2025-26" />
          <EnrolField name="startDate"           label="Start date *"       placeholder="2025-09-22" />
          <EnrolField name="expectedEndDate"     label="Expected end date"  placeholder="2028-06-30" />
          <EnrolField name="fundingSourceCode"   label="Funding source"     placeholder="slc" />
          <EnrolField name="feeBandCode"         label="Fee band"           placeholder="home-undergraduate" />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EnrolField({ name, label, placeholder }: { name: string; label: string; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-0.5">{label}</label>
      <input
        name={name}
        placeholder={placeholder}
        className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 flex-shrink-0 text-gray-500 text-xs pt-0.5">{label}</dt>
      <dd className="text-gray-900">{value ?? <span className="text-gray-600">—</span>}</dd>
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
          <label className="text-sm text-gray-500">Enrolment:</label>
          <select
            value={selectedEnrolmentId}
            onChange={(e) => { setSelectedEnrolmentId(e.target.value); void load(e.target.value); }}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            {enrolments.map(e => (
              <option key={e.enrolmentId} value={e.enrolmentId}>
                {e.academicYearOfEntry} ({e.statusCode})
              </option>
            ))}
          </select>
        </div>
      )}
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : registrations.length === 0 ? (
        <p className="text-sm text-gray-600">No module registrations found.</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Module</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Period</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Registered</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {registrations.map(r => (
                <tr key={r.moduleRegistrationId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-900">
                    <span className="font-mono text-xs text-gray-500 mr-1">{r.moduleCode}</span>
                    {r.moduleTitle}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{r.periodCode}</td>
                  <td className="px-4 py-3"><Badge value={r.statusCode} /></td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{r.registrationDate}</td>
                  <td className="px-4 py-3 text-right">
                    {r.statusCode === 'registered' && (
                      confirmId === r.moduleRegistrationId ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="text-xs text-gray-600">
                            {confirmAction === 'complete' ? 'Mark complete?' : 'Withdraw?'}
                          </span>
                          <button
                            disabled={acting}
                            onClick={() => void handleAction(r.moduleRegistrationId, confirmAction!)}
                            className={`rounded px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50 ${
                              confirmAction === 'complete' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
                            }`}
                          >
                            {acting ? 'Saving…' : 'Confirm'}
                          </button>
                          <button
                            onClick={() => { setConfirmId(null); setConfirmAction(null); }}
                            className="text-xs text-gray-500 hover:text-gray-800"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <button
                            onClick={() => { setConfirmId(r.moduleRegistrationId); setConfirmAction('complete'); }}
                            className="rounded border border-green-300 px-2 py-0.5 text-xs text-green-700 hover:bg-green-50"
                          >
                            Complete
                          </button>
                          <button
                            onClick={() => { setConfirmId(r.moduleRegistrationId); setConfirmAction('withdraw'); }}
                            className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
                          >
                            Withdraw
                          </button>
                        </span>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
          <label className="text-sm text-gray-500">Enrolment:</label>
          <select
            value={selectedEnrolmentId}
            onChange={(e) => { setSelectedEnrolmentId(e.target.value); void loadAll(e.target.value); }}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            {enrolments.map(e => (
              <option key={e.enrolmentId} value={e.enrolmentId}>
                {e.academicYearOfEntry} ({e.statusCode})
              </option>
            ))}
          </select>
        </div>
      )}
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-600">No module registrations found.</p>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => (
            <div key={row.registration.moduleRegistrationId} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="flex items-center gap-4 px-4 py-3 bg-gray-50 border-b border-gray-100">
                <div className="flex-1 min-w-0">
                  <span className="font-mono text-xs text-gray-500 mr-2">{row.registration.moduleCode}</span>
                  <span className="text-sm font-medium text-gray-900">{row.registration.moduleTitle}</span>
                </div>
                <span className="text-xs text-gray-600">{row.registration.periodCode}</span>
                <Badge value={row.registration.statusCode} />
                {row.result && <Badge value={row.result.resultCode} />}
                {row.result && (
                  <span className="text-sm font-semibold text-gray-800">{row.result.aggregateMark}%</span>
                )}
                {row.result && (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                    row.result.locked
                      ? 'bg-green-100 text-green-700'
                      : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {row.result.locked ? 'Locked' : 'Provisional'}
                  </span>
                )}
              </div>
              <div className="px-4 py-3">
                {row.error ? (
                  <p className="text-xs text-red-600">{row.error}</p>
                ) : row.marks.length === 0 ? (
                  <p className="text-xs text-gray-600">No marks recorded.</p>
                ) : (
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-xs font-medium text-gray-500 uppercase">
                        <th className="pr-6 py-1 text-left">Component</th>
                        <th className="pr-6 py-1 text-left">Attempt</th>
                        <th className="pr-6 py-1 text-left">Raw</th>
                        <th className="pr-6 py-1 text-left">Adjusted</th>
                        <th className="pr-6 py-1 text-left">Penalty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {row.marks.map((m) => {
                        const comp = row.components.get(m.assessmentComponentId);
                        return (
                        <tr key={m.markId} className="hover:bg-gray-50">
                          <td className="pr-6 py-1.5 text-gray-700">
                            {comp ? comp.title : <span className="text-xs text-gray-600 font-mono">{m.assessmentComponentId.slice(0, 8)}</span>}
                          </td>
                          <td className="pr-6 py-1.5 text-gray-600">{m.attemptNumber}</td>
                          <td className="pr-6 py-1.5 font-semibold text-gray-900">{m.rawMark}</td>
                          <td className="pr-6 py-1.5 text-gray-700">{m.adjustedMark ?? '—'}</td>
                          <td className="pr-6 py-1.5 text-gray-500">
                            {m.penaltyApplied ? `${m.penaltyPercent ?? '?'}%` : '—'}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
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
      <p className="mb-4 text-xs text-gray-500">
        Bitemporal history — all recorded versions of this enrolment.
      </p>
      {enrolments.length > 1 && (
        <div className="mb-4 flex items-center gap-3">
          <label className="text-sm text-gray-500">Enrolment:</label>
          <select
            value={selectedEnrolId}
            onChange={(e) => { setSelectedEnrolId(e.target.value); void loadHistory(e.target.value); }}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            {enrolments.map(e => (
              <option key={e.enrolmentId} value={e.enrolmentId}>
                {e.academicYearOfEntry} ({e.statusCode})
              </option>
            ))}
          </select>
        </div>
      )}
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : history.length === 0 ? (
        <p className="text-sm text-gray-600">No history records found.</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Valid from</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Recorded at</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Mode</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {history.map((h, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-3"><Badge value={h.statusCode} /></td>
                  <td className="px-4 py-3 text-gray-600 text-xs font-mono">{h.validFrom}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs font-mono">{h.recordedAt}</td>
                  <td className="px-4 py-3 text-gray-600">{h.modeOfStudyCode}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

function CorrectionsTab({ personId }: { personId: string }) {
  const { members: caseTypes }   = useValueSet('correction_case', 'case_type_code');
  const { members: caseStatuses } = useValueSet('correction_case', 'case_status_code');
  const [enrolments,   setEnrolments]   = useState<Enrolment[]>([]);
  const [cases,        setCases]        = useState<CorrectionCase[]>([]);
  const [selectedEnrolId, setSelectedEnrolId] = useState('');
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [showCreate,   setShowCreate]   = useState(false);
  const [creating,     setCreating]     = useState(false);
  const [newCaseType,    setNewCaseType]    = useState<string>('');
  const [newCaseRef,     setNewCaseRef]     = useState<string>('');
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
      await createCorrectionCase(selectedEnrolId, newCaseType, newCaseRef.trim() || undefined);
      setShowCreate(false);
      setNewCaseRef('');
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
        <h2 className="text-sm font-semibold text-gray-700">Correction &amp; appeal cases</h2>
        <button
          onClick={() => setShowCreate(s => !s)}
          className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
        >
          New case
        </button>
      </div>

      {showCreate && (
        <form onSubmit={(e) => void handleCreateCase(e)} className="mb-4 bg-indigo-50 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-700 w-24 flex-shrink-0">Type:</label>
            <select
              value={newCaseType}
              onChange={(e) => setNewCaseType(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1 text-sm"
            >
              {caseTypes.map(({ code, displayLabel }) => <option key={code} value={code}>{displayLabel}</option>)}
            </select>
          </div>
          <div className="flex items-start gap-3">
            <label className="text-sm text-gray-700 w-24 flex-shrink-0 pt-1">Description:</label>
            <textarea
              value={newCaseRef}
              onChange={(e) => setNewCaseRef(e.target.value)}
              rows={3}
              placeholder="Brief description of the issue…"
              className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="submit"
              disabled={creating}
              className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
            <button type="button" onClick={() => setShowCreate(false)} className="text-sm text-gray-500">
              Cancel
            </button>
          </div>
        </form>
      )}

      {enrolments.length > 1 && (
        <div className="mb-4 flex items-center gap-3">
          <label className="text-sm text-gray-500">Enrolment:</label>
          <select
            value={selectedEnrolId}
            onChange={(e) => { setSelectedEnrolId(e.target.value); void loadCases(e.target.value); }}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            {enrolments.map(e => (
              <option key={e.enrolmentId} value={e.enrolmentId}>
                {e.academicYearOfEntry} ({e.statusCode})
              </option>
            ))}
          </select>
        </div>
      )}

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : cases.length === 0 ? (
        <p className="text-sm text-gray-600">No correction or appeal cases on record.</p>
      ) : (
        <div className="space-y-3">
          {cases.map(c => (
            <div key={c.caseId} className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-900">{caseTypes.find(s => s.code === c.caseTypeCode)?.displayLabel ?? c.caseTypeCode}</p>
                  <p className="text-xs text-gray-500 font-mono mt-0.5">{c.reference}</p>
                </div>
                <Badge value={c.statusCode} label={caseStatuses.find(s => s.code === c.statusCode)?.displayLabel} />
              </div>
              {(() => {
                const validTargets = CASE_FORWARD_TRANSITIONS[c.statusCode] ?? [];
                const targetButtons = caseStatuses.filter(({ code }) => validTargets.includes(code));
                if (targetButtons.length === 0) return null;
                return (
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-500">Move to:</span>
                    {targetButtons.map(({ code, displayLabel }) => (
                      <button
                        key={code}
                        disabled={updatingId === c.caseId}
                        onClick={() => void handleStatusChange(c.caseId, code)}
                        className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                      >
                        {displayLabel}
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
      )}

      {selectedEnrolId && (
        <VleOverrideAuditSection enrolmentId={selectedEnrolId} />
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
      <h2 className="text-sm font-semibold text-gray-700 mb-4">Communications</h2>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {notifications.length === 0 ? (
        <p className="text-sm text-gray-600">No communications on record for this student.</p>
      ) : (
        <div className="space-y-3">
          {notifications.map((n) => (
            <div key={n.id} className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{n.title}</p>
                  <p className="text-sm text-gray-600 mt-0.5">{n.body}</p>
                  {n.linkUrl && (
                    <a href={n.linkUrl} className="text-xs text-indigo-600 hover:underline mt-1 inline-block">
                      {n.linkUrl}
                    </a>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                    {n.category}
                  </span>
                  <p className="text-xs text-gray-600 mt-1">
                    {new Date(n.createdAt).toLocaleString('en-GB')}
                  </p>
                  {n.readAt && (
                    <p className="text-xs text-green-600 mt-0.5">
                      Read {new Date(n.readAt).toLocaleString('en-GB')}
                    </p>
                  )}
                </div>
              </div>
            </div>
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
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
        VLE enrolment override history (R-VLE-002)
      </h3>
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <table className="min-w-full divide-y divide-gray-100 text-xs">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase">When</th>
              <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase">Event</th>
              <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase">Actor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {entries.map(e => (
              <tr key={e.id}>
                <td className="px-3 py-2 text-gray-500 whitespace-nowrap font-mono">
                  {new Date(e.recordedAt).toLocaleString('en-GB')}
                </td>
                <td className="px-3 py-2 text-gray-700">{e.eventType}</td>
                <td className="px-3 py-2 text-gray-500 font-mono">{e.actorId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
  if (error)   return <p className="text-red-600 text-sm">{error}</p>;

  const label = (members: { code: string; displayLabel: string }[], code: string) =>
    members.find(m => m.code === code)?.displayLabel ?? code;

  return (
    <div className="space-y-8">

      {/* Disability declarations */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Disability Declarations</h2>
        {declarations?.length === 0 ? (
          <p className="text-sm text-gray-600">No disability declarations on record.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Category</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Declared</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {declarations?.map(d => (
                  <tr key={d.declarationId} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-800">{label(disabilityCategories, d.disabilityCategoryCode)}</td>
                    <td className="px-4 py-3"><Badge value={d.declarationStatusCode} label={label(declarationStatuses, d.declarationStatusCode)} /></td>
                    <td className="px-4 py-3 text-gray-600">{new Date(d.declaredAt).toLocaleDateString('en-GB')}</td>
                    <td className="px-4 py-3 text-gray-500">{d.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Reasonable adjustments */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Reasonable Adjustments</h2>
        {adjustments?.length === 0 ? (
          <p className="text-sm text-gray-600">No reasonable adjustments on record.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Scope</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Valid From</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Valid To</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {adjustments?.filter(a => a.recordedUntil === null).map(a => (
                  <tr key={a.adjustmentId} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-800">{label(adjustmentTypes, a.adjustmentTypeCode)}</td>
                    <td className="px-4 py-3 text-gray-600">{label(adjustmentScopes, a.scopeCode)}</td>
                    <td className="px-4 py-3 text-gray-600">{new Date(a.validFrom).toLocaleDateString('en-GB')}</td>
                    <td className="px-4 py-3 text-gray-600">{a.validTo ? new Date(a.validTo).toLocaleDateString('en-GB') : 'Open-ended'}</td>
                    <td className="px-4 py-3 text-gray-500">{a.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Exceptional circumstances */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Exceptional Circumstances</h2>
        {ecs?.length === 0 ? (
          <p className="text-sm text-gray-600">No exceptional circumstances on record.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Module</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Outcome</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Determination Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {ecs?.filter(e => e.recordedUntil === null).map(e => (
                  <tr key={e.exceptionalCircumstancesId} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-800">
                      {e.moduleCode
                        ? <><span className="font-mono text-xs text-gray-500 mr-1">{e.moduleCode}</span>{e.moduleTitle}</>
                        : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-3"><Badge value={e.outcomeCode} label={label(ecOutcomes, e.outcomeCode)} /></td>
                    <td className="px-4 py-3 text-gray-600">{new Date(e.determinationDate).toLocaleDateString('en-GB')}</td>
                    <td className="px-4 py-3 text-gray-500">{e.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </div>
  );
}
