import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  type CandidateProfile,
  type ExamBoard,
  type ExamBoardDataPack,
  type ExamEntry,
  generateDataPack,
  generateExamEntries,
  getCandidateProfile,
  getDataPack,
  getExamBoard,
  listExamEntries,
  ratifyExamBoard,
  signOffExternalExaminer,
} from '../api/examBoards.js';
import { listIntegrationRegistrations, healthCheckIntegration, type HealthCheckResult } from '../api/integrations.js';
import { ApiError } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';
import { RequireRole } from '../auth/RequireRole.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';

type Tab = 'overview' | 'entries' | 'candidates' | 'signoff';

const SPECIAL_CATEGORY_ROLES = [
  'registry-administrator',
  'wellbeing-advisor',
  'wellbeing-mental-health-advisor',
  'wellbeing-panel-chair',
  'wellbeing-auditor',
  'dpo',
];

export function ExamBoardDetailPage() {
  const { boardId } = useParams<{ boardId: string }>();
  const [board,   setBoard]   = useState<ExamBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [tab,     setTab]     = useState<Tab>('overview');

  const reload = useCallback(async () => {
    if (!boardId) return;
    setLoading(true);
    setError('');
    try {
      setBoard(await getExamBoard(boardId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load exam board');
    } finally {
      setLoading(false);
    }
  }, [boardId]);

  useEffect(() => { void reload(); }, [reload]);

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (error)   return <p className="text-sm text-red-600 py-8">{error}</p>;
  if (!board || !boardId) return null;

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview',   label: 'Overview' },
    { id: 'entries',    label: 'Exam entries' },
    { id: 'candidates', label: 'Candidate profiles' },
    { id: 'signoff',    label: 'Sign-off & ratify' },
  ];

  return (
    <div>
      <div className="mb-6">
        <p className="text-xs text-gray-400 mb-1">Exam board</p>
        <h1 className="text-xl font-semibold text-gray-900 capitalize">
          {board.boardTypeCode} — {board.academicYear}
        </h1>
        <p className="text-xs text-gray-400 font-mono mt-0.5">{boardId}</p>
      </div>

      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === id
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview'   && <OverviewTab   board={board} boardId={boardId} onRefresh={reload} />}
      {tab === 'entries'    && <EntriesTab    boardId={boardId} />}
      {tab === 'candidates' && <CandidatesTab boardId={boardId} />}
      {tab === 'signoff'    && <SignoffTab    board={board} boardId={boardId} onRefresh={reload} />}
    </div>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────────

function OverviewTab({
  board,
  boardId,
  onRefresh,
}: {
  board: ExamBoard;
  boardId: string;
  onRefresh: () => void;
}) {
  const [dataPack,       setDataPack]       = useState<ExamBoardDataPack | null>(null);
  const [loadingPack,    setLoadingPack]    = useState(false);
  const [generatingPack, setGeneratingPack] = useState(false);
  const [genEntries,     setGenEntries]     = useState(false);
  const [actionError,    setActionError]    = useState('');

  useEffect(() => {
    setLoadingPack(true);
    getDataPack(boardId)
      .then(setDataPack)
      .catch(() => { /* no pack yet */ })
      .finally(() => setLoadingPack(false));
  }, [boardId]);

  async function handleGeneratePack() {
    setGeneratingPack(true);
    setActionError('');
    try {
      await generateDataPack(boardId);
      const pack = await getDataPack(boardId);
      setDataPack(pack);
    } catch (e) {
      setActionError(e instanceof ApiError ? (e.detail ?? e.message) : 'Failed to generate data pack');
    } finally {
      setGeneratingPack(false);
    }
  }

  async function handleGenerateEntries() {
    setGenEntries(true);
    setActionError('');
    try {
      await generateExamEntries(boardId);
      onRefresh();
    } catch (e) {
      setActionError(e instanceof ApiError ? (e.detail ?? e.message) : 'Failed to generate exam entries');
    } finally {
      setGenEntries(false);
    }
  }

  return (
    <div className="space-y-6">
      {actionError && <p className="text-sm text-red-600">{actionError}</p>}

      <section className="bg-white rounded-lg border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Board details</h2>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <InfoRow label="Type"           value={board.boardTypeCode} />
          <InfoRow label="Academic year"  value={board.academicYear} />
          <InfoRow label="Period"         value={board.academicPeriodId} />
          <InfoRow label="Meeting date"   value={board.meetingDate
            ? new Date(board.meetingDate).toLocaleDateString('en-GB')
            : null} />
          <InfoRow label="Ratified"       value={board.ratifiedAt
            ? new Date(board.ratifiedAt).toLocaleString('en-GB')
            : null} />
          <InfoRow label="Deferred"       value={board.deferredAt
            ? `${new Date(board.deferredAt).toLocaleDateString('en-GB')} — ${board.deferralReason ?? ''}`
            : null} />
        </dl>
      </section>

      <section className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700">Data pack</h2>
          <button
            onClick={() => void handleGeneratePack()}
            disabled={generatingPack}
            className="rounded border border-indigo-300 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
          >
            {generatingPack ? 'Generating…' : dataPack ? 'Regenerate' : 'Generate'}
          </button>
        </div>
        {loadingPack ? (
          <Spinner />
        ) : dataPack ? (
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <InfoRow label="Pack ID"    value={dataPack.dataPackId} />
            <InfoRow label="Version"    value={String(dataPack.packVersion)} />
            <InfoRow label="Candidates" value={String(dataPack.candidateCount)} />
            <InfoRow label="Generated"  value={new Date(dataPack.generatedAt).toLocaleString('en-GB')} />
          </dl>
        ) : (
          <p className="text-sm text-gray-400">No data pack generated yet.</p>
        )}
      </section>

      <section className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Exam entries</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Generate timetabled exam entries for all registered candidates.
            </p>
          </div>
          <button
            onClick={() => void handleGenerateEntries()}
            disabled={genEntries}
            className="rounded border border-indigo-300 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
          >
            {genEntries ? 'Generating…' : 'Generate entries'}
          </button>
        </div>
      </section>

      <VleGradeSyncPanel />
    </div>
  );
}

// ── VLE grade sync panel (R-VLE-001) ─────────────────────────────────────────

function VleGradeSyncPanel() {
  const [vleRegistrationId, setVleRegistrationId] = useState<string | null>(null);
  const [healthResult,      setHealthResult]      = useState<HealthCheckResult | null>(null);
  const [checking,          setChecking]          = useState(false);
  const [error,             setError]             = useState('');

  useEffect(() => {
    listIntegrationRegistrations()
      .then(regs => {
        const vle = regs.find(r =>
          r.name.toLowerCase().includes('vle') || r.endpointUrl?.toLowerCase().includes('vle'),
        );
        if (vle) setVleRegistrationId(vle.registrationId);
      })
      .catch(() => { /* no VLE connector registered — panel stays hidden */ });
  }, []);

  if (!vleRegistrationId) return null;

  async function handleCheckGradeSync() {
    if (!vleRegistrationId) return;
    setChecking(true);
    setError('');
    try {
      const result = await healthCheckIntegration(vleRegistrationId);
      setHealthResult(result);
    } catch (e) {
      setError(e instanceof ApiError ? (e.detail ?? e.message) : 'Health check failed');
    } finally {
      setChecking(false);
    }
  }

  const metrics = healthResult
    ? (healthResult as HealthCheckResult & { details?: { unsubmittedMarks?: number; markConflicts?: number } }).details
    : null;

  return (
    <section className="rounded-lg border border-indigo-200 bg-indigo-50 p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-indigo-900">VLE grade sync (R-VLE-001)</h2>
        <button
          onClick={() => void handleCheckGradeSync()}
          disabled={checking}
          className="rounded border border-indigo-400 bg-white px-3 py-1.5 text-xs font-medium text-indigo-800 hover:bg-indigo-50 disabled:opacity-50"
        >
          {checking ? 'Checking…' : 'Check grade sync'}
        </button>
      </div>
      <p className="text-xs text-indigo-700 mb-3">
        Checks the VLE connector for unsubmitted marks and grade conflicts. If conflicts are
        detected, use the Integration Ops bulk reconciliation to replay and resolve them.
      </p>
      {error && <p className="text-xs text-red-700 mb-2">{error}</p>}
      {healthResult && (
        <div className="rounded bg-white border border-indigo-100 p-3 text-xs space-y-1">
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 font-medium ${
              healthResult.statusCode === 'healthy' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
            }`}>{healthResult.statusCode}</span>
            {healthResult.latencyMs != null && (
              <span className="text-gray-500">{healthResult.latencyMs}ms</span>
            )}
          </div>
          {metrics && (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 mt-2">
              {metrics.unsubmittedMarks !== undefined && (
                <>
                  <dt className="text-gray-500">Unsubmitted marks</dt>
                  <dd className={metrics.unsubmittedMarks > 0 ? 'text-amber-700 font-medium' : 'text-green-700'}>
                    {metrics.unsubmittedMarks}
                  </dd>
                </>
              )}
              {metrics.markConflicts !== undefined && (
                <>
                  <dt className="text-gray-500">Grade conflicts</dt>
                  <dd className={metrics.markConflicts > 0 ? 'text-red-700 font-medium' : 'text-green-700'}>
                    {metrics.markConflicts}
                  </dd>
                </>
              )}
            </dl>
          )}
          {healthResult.message && (
            <p className="text-gray-600 mt-1">{healthResult.message}</p>
          )}
        </div>
      )}
    </section>
  );
}

// ── Entries tab ───────────────────────────────────────────────────────────────

function EntriesTab({ boardId }: { boardId: string }) {
  const [entries, setEntries] = useState<ExamEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    setLoading(true);
    listExamEntries(boardId)
      .then(setEntries)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Failed to load entries'))
      .finally(() => setLoading(false));
  }, [boardId]);

  if (loading) return <div className="flex justify-center py-8"><Spinner /></div>;
  if (error)   return <p className="text-sm text-red-600">{error}</p>;

  if (entries.length === 0) return <p className="text-sm text-gray-400">No exam entries found.</p>;

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Candidate #</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Scheduled</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Room</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Accommodations</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {entries.map(e => (
            <tr key={e.examEntryId} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-mono text-xs text-gray-700">{e.candidateNumber}</td>
              <td className="px-4 py-3 text-gray-600">
                {e.scheduledDate
                  ? new Date(e.scheduledDate).toLocaleDateString('en-GB')
                  : <span className="text-gray-400">—</span>}
              </td>
              <td className="px-4 py-3 text-gray-600">{e.roomReference ?? <span className="text-gray-400">—</span>}</td>
              <td className="px-4 py-3"><Badge value={e.statusCode} /></td>
              <td className="px-4 py-3 text-gray-600 text-xs">
                {e.accommodations.length > 0 ? e.accommodations.join(', ') : <span className="text-gray-400">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Candidates tab ─────────────────────────────────────────────────────────────

function CandidatesTab({ boardId }: { boardId: string }) {
  const [enrolmentId, setEnrolmentId] = useState('');
  const [profile,     setProfile]     = useState<CandidateProfile | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');

  async function handleLookup(e: FormEvent) {
    e.preventDefault();
    if (!enrolmentId.trim()) return;
    setLoading(true);
    setError('');
    setProfile(null);
    try {
      setProfile(await getCandidateProfile(boardId, enrolmentId.trim()));
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Not found');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <p className="text-sm text-gray-600 mb-4">
        Look up a candidate profile by enrolment ID. EC and adjustment data within profiles
        requires the <strong>special-category:read</strong> permission.
      </p>

      <form onSubmit={(e) => void handleLookup(e)} className="flex items-center gap-3 mb-6">
        <input
          value={enrolmentId}
          onChange={(e) => setEnrolmentId(e.target.value)}
          placeholder="Enrolment ID"
          className="flex-1 max-w-xs rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Look up'}
        </button>
      </form>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {profile && (
        <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <InfoRow label="Profile ID"   value={profile.candidateProfileId} />
            <InfoRow label="Person ID"    value={profile.personId} />
            <InfoRow label="Enrolment ID" value={profile.enrolmentId} />
            <InfoRow label="Generated"    value={new Date(profile.createdAt).toLocaleString('en-GB')} />
          </dl>

          <RequireRole roles={SPECIAL_CATEGORY_ROLES}>
            <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 p-4">
              <p className="text-xs font-semibold text-amber-800 mb-2 uppercase tracking-wide">
                Special-category data — restricted access
              </p>
              <pre className="text-xs text-gray-700 whitespace-pre-wrap overflow-auto max-h-64">
                {JSON.stringify(profile.profileData, null, 2)}
              </pre>
            </div>
          </RequireRole>
        </div>
      )}
    </div>
  );
}

// ── Sign-off & ratify tab ─────────────────────────────────────────────────────

function SignoffTab({
  board,
  boardId,
  onRefresh,
}: {
  board: ExamBoard;
  boardId: string;
  onRefresh: () => void;
}) {
  const { roles } = useAuth();
  const [commentary,       setCommentary]       = useState('');
  const [signingOff,       setSigningOff]       = useState(false);
  const [ratifying,        setRatifying]        = useState(false);
  const [confirmRatify,    setConfirmRatify]    = useState(false);
  const [actionError,      setActionError]      = useState('');
  const [successMsg,       setSuccessMsg]       = useState('');

  const canRatify = roles.includes('exam-board-chair') || roles.includes('registry-administrator');

  async function handleSignOff(e: FormEvent) {
    e.preventDefault();
    setSigningOff(true);
    setActionError('');
    setSuccessMsg('');
    try {
      await signOffExternalExaminer(boardId, commentary || undefined);
      setSuccessMsg('External examiner sign-off recorded.');
      setCommentary('');
    } catch (err) {
      setActionError(err instanceof ApiError ? (err.detail ?? err.message) : 'Sign-off failed');
    } finally {
      setSigningOff(false);
    }
  }

  async function handleRatify() {
    setRatifying(true);
    setActionError('');
    setSuccessMsg('');
    try {
      await ratifyExamBoard(boardId);
      setConfirmRatify(false);
      setSuccessMsg('Board ratified successfully.');
      onRefresh();
    } catch (err) {
      setActionError(err instanceof ApiError ? (err.detail ?? err.message) : 'Ratification failed');
    } finally {
      setRatifying(false);
    }
  }

  return (
    <div className="space-y-6">
      {actionError && <p className="text-sm text-red-600">{actionError}</p>}
      {successMsg  && <p className="text-sm text-green-600">{successMsg}</p>}

      <section className="bg-white rounded-lg border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">External examiner sign-off</h2>
        <form onSubmit={(e) => void handleSignOff(e)} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Commentary (optional)</label>
            <textarea
              value={commentary}
              onChange={(e) => setCommentary(e.target.value)}
              rows={3}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button
            type="submit"
            disabled={signingOff}
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {signingOff ? 'Recording…' : 'Record sign-off'}
          </button>
        </form>
      </section>

      <section className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Ratification</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Ratifying locks the board. This action cannot be undone.
              {!canRatify && ' You do not have the exam-board-chair or registry-administrator role.'}
            </p>
          </div>
          {board.ratifiedAt ? (
            <Badge value="ratified" />
          ) : canRatify && (
            confirmRatify ? (
              <span className="inline-flex items-center gap-2">
                <span className="text-xs text-gray-600">Ratify this board?</span>
                <button
                  onClick={() => void handleRatify()}
                  disabled={ratifying}
                  className="rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {ratifying ? 'Ratifying…' : 'Confirm ratify'}
                </button>
                <button
                  onClick={() => setConfirmRatify(false)}
                  className="text-xs text-gray-500 hover:text-gray-800"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmRatify(true)}
                className="rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
              >
                Ratify board
              </button>
            )
          )}
        </div>
        {board.ratifiedAt && (
          <p className="mt-2 text-xs text-gray-500">
            Ratified {new Date(board.ratifiedAt).toLocaleString('en-GB')}
          </p>
        )}
      </section>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 flex-shrink-0 text-gray-500 text-xs pt-0.5">{label}</dt>
      <dd className="text-gray-900 text-xs">{value ?? <span className="text-gray-400">—</span>}</dd>
    </div>
  );
}
