import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, Card, CardHeader, CardBody, Button, Input, Select, Textarea, Checkbox, LabelledField, Badge, Spinner, StatusNotice } from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import {
  type ClearingDeclarations, type ClearingReview, type ClearingStatus,
  getClearingStatus, listClearingReviews, reviewClearingDecision, takeClearingCall,
} from '../api/applications.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { useValueSet } from '../hooks/useValueSet.js';
import { programmeLabel, useProgrammeNames } from './ApplicationsPage.js';

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? (err.detail ?? err.message) : fallback;
}
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

const DECLARATIONS: Array<{ key: keyof ClearingDeclarations; label: string }> = [
  { key: 'safeguardingConcern', label: 'There is a safeguarding concern' },
  { key: 'convictionDeclared', label: 'The applicant has declared a relevant conviction' },
  { key: 'fitnessToPractiseRequired', label: 'The course needs a fitness-to-practise check' },
  { key: 'studentVisaRequired', label: 'The applicant needs a Student visa (CAS)' },
];
const NO_DECLARATIONS: ClearingDeclarations = { safeguardingConcern: false, convictionDeclared: false, fitnessToPractiseRequired: false, studentVisaRequired: false };

/**
 * Clearing (BP-01-006; D-13). While the window is open, take a call to an
 * offer in one step for a programme open in Clearing; every such decision is
 * reviewed by a different programme approver by the next working day.
 */
export function ClearingPage() {
  const { roles } = useAuth();
  const canDecide = userHasAnyPermission(roles, ['clearing:decide']);
  const canReview = userHasAnyPermission(roles, ['clearing:review']);
  const programmes = useProgrammeNames();
  const [status, setStatus] = useState<ClearingStatus | null>(null);
  const [reviews, setReviews] = useState<ClearingReview[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([getClearingStatus(), listClearingReviews(true)]);
      setStatus(s); setReviews(r);
    } catch (err) { setError(message(err, 'Failed to load Clearing')); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (error) return <p className="text-sm text-danger-600" role="alert">{error}</p>;
  if (!status) return <div className="flex justify-center py-16"><Spinner /></div>;

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Applications', to: '/applications' }]}
        title="Clearing"
        description="Take a Clearing call to an offer in one step. Applicants with a safeguarding, conviction, fitness-to-practise or visa need go through the standard route."
        actions={<Badge value={status.open ? 'approved' : 'rejected'} label={status.open ? 'Window open' : 'Window closed'} />}
      />
      <div className="flex flex-col gap-6">
        {!status.open && (
          <StatusNotice>
            {status.opensAt && status.closesAt
              ? `The Clearing window runs from ${when(status.opensAt)} to ${when(status.closesAt)}.`
              : 'No Clearing window is set. A tenant administrator sets it in tenant configuration (clearing.opensAt, clearing.closesAt, clearing.programmeIds).'}
          </StatusNotice>
        )}
        {canDecide && status.open && (
          <CallForm status={status} programmeName={(id) => programmeLabel(programmes, id)} programmeIds={status.programmeIds} onTaken={() => void load()} />
        )}
        <Card>
          <CardHeader title="Decisions waiting for review" description="A different programme approver reviews each Clearing decision by the next working day. A correction is made by changing the offer, with a reason." />
          {reviews.length === 0 ? <p className="px-6 pb-6 text-sm text-neutral-600">Nothing is waiting for review.</p> : (
            <CardBody>
              <ul className="flex flex-col gap-4">
                {reviews.map((r) => <ReviewItem key={r.caseId} item={r} canReview={canReview} programmeName={programmeLabel(programmes, r.programmeId)} onDone={() => void load()} />)}
              </ul>
            </CardBody>
          )}
        </Card>
      </div>
    </div>
  );
}

function CallForm({ status, programmeIds, programmeName, onTaken }: { status: ClearingStatus; programmeIds: string[]; programmeName: (id: string) => string; onTaken: () => void }) {
  const { members: modes } = useValueSet('enrolment', 'mode_of_study_code');
  const empty = {
    callReference: '', reason: '', cycle: String(new Date().getFullYear()), ucasPersonalId: '', legalFirstName: '', legalFamilyName: '', dateOfBirth: '', emailPersonal: '',
    programmeId: '', intakeCode: '', modeOfStudyCode: '', offerTypeCode: 'clearing-verbal' as 'clearing-verbal' | 'unconditional',
  };
  const [form, setForm] = useState(empty);
  const [declarations, setDeclarations] = useState<ClearingDeclarations>(NO_DECLARATIONS);
  const [error, setError] = useState('');
  const [taken, setTaken] = useState<string | null>(null);
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const blocked = Object.values(declarations).some(Boolean);
  const ready = form.callReference.trim() && form.reason.trim() && form.legalFirstName.trim() && form.legalFamilyName.trim()
    && form.programmeId && /^\d{4}-\d{2}$/.test(form.intakeCode) && form.modeOfStudyCode && !blocked;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(''); setTaken(null);
    try {
      const result = await takeClearingCall({
        callReference: form.callReference.trim(), reason: form.reason.trim(), cycle: form.cycle.trim(),
        ...(form.ucasPersonalId.trim() ? { ucasPersonalId: form.ucasPersonalId.trim() } : {}),
        applicant: {
          legalFirstName: form.legalFirstName.trim(), legalFamilyName: form.legalFamilyName.trim(),
          ...(form.dateOfBirth ? { dateOfBirth: form.dateOfBirth } : {}), ...(form.emailPersonal.trim() ? { emailPersonal: form.emailPersonal.trim() } : {}),
        },
        programmeId: form.programmeId, intakeCode: form.intakeCode, modeOfStudyCode: form.modeOfStudyCode, declarations,
        offer: { offerTypeCode: form.offerTypeCode },
      });
      setTaken(result.application.id);
      setForm(empty); setDeclarations(NO_DECLARATIONS);
      onTaken();
    } catch (err) { setError(message(err, 'The Clearing decision failed')); }
  }

  return (
    <Card>
      <CardHeader title="Take a Clearing call" description={`A verbal offer is held for ${status.verbalOfferHours} hours.`} />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600" role="alert">{error}</p>}
        {taken && <p className="mb-3 text-sm text-success-700" role="status">Offer recorded. <Link to={`/applications/${taken}`} className="text-primary-600 hover:underline">Open the application</Link></p>}
        <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <LabelledField label="Call reference" htmlFor="clr-call" required><Input id="clr-call" value={form.callReference} onChange={set('callReference')} /></LabelledField>
            <LabelledField label="UCAS personal ID" htmlFor="clr-ucas" hint="10 digits, if they have one"><Input id="clr-ucas" value={form.ucasPersonalId} onChange={set('ucasPersonalId')} /></LabelledField>
            <LabelledField label="Cycle" htmlFor="clr-cycle" required><Input id="clr-cycle" value={form.cycle} onChange={set('cycle')} /></LabelledField>
            <LabelledField label="First name" htmlFor="clr-first" required><Input id="clr-first" value={form.legalFirstName} onChange={set('legalFirstName')} /></LabelledField>
            <LabelledField label="Family name" htmlFor="clr-family" required><Input id="clr-family" value={form.legalFamilyName} onChange={set('legalFamilyName')} /></LabelledField>
            <LabelledField label="Date of birth" htmlFor="clr-dob"><Input id="clr-dob" type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} /></LabelledField>
            <LabelledField label="Programme" htmlFor="clr-programme" required>
              <Select id="clr-programme" value={form.programmeId} onChange={set('programmeId')}>
                <option value="">Choose…</option>
                {programmeIds.map((id) => <option key={id} value={id}>{programmeName(id)}</option>)}
              </Select>
            </LabelledField>
            <LabelledField label="Intake" htmlFor="clr-intake" required hint="Year and month, e.g. 2027-09"><Input id="clr-intake" value={form.intakeCode} onChange={set('intakeCode')} /></LabelledField>
            <LabelledField label="Mode of study" htmlFor="clr-mode" required>
              <Select id="clr-mode" value={form.modeOfStudyCode} onChange={set('modeOfStudyCode')}>
                <option value="">Choose…</option>
                {modes.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
              </Select>
            </LabelledField>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-neutral-800">Checks</legend>
            {DECLARATIONS.map((d) => (
              <label key={d.key} className="flex items-center gap-2 text-sm" htmlFor={`clr-${d.key}`}>
                <Checkbox id={`clr-${d.key}`} checked={declarations[d.key]} onChange={(e) => setDeclarations((x) => ({ ...x, [d.key]: e.target.checked }))} />
                {d.label}
              </label>
            ))}
            {blocked && <p className="text-sm text-danger-700" role="status">This applicant cannot be decided through the Clearing fast path. Record the application and use the standard route.</p>}
          </fieldset>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <LabelledField label="Offer" htmlFor="clr-offer" required>
              <Select id="clr-offer" value={form.offerTypeCode} onChange={(e) => setForm((f) => ({ ...f, offerTypeCode: e.target.value as 'clearing-verbal' | 'unconditional' }))}>
                <option value="clearing-verbal">Verbal offer (held for {status.verbalOfferHours} hours)</option>
                <option value="unconditional">Unconditional offer</option>
              </Select>
            </LabelledField>
            <div className="md:col-span-2">
              <LabelledField label="Reason" htmlFor="clr-reason" required hint="Which published Clearing criteria the applicant meets">
                <Textarea id="clr-reason" rows={2} value={form.reason} onChange={set('reason')} />
              </LabelledField>
            </div>
          </div>
          <div><Button type="submit" disabled={!ready}>Make the offer</Button></div>
        </form>
      </CardBody>
    </Card>
  );
}

function ReviewItem({ item, canReview, programmeName, onDone }: { item: ClearingReview; canReview: boolean; programmeName: string; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const overdue = new Date() > new Date(item.reviewDueBy);
  async function review(outcomeCode: 'upheld' | 'correction-needed') {
    setError('');
    try { await reviewClearingDecision(item.caseId, { outcomeCode, ...(note.trim() ? { note: note.trim() } : {}) }); onDone(); } catch (err) { setError(message(err, 'The review failed')); }
  }
  return (
    <li className="rounded-md border border-neutral-200 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link to={`/applications/${item.applicationId}`} className="font-medium text-primary-600 hover:underline">{item.sourceReference}</Link>
        <Badge value={overdue ? 'rejected' : 'pending'} label={overdue ? 'Review overdue' : `Review by ${when(item.reviewDueBy)}`} />
      </div>
      <p className="mt-1 text-sm text-neutral-700">
        {programmeName} · {item.offerTypeCode === 'clearing-verbal' ? `verbal offer${item.expiresOn ? `, held until ${item.expiresOn}` : ''}` : 'unconditional offer'} · decided by {item.decidedBy} {when(item.decidedAt)}
      </p>
      {error && <p className="mt-2 text-sm text-danger-600" role="alert">{error}</p>}
      {canReview && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <LabelledField label={`Note on ${item.sourceReference}`} htmlFor={`clr-note-${item.caseId}`} hint="Needed if a correction is required">
            <Input id={`clr-note-${item.caseId}`} value={note} onChange={(e) => setNote(e.target.value)} />
          </LabelledField>
          <Button size="sm" onClick={() => void review('upheld')}>Uphold</Button>
          <Button size="sm" variant="secondary" disabled={!note.trim()} onClick={() => void review('correction-needed')}>Needs correction</Button>
        </div>
      )}
    </li>
  );
}
