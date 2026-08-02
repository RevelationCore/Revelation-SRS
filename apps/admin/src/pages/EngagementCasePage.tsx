import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  addCaseAction, getInterventionCase, recordCaseContact, reviewCase, type InterventionCaseView,
} from '../api/engagement.js';
import { ApiError } from '../api/client.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';
import {
  PageHeader, Card, CardHeader, CardBody, Button, Select, LabelledField, Textarea, Input,
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
      actions={<Badge value={current.statusCode} />}
    />
    <div className="-mt-2 mb-5 rounded border border-primary-200 bg-primary-50 p-3 text-sm text-primary-800">
      This case coordinates support. Academic-status and sponsor-reporting decisions remain separate authorised processes.
    </div>
    {error && <p role="alert" className="mt-4 text-sm text-danger-700">{error}</p>}
    <div className="mt-6 grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Timeline title="Contacts" empty="No contact attempts recorded.">{data.contacts.map((contact) =>
          <TimelineItem key={contact.id} heading={`${contact.channelCode} · ${contact.outcomeCode}`} date={contact.attemptedAt}>
            {contact.communicationLocale && <span className="mr-2 rounded bg-neutral-100 px-2 py-0.5 text-xs">Language: {contact.communicationLocale}</span>}
            {contact.operationalNote}
          </TimelineItem>)}</Timeline>
        <Timeline title="Actions" empty="No actions recorded.">{data.actions.map((action) =>
          <TimelineItem key={action.id} heading={action.actionTypeCode} date={action.dueAt}>
            {action.operationalInstruction ?? `Owner: ${action.ownerRoleCode ?? 'not assigned'}`}
          </TimelineItem>)}</Timeline>
        <Timeline title="Restricted referrals" empty="No referrals recorded.">{data.referrals.map((referral) =>
          <TimelineItem key={referral.id} heading={`${referral.targetServiceCode} · ${referral.statusCode}`} date={referral.referredAt}>
            {referral.referralTypeCode}{referral.externalReference ? ` · ${referral.externalReference}` : ''}
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
    event.preventDefault(); const fd = new FormData(event.currentTarget);
    try {
      await recordCaseContact(caseId, {
        channelCode: String(fd.get('channelCode')), outcomeCode: String(fd.get('outcomeCode')),
        attemptedAt: new Date().toISOString(), communicationLocale: String(fd.get('locale') || 'en-GB'),
        operationalNote: String(fd.get('note') || ''),
      }); event.currentTarget.reset(); await onDone();
    } catch (cause) { onError(message(cause)); }
  }
  return <FormCard title="Record contact"><form onSubmit={(event) => void submit(event)} className="space-y-3">
    <PickField name="channelCode" label="Channel" values={['portal', 'email', 'telephone', 'sms', 'in-person', 'letter']} />
    <PickField name="outcomeCode" label="Outcome" values={['no-response', 'contacted', 'response-received', 'wrong-contact-details']} />
    <PickField name="locale" label="Communication language" values={['en-GB', 'cy']} />
    <LabelledField label="Operational note" htmlFor="ec-note"><Textarea id="ec-note" name="note" maxLength={500} /></LabelledField>
    <p className="text-xs text-neutral-500">Do not enter medical, disability, safeguarding or other restricted narrative.</p>
    <Button type="submit" className="w-full">Save contact</Button>
  </form></FormCard>;
}
function ActionForm({ caseId, onDone, onError }: FormProps) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const fd = new FormData(event.currentTarget);
    try {
      await addCaseAction(caseId, {
        actionTypeCode: String(fd.get('actionTypeCode')), ownerRoleCode: String(fd.get('ownerRoleCode')),
        dueAt: new Date(String(fd.get('dueAt'))).toISOString(),
      }); event.currentTarget.reset(); await onDone();
    } catch (cause) { onError(message(cause)); }
  }
  return <FormCard title="Add action"><form onSubmit={(event) => void submit(event)} className="space-y-3">
    <LabelledField label="Action type" htmlFor="ec-action-type" required><Input id="ec-action-type" required name="actionTypeCode" /></LabelledField>
    <PickField name="ownerRoleCode" label="Owner" values={['engagement-officer', 'personal-tutor']} />
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
    <PickField name="decision" label="Decision" values={['continue', 'close', 'refer']} />
    <PickField name="outcomeCode" label="Closure outcome" values={['engagement-restored', 'no-concern', 'support-continuing', 'no-response']} />
    <PickField name="targetServiceCode" label="Referral target" values={['wellbeing', 'safeguarding', 'academic-status-review', 'sponsor-compliance-review']} />
    <Button type="submit" className="w-full">Record review</Button>
  </form></FormCard>;
}
interface FormProps { caseId: string; onDone: () => Promise<void>; onError: (value: string) => void }
function message(cause: unknown) { return cause instanceof ApiError ? (cause.detail ?? cause.message) : 'Action failed'; }
function FormCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card><CardHeader title={title} /><CardBody>{children}</CardBody></Card>;
}
function PickField({ name, label, values }: { name: string; label: string; values: string[] }) {
  return <LabelledField label={label} htmlFor={`ec-${name}`}>
    <Select id={`ec-${name}`} name={name}>{values.map((value) => <option key={value}>{value}</option>)}</Select>
  </LabelledField>;
}
function Timeline({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return <Card><CardHeader title={title} /><CardBody>
    <div className="space-y-3">{children.length ? children : <p className="text-sm text-neutral-500">{empty}</p>}</div>
  </CardBody></Card>;
}
function TimelineItem({ heading, date, children }: { heading: string; date: string | null; children: React.ReactNode }) {
  return <div className="border-l-2 border-primary-200 pl-3"><div className="flex justify-between gap-3">
    <p className="text-sm font-medium">{heading}</p><time className="text-xs text-neutral-500">{date ? new Date(date).toLocaleString('en-GB') : 'No date'}</time></div>
    <div className="mt-1 text-sm text-neutral-600">{children}</div></div>;
}
