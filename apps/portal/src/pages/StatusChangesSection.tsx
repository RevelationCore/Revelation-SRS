import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardBody, Button, Input, Select, LabelledField, Badge, StatusNotice, formatDate } from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import {
  type MyStatusCase, type StatusCaseOptions, type ValueSetDto,
  getFieldValueSet, getStatusCaseOptions, listCatalogueProgrammes, listMyStatusCases, requestStatusCase, withdrawMyStatusCase,
} from '../api/me.js';

const TYPE_LABELS: Record<string, string> = {
  interruption: 'Take a break from my studies (interruption)',
  return: 'Return from my interruption',
  withdrawal: 'Leave my course (withdrawal)',
  transfer: 'Change my course or mode of study (transfer)',
  suspension: 'Suspension',
  'leaver-closure': 'Leaver closure',
};
const SHORT_LABELS: Record<string, string> = {
  interruption: 'Interruption', return: 'Return', withdrawal: 'Withdrawal', transfer: 'Transfer', suspension: 'Suspension', 'leaver-closure': 'Leaver closure',
};
const STATUS_LABELS: Record<string, string> = { requested: 'Awaiting a decision', approved: 'Approved', rejected: 'Not approved', withdrawn: 'Withdrawn' };

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? (err.detail ?? err.message) : fallback;
}

/**
 * Ask to interrupt, return, withdraw or transfer (BP-02-006 to 009; D-2).
 * Only what the enrolment allows now is offered. Before a withdrawal or an
 * interruption the student is told it can affect their funding; a sponsored
 * student is told the university must report the change to UKVI. Only a
 * reason category is collected: evidence goes through exceptional
 * circumstances or adjustments.
 */
export function StatusChangesSection({ enrolmentId, modeOfStudyCode }: { enrolmentId: string; modeOfStudyCode: string }) {
  const [options, setOptions] = useState<StatusCaseOptions | null>(null);
  const [cases, setCases] = useState<MyStatusCase[]>([]);
  const [error, setError] = useState('');
  const [requesting, setRequesting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [o, c] = await Promise.all([getStatusCaseOptions(enrolmentId), listMyStatusCases(enrolmentId)]);
      setOptions(o); setCases(c);
    } catch (err) { setError(message(err, 'We could not load your study status changes.')); }
  }, [enrolmentId]);
  useEffect(() => { void load(); }, [load]);

  if (error) return <p className="text-sm text-danger-600" role="alert">{error}</p>;
  if (!options) return null;
  const open = cases.find((c) => c.statusCaseId === options.openCaseId);

  return (
    <Card>
      <CardHeader title="Changes to my studies" description="Ask to take a break, return, leave or change course. The registry decides; your record changes only if your request is approved." />
      <CardBody>
        <div className="flex flex-col gap-4">
          {cases.length > 0 && (
            <ul className="flex flex-col gap-2">
              {cases.map((c) => (
                <li key={c.statusCaseId} className="rounded border border-neutral-200 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{SHORT_LABELS[c.caseTypeCode] ?? c.caseTypeCode}</span>
                    <Badge value={c.statusCode === 'requested' ? 'pending' : c.statusCode} label={STATUS_LABELS[c.statusCode] ?? c.statusCode} />
                    <span className="text-neutral-600">from {formatDate(c.approvedEffectiveDate ?? c.requestedEffectiveDate)}</span>
                  </div>
                  {c.decisionReason && <p className="mt-1 text-neutral-700">{c.decisionReason}</p>}
                </li>
              ))}
            </ul>
          )}

          {open ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm">Your {SHORT_LABELS[open.caseTypeCode]?.toLowerCase()} request is waiting for a decision.</p>
              {open.initiatedByCode === 'student' && (
                <Button size="sm" variant="secondary" onClick={() => void withdrawMyStatusCase(open.statusCaseId).then(load).catch((err: unknown) => setError(message(err, 'We could not withdraw your request.')))}>
                  Withdraw my request
                </Button>
              )}
            </div>
          ) : options.requestableTypes.length === 0 ? (
            <p className="text-sm text-neutral-600">There is nothing you can request for this enrolment at the moment.</p>
          ) : requesting ? (
            <RequestFlow options={options} enrolmentId={enrolmentId} modeOfStudyCode={modeOfStudyCode} onDone={() => { setRequesting(false); void load(); }} onCancel={() => setRequesting(false)} />
          ) : (
            <div><Button onClick={() => setRequesting(true)}>Request a change</Button></div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function RequestFlow({ options, enrolmentId, modeOfStudyCode, onDone, onCancel }: {
  options: StatusCaseOptions; enrolmentId: string; modeOfStudyCode: string; onDone: () => void; onCancel: () => void;
}) {
  const [type, setType] = useState(options.requestableTypes[0] ?? '');
  const [reason, setReason] = useState('');
  const [effective, setEffective] = useState('');
  const [expectedReturn, setExpectedReturn] = useState('');
  const [programmeId, setProgrammeId] = useState('');
  const [mode, setMode] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [reasons, setReasons] = useState<ValueSetDto | null>(null);
  const [modes, setModes] = useState<ValueSetDto | null>(null);
  const [programmes, setProgrammes] = useState<Array<{ programmeId: string; code: string; title: string }>>([]);

  useEffect(() => {
    getFieldValueSet('student_status_case', 'reason_category_code').then(setReasons).catch(() => undefined);
    getFieldValueSet('enrolment', 'mode_of_study_code').then(setModes).catch(() => undefined);
    listCatalogueProgrammes().then(setProgrammes).catch(() => undefined);
  }, []);

  const fundingNotice = type === 'withdrawal' || type === 'interruption';
  const visaNotice = options.sponsored && (type === 'withdrawal' || type === 'interruption' || (type === 'transfer' && mode !== '' && mode !== modeOfStudyCode));
  const needsConfirmation = fundingNotice || visaNotice;
  const complete = type && effective
    && (type !== 'interruption' || expectedReturn)
    && (type !== 'transfer' || programmeId || mode);

  async function send() {
    setError('');
    try {
      await requestStatusCase(enrolmentId, {
        caseTypeCode: type, requestedEffectiveDate: effective,
        ...(reason ? { reasonCategoryCode: reason } : {}),
        ...(type === 'interruption' ? { expectedReturnDate: expectedReturn } : {}),
        ...(type === 'transfer' && programmeId ? { destinationProgrammeId: programmeId } : {}),
        ...(type === 'transfer' && mode ? { destinationModeOfStudyCode: mode } : {}),
        ...(type === 'return' && options.returnFrom ? { relatedCaseId: options.returnFrom.statusCaseId } : {}),
      });
      onDone();
    } catch (err) { setConfirming(false); setError(message(err, 'We could not send your request.')); }
  }

  function next(e: FormEvent) {
    e.preventDefault();
    if (needsConfirmation) setConfirming(true); else void send();
  }

  if (confirming) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium">Before you send this request</p>
        {fundingNotice && (
          <StatusNotice>
            {type === 'withdrawal' ? 'Leaving your course' : 'Taking a break'} can change your student finance payments and the tuition fees you owe. Talk to Student Support or your funding body before you go ahead.
          </StatusNotice>
        )}
        {visaNotice && (
          <StatusNotice>
            You are studying on a Student visa. The university must tell UK Visas and Immigration about this change within 10 working days, and your permission to stay in the UK may be cancelled or shortened. Please speak to the international student advice team first.
          </StatusNotice>
        )}
        <div className="flex gap-2">
          <Button onClick={() => void send()}>Send my request</Button>
          <Button variant="ghost" onClick={() => setConfirming(false)}>Back</Button>
        </div>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={next}>
      {error && <p className="text-sm text-danger-600" role="alert">{error}</p>}
      <LabelledField label="What do you want to request?" htmlFor="sc-type" required>
        <Select id="sc-type" value={type} onChange={(e) => setType(e.target.value)}>
          {options.requestableTypes.map((t) => <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>)}
        </Select>
      </LabelledField>

      {type === 'return' && options.returnFrom && (
        <div className="text-sm">
          <p>You are returning from the break that started {formatDate(options.returnFrom.approvedEffectiveDate)}.</p>
          {options.returnFrom.outstandingConditions.length > 0 && (
            <>
              <p className="mt-1">Before you can return, these must be met:</p>
              <ul className="ml-5 list-disc">{options.returnFrom.outstandingConditions.map((c) => <li key={c.conditionId}>{c.description}</li>)}</ul>
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <LabelledField label={type === 'return' ? 'Date you want to return' : 'Date you want this to start'} htmlFor="sc-effective" required>
          <Input id="sc-effective" type="date" value={effective} onChange={(e) => setEffective(e.target.value)} />
        </LabelledField>
        {type === 'interruption' && (
          <LabelledField label="Date you expect to come back" htmlFor="sc-return" required>
            <Input id="sc-return" type="date" value={expectedReturn} onChange={(e) => setExpectedReturn(e.target.value)} />
          </LabelledField>
        )}
        {type !== 'return' && (
          <LabelledField label="Main reason" htmlFor="sc-reason" hint="You do not need to give details or evidence here">
            <Select id="sc-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Prefer not to say</option>
              {(reasons?.members ?? []).map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
            </Select>
          </LabelledField>
        )}
        {type === 'transfer' && (
          <>
            <LabelledField label="Course you want to move to" htmlFor="sc-programme">
              <Select id="sc-programme" value={programmeId} onChange={(e) => setProgrammeId(e.target.value)}>
                <option value="">Stay on my course</option>
                {programmes.map((p) => <option key={p.programmeId} value={p.programmeId}>{p.code} — {p.title}</option>)}
              </Select>
            </LabelledField>
            <LabelledField label="Mode of study" htmlFor="sc-mode">
              <Select id="sc-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="">Keep my current mode</option>
                {(modes?.members ?? []).map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
              </Select>
            </LabelledField>
          </>
        )}
      </div>
      {type === 'transfer' && programmeId && <p className="text-sm text-neutral-700">Both your current course and the new course must agree to a transfer.</p>}
      <p className="text-sm text-neutral-600">If you have evidence such as medical notes, submit it through exceptional circumstances or adjustments instead.</p>
      <div className="flex gap-2">
        <Button type="submit" disabled={!complete}>{needsConfirmation ? 'Continue' : 'Send my request'}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
