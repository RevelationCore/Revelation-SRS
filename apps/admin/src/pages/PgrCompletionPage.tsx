import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Card, CardHeader, CardBody, Button, PageHeader, LabelledField, Input, Badge,
} from '@revelation-srs/ui';
import {
  type CompletionCase,
  type FinalThesisDeposit,
  openCompletionCase,
  getCompletionCase,
  recordFinalDeposit,
  getFinalDeposit,
  recordCompletion,
  conferResearchAward,
} from '../api/pgr.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { ApiError } from '../api/client.js';

export function PgrCompletionPage() {
  const [completionCase, setCompletionCase] = useState<CompletionCase | null>(null);

  return (
    <div>
      <PageHeader
        title="PGR completion"
        description="Record final thesis deposit, confirm completion, and confer the research award."
      />
      <div className="space-y-6 mt-4">
        {!completionCase && <OpenCompletionForm onOpened={setCompletionCase} />}
        {completionCase && (
          <CompletionWorkspace
            completionCase={completionCase}
            onRefresh={setCompletionCase}
            onStartNew={() => setCompletionCase(null)}
          />
        )}
      </div>
    </div>
  );
}

function OpenCompletionForm({ onOpened }: { onOpened: (c: CompletionCase) => void }) {
  const { user } = useAuth();
  const [examinationCaseId, setExaminationCaseId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      const { completionCaseId } = await openCompletionCase({
        examinationCaseId: examinationCaseId.trim(),
        ownerId: user?.sub ?? '',
      });
      onOpened(await getCompletionCase(completionCaseId));
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to open completion case');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="Open a completion case" description="Requires a ratified, corrections-complete pass outcome on the examination case." />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-2 gap-3 items-end">
          <LabelledField label="Examination case ID" htmlFor="comp-exam-case" required>
            <Input id="comp-exam-case" value={examinationCaseId} onChange={(e) => setExaminationCaseId(e.target.value)} />
          </LabelledField>
          <div className="col-span-2">
            <Button type="submit" disabled={submitting}>{submitting ? 'Opening…' : 'Open completion case'}</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function CompletionWorkspace({
  completionCase, onRefresh, onStartNew,
}: {
  completionCase: CompletionCase;
  onRefresh:      (c: CompletionCase) => void;
  onStartNew:     () => void;
}) {
  const { roles } = useAuth();
  const canDecide = userHasAnyPermission(roles, ['pgr-case:decide']);
  const canConfer = userHasAnyPermission(roles, ['award:confer:research']);
  const [deposit, setDeposit] = useState<FinalThesisDeposit | null>(null);
  const [error, setError]     = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [detail, depositRecord] = await Promise.all([
        getCompletionCase(completionCase.completionCaseId),
        getFinalDeposit(completionCase.completionCaseId),
      ]);
      onRefresh(detail);
      setDeposit(depositRecord);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load completion case');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completionCase.completionCaseId]);

  useEffect(() => { void load(); }, [load]);

  const status = completionCase.statusCode;
  const isOpen = status === 'open';
  const isCompleted = status === 'completed';
  const isAwarded = status === 'award-conferred';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={`Completion ${completionCase.completionCaseId.slice(0, 8)}…`}
          actions={
            <div className="flex items-center gap-2">
              <Badge value={status} />
              <Button variant="ghost" size="sm" onClick={onStartNew}>Start a new completion</Button>
            </div>
          }
        />
        <CardBody>
          {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
          <InfoRow label="Enrolment" value={completionCase.enrolmentId} mono />
          <InfoRow label="Examination case" value={completionCase.examinationCaseId} mono />
        </CardBody>
      </Card>

      {isOpen && !deposit && <DepositForm completionCaseId={completionCase.completionCaseId} onRecorded={load} />}

      {deposit && (
        <Card>
          <CardHeader title="Final thesis deposit" />
          <CardBody>
            <InfoRow label="Deposit reference" value={deposit.depositRef} mono />
            <InfoRow label="IP declarations" value={deposit.ipDeclarationConfirmed ? 'Confirmed' : 'Not confirmed'} />
            <InfoRow label="Confirmed" value={new Date(deposit.confirmedAt).toLocaleString('en-GB')} />
          </CardBody>
        </Card>
      )}

      {isOpen && deposit && canDecide && (
        <RecordCompletionPanel completionCaseId={completionCase.completionCaseId} onRecorded={load} />
      )}

      {isCompleted && canConfer && (
        <ConferAwardForm completionCaseId={completionCase.completionCaseId} onConferred={load} />
      )}

      {isAwarded && (
        <Card>
          <CardBody>
            <p className="text-sm text-success-700">Research award conferred. Supervision has been closed.</p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function DepositForm({ completionCaseId, onRecorded }: { completionCaseId: string; onRecorded: () => void }) {
  const [depositRef, setDepositRef] = useState('');
  const [ipDeclarationConfirmed, setIpDeclarationConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      await recordFinalDeposit(completionCaseId, { depositRef: depositRef.trim(), ipDeclarationConfirmed });
      onRecorded();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to record deposit');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="Record final thesis deposit" />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-2 gap-3 items-end">
          <LabelledField label="Deposit reference" htmlFor="comp-deposit-ref" required>
            <Input id="comp-deposit-ref" value={depositRef} onChange={(e) => setDepositRef(e.target.value)} placeholder="repo://final/..." />
          </LabelledField>
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" checked={ipDeclarationConfirmed} onChange={(e) => setIpDeclarationConfirmed(e.target.checked)} />
            IP declarations confirmed
          </label>
          <div className="col-span-2">
            <Button type="submit" disabled={submitting}>{submitting ? 'Recording…' : 'Record deposit'}</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function RecordCompletionPanel({ completionCaseId, onRecorded }: { completionCaseId: string; onRecorded: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');

  async function handleClick() {
    setSubmitting(true); setError('');
    try {
      await recordCompletion(completionCaseId);
      onRecorded();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to record completion');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="Record candidature completion" />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <Button disabled={submitting} onClick={() => void handleClick()}>
          {submitting ? 'Recording…' : 'Record completion'}
        </Button>
      </CardBody>
    </Card>
  );
}

function ConferAwardForm({ completionCaseId, onConferred }: { completionCaseId: string; onConferred: () => void }) {
  const [qualificationCode, setQualificationCode] = useState('PhD');
  const [awardDate, setAwardDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      await conferResearchAward(completionCaseId, { qualificationCode: qualificationCode.trim(), awardDate: awardDate.trim() });
      onConferred();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to confer award');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="Confer research award" />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-2 gap-3 items-end">
          <LabelledField label="Qualification" htmlFor="comp-qualification" required>
            <Input id="comp-qualification" value={qualificationCode} onChange={(e) => setQualificationCode(e.target.value)} placeholder="PhD" />
          </LabelledField>
          <LabelledField label="Award date" htmlFor="comp-award-date" required>
            <Input id="comp-award-date" type="date" value={awardDate} onChange={(e) => setAwardDate(e.target.value)} />
          </LabelledField>
          <div className="col-span-2">
            <Button type="submit" disabled={submitting}>{submitting ? 'Conferring…' : 'Confer award'}</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function InfoRow({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-40 flex-shrink-0 text-neutral-500 text-xs pt-0.5">{label}</dt>
      <dd className={`text-neutral-900 text-xs ${mono ? 'font-mono' : ''}`}>{value ?? <span className="text-neutral-600">—</span>}</dd>
    </div>
  );
}
