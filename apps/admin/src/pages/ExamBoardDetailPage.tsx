import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  type CandidateProfile,
  type ExamBoard,
  type ExamBoardDataPack,
  type ExamEntry,
  type PackVerification,
  generateDataPack,
  generateExamEntries,
  getCandidateProfile,
  getDataPack,
  getExamBoard,
  listExamEntries,
  ratifyExamBoard,
  signOffExternalExaminer,
  verifyDataPack,
} from '../api/examBoards.js';
import { listIntegrationRegistrations, healthCheckIntegration, type HealthCheckResult } from '../api/integrations.js';
import {
  type BoardDecisionTypeCode,
  declareConflict,
  recuseMember,
  recordQuorumDecision,
  recordBoardDecision,
  createRatificationRecord,
  publishResults,
} from '../api/boardAuthority.js';
import { ApiError } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';
import { RequireRole } from '../auth/RequireRole.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';
import {
  Card, CardHeader, CardBody, Button, LabelledField, Input, Select, PageHeader, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, Tabs, TabsList, TabsTrigger, TabsContent, StatusNotice, CodeBadge, CodeLabel, CodeSelect, useCodes,
} from '@revelation-srs/ui';

type Tab = 'overview' | 'entries' | 'candidates' | 'signoff' | 'authority';

const SPECIAL_CATEGORY_ROLES = [
  'registry-administrator',
  'wellbeing-advisor',
  'wellbeing-mental-health-advisor',
  'wellbeing-panel-chair',
  'wellbeing-auditor',
  'dpo',
];

export function ExamBoardDetailPage() {
  const { roles } = useAuth();
  const canWriteBoard = userHasAnyPermission(roles, ['exam-board:write']);
  const canManageIntegrations = userHasAnyPermission(roles, ['integration:manage']);
  const canReadIntegrations = userHasAnyPermission(roles, ['integration:read']);
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
  if (error)   return <p className="text-sm text-danger-600 py-8">{error}</p>;
  if (!board || !boardId) return null;

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview',   label: 'Overview' },
    { id: 'entries',    label: 'Exam entries' },
    { id: 'candidates', label: 'Candidate profiles' },
    { id: 'signoff',    label: 'Sign-off & ratify' },
    { id: 'authority',  label: 'Board authority' },
  ];

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Exam boards', to: '/exam-boards' }]}
        title={<><CodeLabel entity="exam_board" field="board_type_code" code={board.boardTypeCode} /> — {board.academicYear}</>}
        description={<span className="font-mono text-xs">{boardId}</span>}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="mb-6">
          {TABS.map(({ id, label }) => <TabsTrigger key={id} value={id}>{label}</TabsTrigger>)}
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab board={board} boardId={boardId} onRefresh={reload}
            canWriteBoard={canWriteBoard} canReadIntegrations={canReadIntegrations}
            canManageIntegrations={canManageIntegrations} />
        </TabsContent>
        <TabsContent value="entries"><EntriesTab boardId={boardId} /></TabsContent>
        <TabsContent value="candidates"><CandidatesTab boardId={boardId} /></TabsContent>
        <TabsContent value="signoff"><SignoffTab board={board} boardId={boardId} onRefresh={reload} /></TabsContent>
        <TabsContent value="authority"><AuthorityTab boardId={boardId} /></TabsContent>
      </Tabs>
    </div>
  );
}

// ── Board authority tab (conflicts, quorum, decisions, ratification) ────────

function AuthorityTab({ boardId }: { boardId: string }) {
  const { roles } = useAuth();
  const canRatify = userHasAnyPermission(roles, ['exam-board:ratify']);
  const [error, setError] = useState('');

  if (!canRatify) {
    return <p className="text-sm text-neutral-600">You do not have the exam-board:ratify permission required for this section.</p>;
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-danger-600">{error}</p>}
      <ConflictCard boardId={boardId} onError={setError} />
      <QuorumCard boardId={boardId} onError={setError} />
      <DecisionRatificationCard boardId={boardId} onError={setError} />
    </div>
  );
}

function ConflictCard({ boardId, onError }: { boardId: string; onError: (msg: string) => void }) {
  const [enrolmentId, setEnrolmentId]         = useState('');
  const [conflictTypeCode, setConflictTypeCode] = useState('');
  const [submitting, setSubmitting]           = useState(false);
  const [conflictId, setConflictId]           = useState<string | null>(null);
  const [recusing, setRecusing]               = useState(false);
  const [recused, setRecused]                 = useState(false);

  async function handleDeclare(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); onError('');
    try {
      const { conflictId: id } = await declareConflict(boardId, {
        conflictTypeCode: conflictTypeCode.trim(),
        ...(enrolmentId.trim() ? { enrolmentId: enrolmentId.trim() } : {}),
      });
      setConflictId(id);
    } catch (err) {
      onError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to declare conflict');
    } finally { setSubmitting(false); }
  }

  async function handleRecuse() {
    if (!conflictId) return;
    setRecusing(true); onError('');
    try {
      await recuseMember(conflictId);
      setRecused(true);
    } catch (err) {
      onError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to recuse member');
    } finally { setRecusing(false); }
  }

  return (
    <Card>
      <CardHeader title="Conflicts of interest" description="Declare a board member's conflict and recuse them if required." />
      <CardBody>
        {!conflictId ? (
          <form onSubmit={(e) => void handleDeclare(e)} className="grid grid-cols-2 gap-3 items-end">
            <LabelledField label="Conflict type" htmlFor="ba-conflict-type" required>
              <Input id="ba-conflict-type" value={conflictTypeCode} onChange={(e) => setConflictTypeCode(e.target.value)} placeholder="personal-relationship" />
            </LabelledField>
            <LabelledField label="Enrolment ID" htmlFor="ba-conflict-enrol" hint="Optional">
              <Input id="ba-conflict-enrol" value={enrolmentId} onChange={(e) => setEnrolmentId(e.target.value)} />
            </LabelledField>
            <div className="col-span-2">
              <Button type="submit" disabled={submitting}>{submitting ? 'Declaring…' : 'Declare conflict'}</Button>
            </div>
          </form>
        ) : recused ? (
          <p className="text-sm text-success-700">Member recused.</p>
        ) : (
          <div className="flex items-center gap-3">
            <p className="text-sm text-neutral-700">Conflict declared: <span className="font-mono text-xs">{conflictId}</span></p>
            <Button variant="secondary" size="sm" onClick={() => void handleRecuse()} disabled={recusing}>
              {recusing ? 'Recusing…' : 'Recuse member'}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function QuorumCard({ boardId, onError }: { boardId: string; onError: (msg: string) => void }) {
  const [requiredCount, setRequiredCount]   = useState('');
  const [attendingCount, setAttendingCount] = useState('');
  const [submitting, setSubmitting]         = useState(false);
  const [result, setResult]                 = useState<{ quorumDecisionId: string; quorumMet: boolean } | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); onError('');
    try {
      const res = await recordQuorumDecision(boardId, {
        requiredCount: Number(requiredCount),
        attendingCount: Number(attendingCount),
      });
      setResult(res);
    } catch (err) {
      onError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to record quorum decision');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="Quorum" />
      <CardBody>
        <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-3 gap-3 items-end">
          <LabelledField label="Required count" htmlFor="ba-req" required>
            <Input id="ba-req" type="number" min="0" value={requiredCount} onChange={(e) => setRequiredCount(e.target.value)} />
          </LabelledField>
          <LabelledField label="Attending count" htmlFor="ba-att" required>
            <Input id="ba-att" type="number" min="0" value={attendingCount} onChange={(e) => setAttendingCount(e.target.value)} />
          </LabelledField>
          <Button type="submit" disabled={submitting}>{submitting ? 'Recording…' : 'Record quorum'}</Button>
        </form>
        {result && (
          <p className={`mt-3 text-sm ${result.quorumMet ? 'text-success-700' : 'text-danger-700'}`}>
            Quorum {result.quorumMet ? 'met' : 'not met'} — <span className="font-mono text-xs">{result.quorumDecisionId}</span>
          </p>
        )}
      </CardBody>
    </Card>
  );
}

/** The short form of a pack hash for display. */
const shortHash = (h: string | null) => (h ? `${h.slice(7, 19)}…` : 'not hashed');

/**
 * The current data pack, its hash and its verification (D-36). Decisions and
 * ratification send the hash of the pack shown here, so a pack regenerated
 * elsewhere in the meantime is refused rather than decided blind.
 */
function CurrentPackPanel({ boardId, pack }: { boardId: string; pack: ExamBoardDataPack | null }) {
  const decisionTypes = useCodes('exam_board_decision', 'decision_type_code');
  const [verification, setVerification] = useState<PackVerification | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setVerification(null); }, [pack?.dataPackId]);
  if (!pack) return <StatusNotice>Generate the board's data pack (Overview) before recording a decision.</StatusNotice>;
  async function verify() {
    if (!pack) return;
    setVerifying(true); setError('');
    try { setVerification(await verifyDataPack(boardId, pack.dataPackId)); }
    catch (err) { setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Verification failed'); }
    finally { setVerifying(false); }
  }
  return (
    <div className="rounded border border-neutral-200 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span>Data pack v{pack.packVersion}, {pack.candidateCount} candidates</span>
        <span className="font-mono text-xs" title={pack.packHash ?? ''}>hash {shortHash(pack.packHash)}</span>
        <Button size="sm" variant="secondary" onClick={() => void verify()} disabled={verifying}>{verifying ? 'Verifying…' : 'Verify'}</Button>
      </div>
      {error && <p className="mt-2 text-xs text-danger-600" role="alert">{error}</p>}
      {verification && (
        <div className="mt-2 space-y-1 text-xs">
          <p>
            {verification.status === 'verified' && <span className="text-success-700">The stored pack matches its hash.</span>}
            {verification.status === 'mismatch' && <span className="text-danger-700">The stored pack no longer matches its hash; it has been altered since it was generated.</span>}
            {verification.status === 'unhashed' && <span className="text-neutral-600">This pack was generated before packs were hashed.</span>}
            {verification.manifestHashMatches === false && <span className="ml-2 text-danger-700">Its rule manifest does not match its reference.</span>}
          </p>
          {verification.drift.length > 0 && (
            <p className="text-warning-700">
              {verification.drift.length} rule version{verification.drift.length > 1 ? 's' : ''} cited by this pack's results {verification.drift.length > 1 ? 'are' : 'is'} no longer in force
              ({[...new Set(verification.drift.map((d) => d.ruleTypeCode))].join(', ')}). Recalculate and regenerate the pack if the change should apply.
            </p>
          )}
          {verification.decisions.length > 0 && (
            <p>Decisions on this pack: {verification.decisions.map((d) => `${decisionTypes.label(d.decisionTypeCode)}${d.matches ? '' : ' (different hash)'}`).join(', ')}</p>
          )}
        </div>
      )}
    </div>
  );
}

function DecisionRatificationCard({ boardId, onError }: { boardId: string; onError: (msg: string) => void }) {
  const [pack, setPack]                         = useState<ExamBoardDataPack | null>(null);
  const [decisionTypeCode, setDecisionTypeCode] = useState<BoardDecisionTypeCode>('ratify');
  const [rationale, setRationale]               = useState('');
  const [submitting, setSubmitting]             = useState(false);
  const [decisionId, setDecisionId]             = useState<string | null>(null);

  const [creatingRecord, setCreatingRecord]     = useState(false);
  const [ratificationRecordId, setRatificationRecordId] = useState<string | null>(null);
  const [publishing, setPublishing]             = useState(false);
  const [published, setPublished]               = useState(false);

  useEffect(() => { void getDataPack(boardId).then(setPack).catch(() => setPack(null)); }, [boardId]);

  async function handleDecide(e: FormEvent) {
    e.preventDefault();
    if (!pack?.packHash) return;
    setSubmitting(true); onError('');
    try {
      const { decisionId: id } = await recordBoardDecision(boardId, {
        dataPackId: pack.dataPackId,
        packHash: pack.packHash,
        decisionTypeCode,
        ...(rationale.trim() ? { rationale: rationale.trim() } : {}),
      });
      setDecisionId(id);
    } catch (err) {
      onError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to record decision');
    } finally { setSubmitting(false); }
  }

  async function handleCreateRecord() {
    if (!decisionId) return;
    setCreatingRecord(true); onError('');
    try {
      const { ratificationRecordId: id } = await createRatificationRecord(decisionId);
      setRatificationRecordId(id);
    } catch (err) {
      onError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to create ratification record');
    } finally { setCreatingRecord(false); }
  }

  async function handlePublish() {
    if (!ratificationRecordId) return;
    setPublishing(true); onError('');
    try {
      await publishResults(ratificationRecordId);
      setPublished(true);
    } catch (err) {
      onError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to publish results');
    } finally { setPublishing(false); }
  }

  return (
    <Card>
      <CardHeader title="Board decision, ratification & publication" />
      <CardBody className="space-y-4">
        <CurrentPackPanel boardId={boardId} pack={pack} />
        {!decisionId ? (
          <form onSubmit={(e) => void handleDecide(e)} className="grid grid-cols-3 gap-3 items-end">
            <LabelledField label="Decision" htmlFor="ba-decision">
              <CodeSelect entity="exam_board_decision" field="decision_type_code" id="ba-decision" value={decisionTypeCode} onChange={(v) => setDecisionTypeCode(v as BoardDecisionTypeCode)} />
            </LabelledField>
            <LabelledField label="Rationale" htmlFor="ba-rationale" hint="Optional">
              <Input id="ba-rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} />
            </LabelledField>
            <div className="col-span-3">
              <Button type="submit" disabled={submitting || !pack?.packHash}>{submitting ? 'Recording…' : 'Record decision on this pack'}</Button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-neutral-700">Decision recorded: <span className="font-mono text-xs">{decisionId}</span></p>
        )}

        {decisionId && !ratificationRecordId && (
          <Button variant="secondary" size="sm" onClick={() => void handleCreateRecord()} disabled={creatingRecord}>
            {creatingRecord ? 'Creating…' : 'Create ratification record'}
          </Button>
        )}
        {ratificationRecordId && !published && (
          <div className="flex items-center gap-3">
            <p className="text-sm text-neutral-700">Ratification record: <span className="font-mono text-xs">{ratificationRecordId}</span></p>
            <Button size="sm" onClick={() => void handlePublish()} disabled={publishing}>
              {publishing ? 'Publishing…' : 'Publish results'}
            </Button>
          </div>
        )}
        {published && <p className="text-sm text-success-700">Results published.</p>}
      </CardBody>
    </Card>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────────

function OverviewTab({
  board,
  boardId,
  onRefresh,
  canWriteBoard,
  canReadIntegrations,
  canManageIntegrations,
}: {
  board: ExamBoard;
  boardId: string;
  onRefresh: () => void;
  canWriteBoard: boolean;
  canReadIntegrations: boolean;
  canManageIntegrations: boolean;
}) {
  const boardTypes = useCodes('exam_board', 'board_type_code');
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
      {actionError && <p className="text-sm text-danger-600">{actionError}</p>}

      <Card>
        <CardHeader title="Board details" />
        <CardBody>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <InfoRow label="Type"           value={boardTypes.label(board.boardTypeCode)} />
          <InfoRow label="Academic year"  value={board.academicYear} />
          <InfoRow label="Period"         value={board.periodCode ?? board.academicPeriodId} />
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
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Data pack"
          actions={canWriteBoard && (
            <Button variant="secondary" size="sm" onClick={() => void handleGeneratePack()} disabled={generatingPack}>
              {generatingPack ? 'Generating…' : dataPack ? 'Regenerate' : 'Generate'}
            </Button>
          )}
        />
        <CardBody>
        {loadingPack ? (
          <Spinner />
        ) : dataPack ? (
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <InfoRow label="Pack ID"    value={dataPack.dataPackId} />
            <InfoRow label="Version"    value={String(dataPack.packVersion)} />
            <InfoRow label="Candidates" value={String(dataPack.candidateCount)} />
            <InfoRow label="Pack hash"  value={dataPack.packHash ?? 'Not hashed (generated before Phase 5)'} />
            <InfoRow label="Generated"  value={new Date(dataPack.generatedAt).toLocaleString('en-GB')} />
          </dl>
        ) : (
          <p className="text-sm text-neutral-600">No data pack generated yet.</p>
        )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Exam entries"
          description="Generate timetabled exam entries for all registered candidates."
          actions={canManageIntegrations && (
            <Button variant="secondary" size="sm" onClick={() => void handleGenerateEntries()} disabled={genEntries}>
              {genEntries ? 'Generating…' : 'Generate entries'}
            </Button>
          )}
        />
      </Card>

      {canReadIntegrations && <VleGradeSyncPanel canManage={canManageIntegrations} />}
    </div>
  );
}

// ── VLE grade sync panel (R-VLE-001) ─────────────────────────────────────────

function VleGradeSyncPanel({ canManage }: { canManage: boolean }) {
  const [vleRegistrationId, setVleRegistrationId] = useState<string | null>(null);
  const [healthResult,      setHealthResult]      = useState<HealthCheckResult | null>(null);
  const [checking,          setChecking]          = useState(false);
  const [error,             setError]             = useState('');

  useEffect(() => {
    listIntegrationRegistrations()
      .then(regs => {
        const vle = regs.find(r =>
          r.displayName.toLowerCase().includes('vle') || r.endpointUrl?.toLowerCase().includes('vle'),
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
      const result = await healthCheckIntegration(vleRegistrationId, 'ok');
      setHealthResult(result);
    } catch (e) {
      setError(e instanceof ApiError ? (e.detail ?? e.message) : 'Health check failed');
    } finally {
      setChecking(false);
    }
  }

  const metrics = null; // VLE connector metrics not yet exposed via health-check endpoint

  return (
    <section className="rounded-lg border border-primary-200 bg-primary-50 p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-primary-900">VLE grade sync (R-VLE-001)</h2>
        {canManage && (
          <Button
            variant="secondary"
            size="sm"
            className="border-primary-400 text-primary-800 hover:bg-primary-50"
            onClick={() => void handleCheckGradeSync()}
            disabled={checking}
          >
            {checking ? 'Checking…' : 'Check grade sync'}
          </Button>
        )}
      </div>
      <p className="text-xs text-primary-700 mb-3">
        Checks the VLE connector for unsubmitted marks and grade conflicts. If conflicts are
        detected, use the Integration Ops bulk reconciliation to replay and resolve them.
      </p>
      {error && <p className="text-xs text-danger-700 mb-2">{error}</p>}
      {healthResult && (
        <div className="rounded bg-white border border-primary-100 p-3 text-xs space-y-1">
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 font-medium ${
              healthResult.healthStatusCode === 'ok' ? 'bg-success-100 text-success-800' : 'bg-warning-100 text-warning-800'
            }`}>{healthResult.healthStatusCode ? <CodeLabel entity="integration_registration" field="health_status_code" code={healthResult.healthStatusCode} /> : 'Recorded'}</span>
            {healthResult.lastHealthCheckAt && (
              <span className="text-neutral-500">
                at {new Date(healthResult.lastHealthCheckAt).toLocaleTimeString('en-GB')}
              </span>
            )}
          </div>
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
  if (error)   return <p className="text-sm text-danger-600">{error}</p>;

  if (entries.length === 0) return <p className="text-sm text-neutral-600">No exam entries found.</p>;

  return (
    <Card>
      <Table>
        <TableHead>
          <tr>
            <TableHeaderCell>Candidate #</TableHeaderCell>
            <TableHeaderCell>Scheduled</TableHeaderCell>
            <TableHeaderCell>Room</TableHeaderCell>
            <TableHeaderCell>Status</TableHeaderCell>
            <TableHeaderCell>Accommodations</TableHeaderCell>
          </tr>
        </TableHead>
        <TableBody>
          {entries.map(e => (
            <TableRow key={e.examEntryId}>
              <TableCell className="font-mono text-xs text-neutral-700">{e.candidateNumber}</TableCell>
              <TableCell>
                {e.scheduledDate
                  ? new Date(e.scheduledDate).toLocaleDateString('en-GB')
                  : <span className="text-neutral-600">—</span>}
              </TableCell>
              <TableCell>{e.roomReference ?? <span className="text-neutral-600">—</span>}</TableCell>
              <TableCell><CodeBadge entity="exam_entry" field="status_code" code={e.statusCode} /></TableCell>
              <TableCell className="text-xs">
                {e.accommodations.length > 0 ? e.accommodations.join(', ') : <span className="text-neutral-600">—</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
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
      <p className="text-sm text-neutral-600 mb-4">
        Look up a candidate profile by enrolment ID. EC and adjustment data within profiles
        requires the <strong>special-category:read</strong> permission.
      </p>

      <form onSubmit={(e) => void handleLookup(e)} className="flex items-center gap-3 mb-6">
        <Input
          value={enrolmentId}
          onChange={(e) => setEnrolmentId(e.target.value)}
          placeholder="Enrolment ID"
          className="flex-1 max-w-xs"
        />
        <Button type="submit" disabled={loading}>{loading ? 'Loading…' : 'Look up'}</Button>
      </form>

      {error && <p className="mb-4 text-sm text-danger-600">{error}</p>}

      {profile && (
        <Card>
          <CardBody className="space-y-4">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <InfoRow label="Profile ID"   value={profile.candidateProfileId} />
            <InfoRow label="Person ID"    value={profile.personId} />
            <InfoRow label="Enrolment ID" value={profile.enrolmentId} />
            <InfoRow label="Generated"    value={new Date(profile.createdAt).toLocaleString('en-GB')} />
          </dl>

          <RequireRole roles={SPECIAL_CATEGORY_ROLES}>
            <div className="mt-4 rounded-lg bg-warning-50 border border-warning-200 p-4">
              <p className="text-xs font-semibold text-warning-800 mb-2 uppercase tracking-wide">
                Special-category data — restricted access
              </p>
              <pre className="text-xs text-neutral-700 whitespace-pre-wrap overflow-auto max-h-64">
                {JSON.stringify(profile.profileData, null, 2)}
              </pre>
            </div>
          </RequireRole>
          </CardBody>
        </Card>
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
      const pack = await getDataPack(boardId);
      if (!pack.packHash) throw new Error('Generate the data pack and record the board\'s decision first');
      await ratifyExamBoard(boardId, pack.packHash);
      setConfirmRatify(false);
      setSuccessMsg('Board ratified successfully.');
      onRefresh();
    } catch (err) {
      setActionError(err instanceof ApiError ? (err.detail ?? err.message) : err instanceof Error ? err.message : 'Ratification failed');
    } finally {
      setRatifying(false);
    }
  }

  return (
    <div className="space-y-6">
      {actionError && <p className="text-sm text-danger-600">{actionError}</p>}
      {successMsg  && <p className="text-sm text-success-600">{successMsg}</p>}

      <Card>
        <CardHeader title="External examiner sign-off" />
        <CardBody>
        {userHasAnyPermission(roles, ['exam-board:write']) ? (
        <form onSubmit={(e) => void handleSignOff(e)} className="space-y-3">
          <LabelledField label="Commentary" htmlFor="eb-commentary" hint="Optional">
            <textarea
              id="eb-commentary"
              value={commentary}
              onChange={(e) => setCommentary(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </LabelledField>
          <Button type="submit" disabled={signingOff}>{signingOff ? 'Recording…' : 'Record sign-off'}</Button>
        </form>
        ) : (
          <p className="text-sm text-neutral-600">You have read-only access to external examiner sign-off.</p>
        )}
        </CardBody>
      </Card>

      <Card>
        <CardBody>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-neutral-700">Ratification</h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Ratifying locks the board against its current data pack, on which the board must have decided to ratify. This action cannot be undone.
              {!canRatify && ' You do not have the exam-board-chair or registry-administrator role.'}
            </p>
          </div>
          {board.ratifiedAt ? (
            <Badge value="ratified" />
          ) : canRatify && (
            confirmRatify ? (
              <span className="inline-flex items-center gap-2">
                <span className="text-xs text-neutral-600">Ratify this board?</span>
                <Button
                  size="sm"
                  className="bg-success-600 hover:bg-success-700"
                  onClick={() => void handleRatify()}
                  disabled={ratifying}
                >
                  {ratifying ? 'Ratifying…' : 'Confirm ratify'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmRatify(false)}>Cancel</Button>
              </span>
            ) : (
              <Button size="sm" className="bg-success-600 hover:bg-success-700" onClick={() => setConfirmRatify(true)}>
                Ratify board
              </Button>
            )
          )}
        </div>
        {board.ratifiedAt && (
          <p className="mt-2 text-xs text-neutral-500">
            Ratified {new Date(board.ratifiedAt).toLocaleString('en-GB')}
          </p>
        )}
        </CardBody>
      </Card>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 flex-shrink-0 text-neutral-500 text-xs pt-0.5">{label}</dt>
      <dd className="text-neutral-900 text-xs">{value ?? <span className="text-neutral-600">—</span>}</dd>
    </div>
  );
}
