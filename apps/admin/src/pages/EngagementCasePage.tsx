import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  addCaseAction, getInterventionCase, recordCaseContact, reviewCase, type InterventionCaseView,
} from '../api/engagement.js';
import { ApiError } from '../api/client.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';
import {
  PageHeader, Card, CardHeader, CardBody, Button, Select, LabelledField, Textarea, Input, CodeBadge, CodeLabel, CodeSelect,
} from '@revelation-srs/ui';

export function EngagementCasePage() {
  const { caseId = '' } = useParams();
  const [data, setData] = useState<InterventionCaseView | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await getInterventionCase(caseId)); setError(''); }
    catch (cause) { setError(cause instanceof ApiError ? (cause.detail ?? cause.message) : 'Unable to load case'); }
    finally { setLoading(false); }
  }, [caseId]);
  useEffect(() => { void load(); }, [load]);
  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>;
  if (!data) return <p role="alert" className="text-danger-700">{error}</p>;
  const current = data.intervention;
  return <section>
    <Link to="/engagement" className="text-sm text-primary-600">← Engagement workspace</Link>
    <PageHeader
      title="Intervention case"
      description={`Student ${current.personId.slice(0, 8)} · assigned to ${current.assignedActorId ?? current.assignedRoleCode ?? 'unassigned'}`}
      actions={<CodeBadge entity="attendance.engagement_intervention_case" field="status_code" code={current.statusCode} />}
    />
    <div className="-mt-2 mb-5 rounded border border-primary-200 bg-primary-50 p-3 text-sm text-primary-800">
      This case coordinates support. Academic-status and sponsor-reporting decisions remain separate authorised processes.
    </div>
    {error && <p role="alert" className="mt-4 text-sm text-danger-700">{error}</p>}
    <div className="mt-6 grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Timeline title="Contacts" empty="No contact attempts recorded.">{data.contacts.map((contact) =>
          <TimelineItem key={contact.id} heading={<><CodeLabel entity="attendance.engagement_contact_attempt" field="channel_code" code={contact.channelCode} /> · <CodeLabel entity="attendance.engagement_contact_attempt" field="outcome_code" code={contact.outcomeCode} /></>} date={contact.attemptedAt}>
            {contact.communicationLocale && <span className="mr-2 rounded bg-neutral-100 px-2 py-0.5 text-xs">Language: {contact.communicationLocale}</span>}
            {contact.operationalNote}
          </TimelineItem>)}</Timeline>
        <Timeline title="Actions" empty="No actions recorded.">{data.actions.map((action) =>
          <TimelineItem key={action.id} heading={<CodeLabel entity="attendance.engagement_action" field="action_type_code" code={action.actionTypeCode} />} date={action.dueAt}>
            {action.operationalInstruction ?? <>Owner: <CodeLabel entity="attendance.engagement_action" field="owner_role_code" code={action.ownerRoleCode} empty="not assigned" /></>}
          </TimelineItem>)}</Timeline>
        <Timeline title="Restricted referrals" empty="No referrals recorded.">{data.referrals.map((referral) =>
          <TimelineItem key={referral.id} heading={<><CodeLabel entity="attendance.engagement_referral" field="target_service_code" code={referral.targetServiceCode} /> · <CodeLabel entity="attendance.engagement_referral" field="status_code" code={referral.statusCode} /></>} date={referral.referredAt}>
            <CodeLabel entity="attendance.engagement_referral" field="referral_type_code" code={referral.referralTypeCode} />{referral.externalReference ? ` · ${referral.externalReference}` : ''}
          </TimelineItem>)}</Timeline>
      </div>
      <aside className="space-y-5">
        {current.statusCode !== 'closed' && <>
          <ContactForm caseId={caseId} onDone={load} onError={setError} />
          <ActionForm caseId={caseId} onDone={load} onError={setError} />
          <ReviewForm caseId={caseId} versionId={current.versionId} onDone={load} onError={setError} />
        </>}
      </aside>
    </div>
  </section>;
}

function ContactForm({ caseId, onDone, onError }: FormProps) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // React nulls a SyntheticEvent's currentTarget once the handler task
    // returns, so it must be captured before the first await — reading it
    // afterward (to fd.get() or .reset()) throws, which was being silently
    // swallowed by the catch below as a false "Action failed", after the
    // save had already succeeded and without ever reloading the timeline.
    const form = event.currentTarget;
    const fd = new FormData(form);
    try {
      await recordCaseContact(caseId, {
        channelCode: String(fd.get('channelCode')), outcomeCode: String(fd.get('outcomeCode')),
        attemptedAt: new Date().toISOString(), communicationLocale: String(fd.get('locale') || 'en-GB'),
        operationalNote: String(fd.get('note') || ''),
      }); form.reset(); await onDone();
    } catch (cause) { onError(message(cause)); }
  }
  return <FormCard title="Record contact"><form onSubmit={(event) => void submit(event)} className="space-y-3">
    <CodePick name="channelCode" label="Channel" entity="attendance.engagement_contact_attempt" field="channel_code" />
    <CodePick name="outcomeCode" label="Outcome" entity="attendance.engagement_contact_attempt" field="outcome_code" />
    <OptionPick name="locale" label="Communication language" options={[['en-GB', 'English'], ['cy', 'Welsh']]} />
    <LabelledField label="Operational note" htmlFor="ec-note"><Textarea id="ec-note" name="note" maxLength={500} /></LabelledField>
    <p className="text-xs text-neutral-500">Do not enter medical, disability, safeguarding or other restricted narrative.</p>
    <Button type="submit" className="w-full">Save contact</Button>
  </form></FormCard>;
}
function ActionForm({ caseId, onDone, onError }: FormProps) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fd = new FormData(form);
    try {
      await addCaseAction(caseId, {
        actionTypeCode: String(fd.get('actionTypeCode')), ownerRoleCode: String(fd.get('ownerRoleCode')),
        dueAt: new Date(String(fd.get('dueAt'))).toISOString(),
      }); form.reset(); await onDone();
    } catch (cause) { onError(message(cause)); }
  }
  return <FormCard title="Add action"><form onSubmit={(event) => void submit(event)} className="space-y-3">
    <CodePick name="actionTypeCode" label="Action type" entity="attendance.engagement_action" field="action_type_code" />
    <CodePick name="ownerRoleCode" label="Owner" entity="attendance.engagement_action" field="owner_role_code" only={['engagement-officer', 'personal-tutor']} />
    <LabelledField label="Due date" htmlFor="ec-due" required><Input id="ec-due" required name="dueAt" type="date" /></LabelledField>
    <Button type="submit" className="w-full">Add action</Button>
  </form></FormCard>;
}
function ReviewForm({ caseId, versionId, onDone, onError }: FormProps & { versionId: string }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const fd = new FormData(event.currentTarget); const decision = String(fd.get('decision'));
    const target = String(fd.get('targetServiceCode'));
    try {
      await reviewCase(caseId, {
        expectedVersionId: versionId, decision, reviewAt: new Date().toISOString(),
        ...(decision === 'close' ? { outcomeCode: String(fd.get('outcomeCode')) } : {}),
        ...(decision === 'refer' ? { referral: {
          targetServiceCode: target,
          referralTypeCode: target === 'sponsor-compliance-review' ? 'compliance-review' : 'support-request',
        } } : {}),
      }); await onDone();
    } catch (cause) { onError(message(cause)); }
  }
  return <FormCard title="Review case"><form onSubmit={(event) => void submit(event)} className="space-y-3">
    <OptionPick name="decision" label="Decision" options={[['continue', 'Continue the case'], ['close', 'Close the case'], ['refer', 'Refer to another service']]} />
    <CodePick name="outcomeCode" label="Closure outcome" entity="attendance.engagement_intervention_case" field="outcome_code" only={['engagement-restored', 'no-concern', 'support-continuing', 'no-response']} />
    <CodePick name="targetServiceCode" label="Referral target" entity="attendance.engagement_referral" field="target_service_code" />
    <Button type="submit" className="w-full">Record review</Button>
  </form></FormCard>;
}
interface FormProps { caseId: string; onDone: () => Promise<void>; onError: (value: string) => void }
function message(cause: unknown) { return cause instanceof ApiError ? (cause.detail ?? cause.message) : 'Action failed'; }
function FormCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card><CardHeader title={title} /><CardBody>{children}</CardBody></Card>;
}
/** A form field offering a value set's selectable values. */
function CodePick({ name, label, entity, field, only }: { name: string; label: string; entity: string; field: string; only?: string[] }) {
  return <LabelledField label={label} htmlFor={`ec-${name}`}>
    <CodeSelect id={`ec-${name}`} name={name} entity={entity} field={field} {...(only ? { only } : {})} />
  </LabelledField>;
}
/** A form field for a choice that is not a stored code (a decision, a language). */
function OptionPick({ name, label, options }: { name: string; label: string; options: Array<[string, string]> }) {
  return <LabelledField label={label} htmlFor={`ec-${name}`}>
    <Select id={`ec-${name}`} name={name}>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</Select>
  </LabelledField>;
}
function Timeline({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return <Card><CardHeader title={title} /><CardBody>
    <div className="space-y-3">{children.length ? children : <p className="text-sm text-neutral-500">{empty}</p>}</div>
  </CardBody></Card>;
}
function TimelineItem({ heading, date, children }: { heading: React.ReactNode; date: string | null; children: React.ReactNode }) {
  return <div className="border-l-2 border-primary-200 pl-3"><div className="flex justify-between gap-3">
    <p className="text-sm font-medium">{heading}</p><time className="text-xs text-neutral-500">{date ? new Date(date).toLocaleString('en-GB') : 'No date'}</time></div>
    <div className="mt-1 text-sm text-neutral-600">{children}</div></div>;
}
