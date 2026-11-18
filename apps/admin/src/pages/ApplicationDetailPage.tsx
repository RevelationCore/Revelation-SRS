import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  PageHeader, Card, CardHeader, CardBody, Button, Input, Select, Textarea, Checkbox, LabelledField, Badge, Spinner, StatusNotice, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, CodeBadge, CodeLabel, CodeSelect, useCodes,
} from '@revelation-srs/ui';
import type { Permission } from '@revelation-srs/domain';

import { ApiError } from '../api/client.js';
import {
  type ApplicationDetail, type ConditionInput, type EnrolmentConversion, type Offer, type OfferCondition,
  confirmSuggestedMet, convertToEnrolment, getEnrolmentConversion,
  getApplication, confirmIdentity, routeApplication, recordAssessment, recommendApplication, decideApplication,
  recordOfferResponse, changeOffer, withdrawOffer, confirmOffer, recordConditionEvidence, decideCondition,
} from '../api/applications.js';
import { type CasCase, listCasCaseWorklist, openCasCaseForApplication } from '../api/casCases.js';
import { useAuth } from '../auth/AuthContext.js';
import { CasCasePanel } from '../components/CasCasePanel.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { useValueSet } from '../hooks/useValueSet.js';
import { programmeLabel, useProgrammeNames } from './ApplicationsPage.js';

const OPEN_OFFER = ['made', 'accepted'];

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? (err.detail ?? err.message) : fallback;
}

/**
 * One application from receipt to confirmation (BP-01-001 to BP-01-004).
 * Every action calls the API, which enforces the rules (certain identity,
 * the recommender cannot decide, conditions met only on verified
 * evidence); the page shows only the actions open at each stage.
 */
export function ApplicationDetailPage() {
  const { applicationId } = useParams<{ applicationId: string }>();
  const { roles, user } = useAuth();
  const [app, setApp] = useState<ApplicationDetail | null>(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const programmes = useProgrammeNames();

  const load = useCallback(async () => {
    if (!applicationId) return;
    try {
      setApp(await getApplication(applicationId));
    } catch (err) {
      setError(message(err, 'Failed to load the application'));
    }
  }, [applicationId]);
  useEffect(() => { void load(); }, [load]);

  /** Runs an action, then reloads; an API refusal is shown and the page is left as it was. */
  const act = useCallback(async (run: () => Promise<unknown>): Promise<boolean> => {
    setActionError('');
    try {
      await run();
      await load();
      return true;
    } catch (err) {
      setActionError(message(err, 'The action failed'));
      return false;
    }
  }, [load]);

  if (error) return <p className="text-sm text-danger-600" role="alert">{error}</p>;
  if (!app) return <div className="flex justify-center py-16"><Spinner /></div>;

  const can = (permission: Permission) => userHasAnyPermission(roles, [permission]);
  const canWrite = can('application:write');
  const canAssess = can('application:assess');
  const canDecide = can('offer:decide');
  const canReceive = can('application:receive');
  const offers = [...app.offers].sort((a, b) => b.version - a.version);
  const assessable = Boolean(app.personId) && ['received', 'under-assessment'].includes(app.statusCode);

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Applications', to: '/applications' }]}
        title={`${app.channelCode.toUpperCase()} ${app.sourceReference}`}
        description={`Cycle ${app.cycle}`}
        actions={<CodeBadge entity="student_application" field="status_code" code={app.statusCode} />}
      />

      {actionError && <p className="mb-4 text-sm text-danger-600" role="alert">{actionError}</p>}

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader title="Application" />
          <CardBody>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
              <Fact label="Programme">{programmeLabel(programmes, app.programmeId)}</Fact>
              <Fact label="Intake">{app.intakeCode ?? 'Not yet known'}</Fact>
              <Fact label="Mode of study"><CodeLabel entity="student_application" field="mode_of_study_code" code={app.modeOfStudyCode} empty="Not yet known" /></Fact>
              <Fact label="Applicant">
                {app.personId
                  ? <Link to={`/students/${app.personId}`} className="text-primary-600 hover:underline">{app.identityMatchCode === 'created' ? 'New person record' : 'Matched person record'}</Link>
                  : 'Identity not confirmed'}
              </Fact>
              <Fact label="Worklist"><CodeLabel entity="student_application" field="routing_reason_code" code={app.routingReasonCode} empty="None" /></Fact>
              <Fact label="Received">{new Date(app.createdAt).toLocaleString('en-GB')}</Fact>
            </dl>
            {app.statusCode === 'incomplete' && !app.programmeId && (
              <p className="mt-4 text-sm text-neutral-600">
                The channel has not yet sent a recognised programme, intake or mode of study. The application stays incomplete until it does.
              </p>
            )}
          </CardBody>
        </Card>

        {canWrite && app.identityMatchCode === 'needs-review' && (
          <IdentityCard onConfirm={(personId) => act(() => confirmIdentity(app.id, personId))} />
        )}

        {canWrite && !['rejected', 'offered', 'withdrawn'].includes(app.statusCode) && (
          <RoutingCard current={app.routingReasonCode} onRoute={(reason) => act(() => routeApplication(app.id, reason))} />
        )}

        <Card>
          <CardHeader title="Assessments" description="Each assessment is kept with its assessor and evidence version; a safeguarding concern blocks an offer recommendation." />
          <CardBody>
            {app.assessments.length === 0 ? <p className="text-sm text-neutral-600">No assessments yet.</p> : (
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Type</TableHeaderCell><TableHeaderCell>Outcome</TableHeaderCell>
                    <TableHeaderCell>Evidence</TableHeaderCell><TableHeaderCell>By</TableHeaderCell><TableHeaderCell>When</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {app.assessments.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell><CodeLabel entity="application_assessment" field="assessment_type_code" code={a.assessmentTypeCode} /></TableCell>
                      <TableCell><CodeBadge entity="application_assessment" field="outcome_code" code={a.outcomeCode} /></TableCell>
                      <TableCell className="text-xs">{a.evidenceRef ? `${a.evidenceRef}${a.evidenceVersion ? ` (v${a.evidenceVersion})` : ''}` : '—'}</TableCell>
                      <TableCell className="text-xs">{a.assessedBy}</TableCell>
                      <TableCell className="text-xs">{new Date(a.assessedAt).toLocaleString('en-GB')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {canAssess && assessable && <AssessmentForm onSubmit={(body) => act(() => recordAssessment(app.id, body))} />}
            {canAssess && !app.personId && <p className="mt-4 text-sm text-neutral-600">Confirm the applicant identity before assessing.</p>}
          </CardBody>
        </Card>

        {canWrite && app.statusCode === 'under-assessment' && (
          <RecommendationCard onSubmit={(body) => act(() => recommendApplication(app.id, body))} />
        )}

        {app.statusCode === 'recommended' && (
          <DecisionCard
            app={app}
            canDecide={canDecide}
            isRecommender={app.recommendedBy === user?.sub}
            onSubmit={(body) => act(() => decideApplication(app.id, body))}
          />
        )}

        {can('cas:read') && app.personId && offers.some((o) => ['made', 'accepted', 'confirmed'].includes(o.statusCode)) && (
          <CasCard applicationId={app.id} canOpen={can('cas:prepare')} />
        )}

        {can('enrolment:write') && offers.some((o) => o.statusCode === 'confirmed') && (
          <ConversionCard applicationId={app.id} programmeName={(id) => programmeLabel(programmes, id)} />
        )}

        {offers.map((offer) => (
          <OfferCard
            key={offer.id}
            offer={offer}
            programmeName={programmeLabel(programmes, offer.programmeId)}
            canDecide={canDecide}
            canReceive={canReceive}
            act={act}
          />
        ))}
      </div>
    </div>
  );
}

/** The applicant's Student visa CAS (D-16): opened here, worked on the UKVI page or here. */
function CasCard({ applicationId, canOpen }: { applicationId: string; canOpen: boolean }) {
  const [cases, setCases] = useState<CasCase[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setCases(await listCasCaseWorklist({ applicationId })); } catch (err) { setError(message(err, 'Failed to load the CAS')); }
  }, [applicationId]);
  useEffect(() => { void load(); }, [load]);
  async function open() {
    setError('');
    try { await openCasCaseForApplication(applicationId); await load(); } catch (err) { setError(message(err, 'Failed to open the CAS case')); }
  }
  if (!cases) return null;
  const live = cases.filter((c) => c.statusCode !== 'withdrawn');
  return (
    <Card>
      <CardHeader title="Student visa (CAS)" description="For an applicant who needs a Student visa. The enrolment cannot be created while the CAS is still open." />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600" role="alert">{error}</p>}
        {live.length === 0 ? (
          <div className="flex items-center gap-3">
            <p className="text-sm text-neutral-600">No CAS case.</p>
            {canOpen && <Button size="sm" variant="secondary" onClick={() => void open()}>Open a CAS case</Button>}
          </div>
        ) : live.map((c) => <CasCasePanel key={c.casCaseId} item={c} onChanged={() => void load()} />)}
      </CardBody>
    </Card>
  );
}

/**
 * Completing the admissions hand-off (D-10): creates the student's enrolment
 * from the confirmed offer, in pre-registration until they register. Doing it
 * again returns the same enrolment.
 */
function ConversionCard({ applicationId, programmeName }: { applicationId: string; programmeName: (id: string | null) => string }) {
  const [conversion, setConversion] = useState<EnrolmentConversion | null>(null);
  const [startDate, setStartDate] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    getEnrolmentConversion(applicationId).then((c) => { setConversion(c); setStartDate(c.startDate ?? ''); })
      .catch((err: unknown) => setError(message(err, 'Failed to load the enrolment details')));
  }, [applicationId]);

  async function convert(e: FormEvent) {
    e.preventDefault();
    setError('');
    try { setConversion(await convertToEnrolment(applicationId, startDate || undefined)); } catch (err) { setError(message(err, 'Failed to create the enrolment')); }
  }

  if (!conversion) return error ? <p className="text-sm text-danger-600" role="alert">{error}</p> : null;
  return (
    <Card>
      <CardHeader
        title="Enrolment"
        description={conversion.enrolmentExists
          ? 'The enrolment has been created. The student is in pre-registration until they register in the portal.'
          : 'Complete the hand-off: create the student\'s enrolment from the confirmed offer. It starts in pre-registration; nothing is sent to finance or regulators until the student registers.'}
      />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600" role="alert">{error}</p>}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
          <Fact label="Programme">{programmeName(conversion.programmeId)}{conversion.programmeSource === 'alternative' ? ' (alternative)' : ''}</Fact>
          <Fact label="Mode of study"><CodeLabel entity="admissions_offer" field="mode_of_study_code" code={conversion.modeOfStudyCode} /></Fact>
          <Fact label="Year of entry">{conversion.academicYearOfEntry ?? '—'}</Fact>
          <Fact label="Fee status basis"><CodeLabel entity="admissions_offer" field="fee_status_basis_code" code={conversion.feeStatusBasisCode} empty="Not recorded" /></Fact>
          <Fact label="Hand-off task">{conversion.handoffTaskStatus ?? 'None'}</Fact>
        </dl>
        {conversion.blockers.length > 0 && (
          <ul className="mt-3 list-disc pl-5 text-sm text-danger-700">{conversion.blockers.map((b) => <li key={b.code}>{b.message}</li>)}</ul>
        )}
        {conversion.enrolmentExists && conversion.personId ? (
          <p className="mt-4 text-sm"><Link to={`/students/${conversion.personId}`} className="text-primary-600 hover:underline">Open the student record</Link></p>
        ) : conversion.blockers.length === 0 && (
          <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(e) => void convert(e)}>
            <LabelledField label="Start date" htmlFor="conversion-start" hint="From the intake; change only if the course starts on a different date">
              <Input id="conversion-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </LabelledField>
            <Button type="submit" disabled={!startDate}>Create enrolment</Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function IdentityCard({ onConfirm }: { onConfirm: (personId: string) => Promise<boolean> }) {
  const [personId, setPersonId] = useState('');
  return (
    <Card>
      <CardHeader title="Confirm the applicant" description="The applicant resembles an existing person but was not matched on certain evidence, so nothing was merged. Check the student record, then confirm which person this is." />
      <CardBody>
        <form className="flex items-end gap-3" onSubmit={(e) => { e.preventDefault(); void onConfirm(personId.trim()); }}>
          <LabelledField label="Person ID" htmlFor="identity-person" required>
            <Input id="identity-person" value={personId} onChange={(e) => setPersonId(e.target.value)} className="w-96" />
          </LabelledField>
          <Button type="submit" disabled={!personId.trim()}>Confirm identity</Button>
        </form>
      </CardBody>
    </Card>
  );
}

function RoutingCard({ current, onRoute }: { current: string | null; onRoute: (reason: 'incomplete' | 'duplicate' | 'restricted' | null) => Promise<boolean> }) {
  const [reason, setReason] = useState(current && current !== 'identity' ? current : '');
  return (
    <Card>
      <CardHeader title="Worklist" description="Hold the application on a worklist, or clear it to return it for assessment." />
      <CardBody>
        <form className="flex items-end gap-3" onSubmit={(e) => { e.preventDefault(); void onRoute((reason || null) as 'incomplete' | 'duplicate' | 'restricted' | null); }}>
          <LabelledField label="Hold for" htmlFor="routing-reason">
            <CodeSelect entity="student_application" field="routing_reason_code" id="routing-reason" value={reason} onChange={(v) => setReason(v)} className="w-64" emptyLabel="Nothing (clear the worklist)" only={['incomplete', 'duplicate', 'restricted']} />
          </LabelledField>
          <Button type="submit" variant="secondary">Update worklist</Button>
        </form>
      </CardBody>
    </Card>
  );
}

function AssessmentForm({ onSubmit }: { onSubmit: (body: { assessmentTypeCode: string; outcomeCode: string; evidenceRef?: string; evidenceVersion?: string; note?: string }) => Promise<boolean> }) {
  const { members: types } = useValueSet('application_assessment', 'assessment_type_code');
  const { members: outcomes } = useValueSet('application_assessment', 'outcome_code');
  const [type, setType] = useState('');
  const [outcome, setOutcome] = useState('');
  const [evidenceRef, setEvidenceRef] = useState('');
  const [evidenceVersion, setEvidenceVersion] = useState('');
  const [note, setNote] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await onSubmit({
      assessmentTypeCode: type, outcomeCode: outcome,
      ...(evidenceRef.trim() ? { evidenceRef: evidenceRef.trim() } : {}),
      ...(evidenceVersion.trim() ? { evidenceVersion: evidenceVersion.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    if (ok) { setType(''); setOutcome(''); setEvidenceRef(''); setEvidenceVersion(''); setNote(''); }
  }

  return (
    <form className="mt-4 grid grid-cols-2 gap-3 items-end md:grid-cols-4" onSubmit={(e) => void submit(e)}>
      <LabelledField label="Assessment" htmlFor="assessment-type" required>
        <Select id="assessment-type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Choose…</option>
          {types.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
        </Select>
      </LabelledField>
      <LabelledField label="Outcome" htmlFor="assessment-outcome" required>
        <Select id="assessment-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="">Choose…</option>
          {outcomes.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
        </Select>
      </LabelledField>
      <LabelledField label="Evidence reference" htmlFor="assessment-evidence">
        <Input id="assessment-evidence" value={evidenceRef} onChange={(e) => setEvidenceRef(e.target.value)} />
      </LabelledField>
      <LabelledField label="Evidence version" htmlFor="assessment-version">
        <Input id="assessment-version" value={evidenceVersion} onChange={(e) => setEvidenceVersion(e.target.value)} />
      </LabelledField>
      <div className="col-span-2 md:col-span-3">
        <LabelledField label="Note" htmlFor="assessment-note">
          <Input id="assessment-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </LabelledField>
      </div>
      <Button type="submit" disabled={!type || !outcome}>Record assessment</Button>
    </form>
  );
}

function RecommendationCard({ onSubmit }: { onSubmit: (body: { recommendationCode: 'offer' | 'reject'; reason: string }) => Promise<boolean> }) {
  const [code, setCode] = useState<'offer' | 'reject'>('offer');
  const [reason, setReason] = useState('');
  return (
    <Card>
      <CardHeader title="Recommend" description="Your recommendation is decided by someone else." />
      <CardBody>
        <form className="grid grid-cols-1 gap-3 md:grid-cols-4 items-end" onSubmit={(e) => { e.preventDefault(); void onSubmit({ recommendationCode: code, reason: reason.trim() }); }}>
          <LabelledField label="Recommendation" htmlFor="recommendation-code">
            <CodeSelect entity="student_application" field="recommendation_code" id="recommendation-code" value={code} onChange={(v) => setCode(v as 'offer' | 'reject')} />
          </LabelledField>
          <div className="md:col-span-2">
            <LabelledField label="Reason" htmlFor="recommendation-reason" required>
              <Input id="recommendation-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </LabelledField>
          </div>
          <Button type="submit" disabled={!reason.trim()}>Record recommendation</Button>
        </form>
      </CardBody>
    </Card>
  );
}

function ConditionsEditor({ conditions, onChange, idPrefix }: { conditions: ConditionInput[]; onChange: (c: ConditionInput[]) => void; idPrefix: string }) {
  const { members: types } = useValueSet('offer_condition', 'condition_type_code');
  const update = (i: number, patch: Partial<ConditionInput>) => onChange(conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-neutral-700">Conditions</legend>
      {conditions.map((c, i) => (
        <div key={i} className="grid grid-cols-1 gap-2 md:grid-cols-[12rem_1fr_10rem_auto] items-end">
          <LabelledField label={`Condition ${i + 1} type`} htmlFor={`${idPrefix}-type-${i}`}>
            <Select id={`${idPrefix}-type-${i}`} value={c.conditionTypeCode} onChange={(e) => update(i, { conditionTypeCode: e.target.value })}>
              <option value="">Choose…</option>
              {types.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
            </Select>
          </LabelledField>
          <LabelledField label={`Condition ${i + 1} description`} htmlFor={`${idPrefix}-desc-${i}`}>
            <Input id={`${idPrefix}-desc-${i}`} value={c.description} onChange={(e) => update(i, { description: e.target.value })} />
          </LabelledField>
          <LabelledField label={`Condition ${i + 1} required value`} htmlFor={`${idPrefix}-value-${i}`}>
            <Input id={`${idPrefix}-value-${i}`} value={c.requiredValue ?? ''} onChange={(e) => update(i, { requiredValue: e.target.value })} />
          </LabelledField>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(conditions.filter((_, j) => j !== i))}>
            Remove<span className="sr-only"> condition {i + 1}</span>
          </Button>
        </div>
      ))}
      <div>
        <Button type="button" variant="secondary" size="sm" onClick={() => onChange([...conditions, { conditionTypeCode: '', description: '' }])}>
          Add condition
        </Button>
      </div>
    </fieldset>
  );
}

function cleanConditions(conditions: ConditionInput[]): ConditionInput[] {
  return conditions.map((c) => ({
    conditionTypeCode: c.conditionTypeCode, description: c.description.trim(),
    ...(c.requiredValue?.trim() ? { requiredValue: c.requiredValue.trim() } : {}),
  }));
}

function DecisionCard({ app, canDecide, isRecommender, onSubmit }: {
  app: ApplicationDetail; canDecide: boolean; isRecommender: boolean;
  onSubmit: (body: Parameters<typeof decideApplication>[1]) => Promise<boolean>;
}) {
  const [decision, setDecision] = useState<'offer' | 'reject'>(app.recommendationCode ?? 'offer');
  const [reason, setReason] = useState('');
  const [offerType, setOfferType] = useState<'conditional' | 'unconditional'>('conditional');
  const [expiresOn, setExpiresOn] = useState('');
  const [conditions, setConditions] = useState<ConditionInput[]>([{ conditionTypeCode: '', description: '' }]);

  function submit(e: FormEvent) {
    e.preventDefault();
    void onSubmit(decision === 'reject'
      ? { decisionCode: 'reject', ...(reason.trim() ? { reason: reason.trim() } : {}) }
      : {
        decisionCode: 'offer',
        offer: {
          offerTypeCode: offerType, ...(expiresOn ? { expiresOn } : {}),
          ...(offerType === 'conditional' ? { conditions: cleanConditions(conditions) } : {}),
        },
      });
  }

  return (
    <Card>
      <CardHeader title="Decide" description={`Recommended: ${app.recommendationCode === 'offer' ? 'make an offer' : 'reject'} — ${app.recommendationReason ?? ''} (by ${app.recommendedBy ?? 'unknown'})`} />
      <CardBody>
        {!canDecide ? (
          <p className="text-sm text-neutral-600">Awaiting a decision by an admissions decision-maker.</p>
        ) : isRecommender ? (
          <StatusNotice>You recommended this application, so someone else must decide it.</StatusNotice>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3 items-end">
              <LabelledField label="Decision" htmlFor="decision-code">
                <CodeSelect entity="student_application" field="recommendation_code" id="decision-code" value={decision} onChange={(v) => setDecision(v as 'offer' | 'reject')} />
              </LabelledField>
              {decision === 'offer' ? (
                <>
                  <LabelledField label="Offer type" htmlFor="offer-type">
                    <CodeSelect entity="admissions_offer" field="offer_type_code" id="offer-type" value={offerType} onChange={(v) => setOfferType(v as 'conditional' | 'unconditional')} only={['conditional', 'unconditional']} />
                  </LabelledField>
                  <LabelledField label="Expires on" htmlFor="offer-expires">
                    <Input id="offer-expires" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
                  </LabelledField>
                </>
              ) : (
                <div className="md:col-span-2">
                  <LabelledField label="Reason" htmlFor="decision-reason">
                    <Input id="decision-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                  </LabelledField>
                </div>
              )}
            </div>
            {decision === 'offer' && offerType === 'conditional' && (
              <ConditionsEditor conditions={conditions} onChange={setConditions} idPrefix="decision-condition" />
            )}
            <div><Button type="submit">{decision === 'offer' ? 'Make offer' : 'Reject application'}</Button></div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

function OfferCard({ offer, programmeName, canDecide, canReceive, act }: {
  offer: Offer; programmeName: string; canDecide: boolean; canReceive: boolean;
  act: (run: () => Promise<unknown>) => Promise<boolean>;
}) {
  const offerModes = useCodes('admissions_offer', 'mode_of_study_code');
  const offerTypes = useCodes('admissions_offer', 'offer_type_code');
  const confirmationDecisions = useCodes('offer_confirmation_decision', 'decision_code');
  const open = OPEN_OFFER.includes(offer.statusCode);
  return (
    <Card>
      <CardHeader
        title={`Offer version ${offer.version}`}
        description={`${offerTypes.label(offer.offerTypeCode)} · ${programmeName} · ${offer.intakeCode} · ${offerModes.label(offer.modeOfStudyCode)}${offer.expiresOn ? ` · expires ${offer.expiresOn}` : ''}`}
        actions={<CodeBadge entity="admissions_offer" field="status_code" code={offer.statusCode} />}
      />
      <CardBody>
        <div className="flex flex-col gap-4">
          {offer.changeReason && <p className="text-sm text-neutral-600">Changed: {offer.changeReason}</p>}
          {offer.responseCode && (
            <p className="text-sm">Applicant {offer.responseCode === 'accept' ? 'accepted' : 'declined'}{offer.responseSourceAt ? ` on ${new Date(offer.responseSourceAt).toLocaleString('en-GB')}` : ''}.</p>
          )}

          {offer.conditions.length > 0 && (
            <>
            <ConditionsTable conditions={offer.conditions} offerOpen={open} canDecide={canDecide} canReceive={canReceive} act={act} offerVersion={offer.version} />
            {open && canDecide && offer.conditions.some((c) => c.statusCode === 'pending' && c.evidence.length > 0 && c.evidence.every((e) => e.matchOutcomeCode === 'meets')) && (
              <div className="mt-3">
                <Button size="sm" variant="secondary" onClick={() => void act(() => confirmSuggestedMet(offer.id))}>Confirm every condition the UCAS results meet</Button>
              </div>
            )}
            </>
          )}

          {offer.confirmation && (
            <div className="rounded border border-neutral-200 p-3 text-sm">
              <p className="font-medium">Confirmation: {confirmationDecisions.label(offer.confirmation.decisionCode)}</p>
              {offer.confirmation.reason && <p className="text-neutral-600">{offer.confirmation.reason}</p>}
              {offer.confirmation.handoffWorkflowInstanceId && <p className="text-neutral-600">Handed to enrolment (workflow {offer.confirmation.handoffWorkflowInstanceId}).</p>}
            </div>
          )}

          {offer.statusCode === 'made' && canReceive && (
            <ResponseForm offerId={offer.id} onSubmit={(body) => act(() => recordOfferResponse(offer.id, body))} />
          )}
          {offer.statusCode === 'accepted' && canDecide && (
            <ConfirmationForm offer={offer} onSubmit={(body) => act(() => confirmOffer(offer.id, body))} />
          )}
          {open && canDecide && (
            <ChangeOfferForm
              offer={offer}
              onChange={(body) => act(() => changeOffer(offer.id, body))}
              onWithdraw={() => act(() => withdrawOffer(offer.id))}
            />
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function ConditionsTable({ conditions, offerOpen, canDecide, canReceive, act, offerVersion }: {
  conditions: OfferCondition[]; offerOpen: boolean; canDecide: boolean; canReceive: boolean; offerVersion: number;
  act: (run: () => Promise<unknown>) => Promise<boolean>;
}) {
  const provenances = useCodes('condition_evidence', 'provenance_code');
  return (
    <Table>
      <TableHead>
        <tr>
          <TableHeaderCell>Condition</TableHeaderCell><TableHeaderCell>Required</TableHeaderCell>
          <TableHeaderCell>Evidence</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell>
        </tr>
      </TableHead>
      <TableBody>
        {conditions.map((c) => (
          <TableRow key={c.id}>
            <TableCell>{c.description}<div className="text-xs text-neutral-500"><CodeLabel entity="offer_condition" field="condition_type_code" code={c.conditionTypeCode} /></div></TableCell>
            <TableCell className="text-sm">{c.requiredValue ?? '—'}</TableCell>
            <TableCell className="text-xs">
              {c.evidence.length === 0 ? 'None' : c.evidence.map((e) => (
                <div key={e.id}>
                  {provenances.label(e.provenanceCode)}: {e.evidenceRef}{e.reportedValue ? ` = ${e.reportedValue}` : ''} {e.verified ? '(verified)' : '(unverified)'}
                  {e.matchOutcomeCode && <span className="ml-1 font-medium">· <CodeLabel entity="condition_evidence" field="match_outcome_code" code={e.matchOutcomeCode} /></span>}
                  {e.embargoedUntil && <span className="ml-1 text-warning-700">· embargoed until {e.embargoedUntil}</span>}
                </div>
              ))}
            </TableCell>
            <TableCell>
              <CodeBadge entity="offer_condition" field="status_code" code={c.statusCode} />
              {c.decisionNote && <div className="text-xs text-neutral-500">{c.decisionNote}</div>}
            </TableCell>
            <TableCell className="text-right">
              {offerOpen && (canReceive || canDecide) && (
                <ConditionActions condition={c} canDecide={canDecide} canReceive={canReceive} act={act} idPrefix={`v${offerVersion}-${c.id}`} />
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ConditionActions({ condition, canDecide, canReceive, act, idPrefix }: {
  condition: OfferCondition; canDecide: boolean; canReceive: boolean; idPrefix: string;
  act: (run: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<'' | 'evidence' | 'decide'>('');
  const { members: provenances } = useValueSet('condition_evidence', 'provenance_code');
  const [provenance, setProvenance] = useState('');
  const [evidenceRef, setEvidenceRef] = useState('');
  const [reportedValue, setReportedValue] = useState('');
  const [verified, setVerified] = useState(false);
  const [status, setStatus] = useState<'met' | 'waived' | 'unmet'>('met');
  const [note, setNote] = useState('');

  if (mode === '') {
    return (
      <div className="inline-flex gap-2">
        {canReceive && <Button size="sm" variant="secondary" onClick={() => setMode('evidence')}>Add evidence<span className="sr-only"> for {condition.description}</span></Button>}
        {canDecide && <Button size="sm" variant="secondary" onClick={() => setMode('decide')}>Decide<span className="sr-only"> {condition.description}</span></Button>}
      </div>
    );
  }
  if (mode === 'evidence') {
    return (
      <form className="flex flex-col items-end gap-2" onSubmit={(e) => {
        e.preventDefault();
        void act(() => recordConditionEvidence(condition.id, {
          provenanceCode: provenance, evidenceRef: evidenceRef.trim(), verified,
          ...(reportedValue.trim() ? { reportedValue: reportedValue.trim() } : {}),
        })).then((ok) => { if (ok) setMode(''); });
      }}>
        <LabelledField label="Source" htmlFor={`${idPrefix}-prov`}>
          <Select id={`${idPrefix}-prov`} value={provenance} onChange={(e) => setProvenance(e.target.value)}>
            <option value="">Choose…</option>
            {provenances.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
          </Select>
        </LabelledField>
        <LabelledField label="Evidence reference" htmlFor={`${idPrefix}-ref`}>
          <Input id={`${idPrefix}-ref`} value={evidenceRef} onChange={(e) => setEvidenceRef(e.target.value)} />
        </LabelledField>
        <LabelledField label="Reported value" htmlFor={`${idPrefix}-value`}>
          <Input id={`${idPrefix}-value`} value={reportedValue} onChange={(e) => setReportedValue(e.target.value)} />
        </LabelledField>
        <label className="flex items-center gap-2 text-sm" htmlFor={`${idPrefix}-verified`}>
          <Checkbox id={`${idPrefix}-verified`} checked={verified} onChange={(e) => setVerified(e.target.checked)} /> Verified at source
        </label>
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={!provenance || !evidenceRef.trim()}>Record evidence</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setMode('')}>Cancel</Button>
        </div>
      </form>
    );
  }
  return (
    <form className="flex flex-col items-end gap-2" onSubmit={(e) => {
      e.preventDefault();
      void act(() => decideCondition(condition.id, { statusCode: status, ...(note.trim() ? { note: note.trim() } : {}) }))
        .then((ok) => { if (ok) setMode(''); });
    }}>
      <LabelledField label="Outcome" htmlFor={`${idPrefix}-status`}>
        <CodeSelect entity="offer_condition" field="status_code" id={`${idPrefix}-status`} value={status} onChange={(v) => setStatus(v as 'met' | 'waived' | 'unmet')} only={['met', 'waived', 'unmet']} />
      </LabelledField>
      <LabelledField label="Note" htmlFor={`${idPrefix}-note`}>
        <Input id={`${idPrefix}-note`} value={note} onChange={(e) => setNote(e.target.value)} />
      </LabelledField>
      <div className="flex gap-2">
        <Button type="submit" size="sm">Record outcome</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setMode('')}>Cancel</Button>
      </div>
    </form>
  );
}

function ResponseForm({ offerId, onSubmit }: { offerId: string; onSubmit: (body: { responseCode: 'accept' | 'decline'; sourceTimestamp: string }) => Promise<boolean> }) {
  const [response, setResponse] = useState<'accept' | 'decline'>('accept');
  const [at, setAt] = useState('');
  return (
    <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void onSubmit({ responseCode: response, sourceTimestamp: new Date(at).toISOString() }); }}>
      <LabelledField label="Applicant response" htmlFor={`response-${offerId}`}>
        <CodeSelect entity="admissions_offer" field="response_code" id={`response-${offerId}`} value={response} onChange={(v) => setResponse(v as 'accept' | 'decline')} />
      </LabelledField>
      <LabelledField label="Responded at (from the channel)" htmlFor={`response-at-${offerId}`} required>
        <Input id={`response-at-${offerId}`} type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
      </LabelledField>
      <Button type="submit" variant="secondary" disabled={!at}>Record response</Button>
    </form>
  );
}

function ConfirmationForm({ offer, onSubmit }: { offer: Offer; onSubmit: (body: Parameters<typeof confirmOffer>[1]) => Promise<boolean> }) {
  const programmes = useProgrammeNames();
  const [decision, setDecision] = useState<'confirmed' | 'confirmed-alternative' | 'unsuccessful'>('confirmed');
  const [alternative, setAlternative] = useState('');
  const [reason, setReason] = useState('');
  const outstanding = offer.conditions.filter((c) => c.statusCode !== 'met' && c.statusCode !== 'waived').length;
  return (
    <form className="flex flex-col gap-3 rounded border border-neutral-200 p-3" onSubmit={(e) => {
      e.preventDefault();
      void onSubmit({ decisionCode: decision, ...(alternative ? { alternativeProgrammeId: alternative } : {}), ...(reason.trim() ? { reason: reason.trim() } : {}) });
    }}>
      <p className="text-sm font-medium">Confirmation</p>
      {outstanding > 0 && <p className="text-sm text-neutral-600">{outstanding} condition(s) not yet met or waived: the offer can be confirmed only once all are.</p>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 items-end">
        <LabelledField label="Outcome" htmlFor={`confirm-${offer.id}`}>
          <CodeSelect entity="offer_confirmation_decision" field="decision_code" id={`confirm-${offer.id}`} value={decision} onChange={(v) => setDecision(v as typeof decision)} />
        </LabelledField>
        {decision === 'confirmed-alternative' && (
          <LabelledField label="Alternative programme" htmlFor={`confirm-alt-${offer.id}`} required>
            {programmes.size > 0 ? (
              <Select id={`confirm-alt-${offer.id}`} value={alternative} onChange={(e) => setAlternative(e.target.value)}>
                <option value="">Choose…</option>
                {[...programmes.values()].map((p) => <option key={p.programmeId} value={p.programmeId}>{p.code} — {p.title}</option>)}
              </Select>
            ) : (
              <Input id={`confirm-alt-${offer.id}`} value={alternative} onChange={(e) => setAlternative(e.target.value)} placeholder="Programme ID" />
            )}
          </LabelledField>
        )}
        {decision !== 'confirmed' && (
          <LabelledField label="Reason" htmlFor={`confirm-reason-${offer.id}`} required>
            <Input id={`confirm-reason-${offer.id}`} value={reason} onChange={(e) => setReason(e.target.value)} />
          </LabelledField>
        )}
      </div>
      <div><Button type="submit">Record confirmation</Button></div>
    </form>
  );
}

function ChangeOfferForm({ offer, onChange, onWithdraw }: {
  offer: Offer;
  onChange: (body: Parameters<typeof changeOffer>[1]) => Promise<boolean>;
  onWithdraw: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [offerType, setOfferType] = useState(offer.offerTypeCode);
  const [expiresOn, setExpiresOn] = useState(offer.expiresOn ?? '');
  const [replaceConditions, setReplaceConditions] = useState(false);
  const [conditions, setConditions] = useState<ConditionInput[]>(
    offer.conditions.map((c) => ({ conditionTypeCode: c.conditionTypeCode, description: c.description, ...(c.requiredValue ? { requiredValue: c.requiredValue } : {}) })),
  );

  if (!open) {
    return (
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Change offer</Button>
        <Button variant="secondary" size="sm" className="border-danger-300 text-danger-700 hover:bg-danger-50" onClick={() => void onWithdraw()}>Withdraw offer</Button>
      </div>
    );
  }
  return (
    <form className="flex flex-col gap-3 rounded border border-neutral-200 p-3" onSubmit={(e) => {
      e.preventDefault();
      void onChange({
        reason: reason.trim(), offerTypeCode: offerType, ...(expiresOn ? { expiresOn } : {}),
        ...(replaceConditions ? { conditions: offerType === 'conditional' ? cleanConditions(conditions) : [] } : offerType === 'unconditional' ? { conditions: [] } : {}),
      }).then((ok) => { if (ok) setOpen(false); });
    }}>
      <p className="text-sm font-medium">Change offer (creates a new version; an acceptance carries over)</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 items-end">
        <LabelledField label="Offer type" htmlFor={`change-type-${offer.id}`}>
          <CodeSelect entity="admissions_offer" field="offer_type_code" id={`change-type-${offer.id}`} value={offerType} onChange={(v) => setOfferType(v as 'conditional' | 'unconditional')} only={['conditional', 'unconditional']} />
        </LabelledField>
        <LabelledField label="Expires on" htmlFor={`change-expires-${offer.id}`}>
          <Input id={`change-expires-${offer.id}`} type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
        </LabelledField>
        <LabelledField label="Reason for the change" htmlFor={`change-reason-${offer.id}`} required>
          <Textarea id={`change-reason-${offer.id}`} rows={1} value={reason} onChange={(e) => setReason(e.target.value)} />
        </LabelledField>
      </div>
      {offerType === 'conditional' && (
        <>
          <label className="flex items-center gap-2 text-sm" htmlFor={`change-replace-${offer.id}`}>
            <Checkbox id={`change-replace-${offer.id}`} checked={replaceConditions} onChange={(e) => setReplaceConditions(e.target.checked)} />
            Replace the conditions (otherwise they carry over)
          </label>
          {replaceConditions && <ConditionsEditor conditions={conditions} onChange={setConditions} idPrefix={`change-condition-${offer.id}`} />}
        </>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={!reason.trim()}>Save new version</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}
