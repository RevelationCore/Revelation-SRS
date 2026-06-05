import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  type IdentityPatch,
  type Student,
  type PersonStatusCode,
  getStudent,
  updateStudentIdentity,
  updateHesaId,
  updatePersonStatus,
} from '../api/students.js';
import {
  type CreateEnrolmentInput,
  type Enrolment,
  type TransitionAction,
  type TransitionOptions,
  AVAILABLE_TRANSITIONS,
  createEnrolment,
  listStudentEnrolments,
  transitionEnrolment,
} from '../api/enrolments.js';
import { type TimetableEntry, getTimetable, listModuleRegistrations } from '../api/registrations.js';
import { type ModuleRegistration } from '../api/registrations.js';
import { ApiError } from '../api/client.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';

type Tab = 'identity' | 'enrolments';

export function StudentDetailPage() {
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
        {(['identity', 'enrolments'] as Tab[]).map((t) => (
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
        <IdentityTab student={student} onUpdated={reload} />
      )}
      {tab === 'enrolments' && personId && (
        <EnrolmentsTab personId={personId} student={student} onUpdated={reload} />
      )}
    </div>
  );
}

// ── Identity tab ──────────────────────────────────────────────────────────────

function IdentityTab({ student, onUpdated }: { student: Student; onUpdated: () => void }) {
  const [editing, setEditing]     = useState(false);
  const [editHesa, setEditHesa]   = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
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
          {!editing && (
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
            <IdentityRow label="Email (inst.)" value={id?.emailInstitutional} />
            <IdentityRow label="Email (pers.)" value={id?.emailPersonal} />
            <IdentityRow label="Mobile"        value={id?.phoneMobile} />
            {id && (
              <p className="text-xs text-gray-400 pt-1">
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
            {!editHesa && (
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
            <p className="text-sm font-mono text-gray-900">{student.hesaId ?? <span className="text-gray-400 font-sans">Not set</span>}</p>
          )}
        </section>

        {/* Person status */}
        <section className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Lifecycle status</h2>
          <div className="flex items-center gap-3 flex-wrap">
            <Badge value={student.personStatusCode} />
            {(['prospective','student','alumnus','deceased','merged'] as PersonStatusCode[]).map((s) => (
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
      <dd className="text-gray-900">{value ?? <span className="text-gray-400">—</span>}</dd>
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
        <p className="text-sm text-gray-400">No enrolments on record.</p>
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
          <p className="text-xs text-gray-500 mt-0.5 font-mono truncate">{enrolment.enrolmentId}</p>
        </div>
        <Badge value={enrolment.statusCode} />
        <span className="text-gray-400 text-sm">{expanded ? '▲' : '▼'}</span>
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
                    <span className="text-xs text-gray-400">{t.periodCode}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : registrations !== null && registrations.length === 0 ? (
            <p className="text-xs text-gray-400">No active module registrations.</p>
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
      <dd className="text-gray-900">{value ?? <span className="text-gray-400">—</span>}</dd>
    </div>
  );
}
