import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  addCaseAction, getInterventionCase, recordCaseContact, reviewCase, type InterventionCaseView,
} from '../api/engagement.js';
import { ApiError } from '../api/client.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';

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
  if (!data) return <p role="alert" className="text-red-700">{error}</p>;
  const current = data.intervention;
  return <section>
    <Link to="/engagement" className="text-sm text-indigo-600">← Engagement workspace</Link>
    <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-xl font-semibold">Intervention case</h1>
        <p className="mt-1 text-sm text-gray-600">Student {current.personId.slice(0, 8)} · assigned to {current.assignedActorId ?? current.assignedRoleCode ?? 'unassigned'}</p></div>
      <Badge value={current.statusCode} />
    </div>
    <div className="mt-5 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
      This case coordinates support. Academic-status and sponsor-reporting decisions remain separate authorised processes.
    </div>
    {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
    <div className="mt-6 grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Timeline title="Contacts" empty="No contact attempts recorded.">{data.contacts.map((contact) =>
          <TimelineItem key={contact.id} heading={`${contact.channelCode} · ${contact.outcomeCode}`} date={contact.attemptedAt}>
            {contact.communicationLocale && <span className="mr-2 rounded bg-gray-100 px-2 py-0.5 text-xs">Language: {contact.communicationLocale}</span>}
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
  return <Card title="Record contact"><form onSubmit={(event) => void submit(event)} className="space-y-3">
    <Select name="channelCode" label="Channel" values={['portal', 'email', 'telephone', 'sms', 'in-person', 'letter']} />
    <Select name="outcomeCode" label="Outcome" values={['no-response', 'contacted', 'response-received', 'wrong-contact-details']} />
    <Select name="locale" label="Communication language" values={['en-GB', 'cy']} />
    <label className="block text-sm">Operational note<textarea name="note" maxLength={500} className="mt-1 w-full rounded border px-3 py-2" /></label>
    <p className="text-xs text-gray-500">Do not enter medical, disability, safeguarding or other restricted narrative.</p>
    <Submit>Save contact</Submit>
  </form></Card>;
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
  return <Card title="Add action"><form onSubmit={(event) => void submit(event)} className="space-y-3">
    <label className="block text-sm">Action type<input required name="actionTypeCode" className="mt-1 w-full rounded border px-3 py-2" /></label>
    <Select name="ownerRoleCode" label="Owner" values={['engagement-officer', 'personal-tutor']} />
    <label className="block text-sm">Due date<input required name="dueAt" type="date" className="mt-1 w-full rounded border px-3 py-2" /></label>
    <Submit>Add action</Submit>
  </form></Card>;
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
  return <Card title="Review case"><form onSubmit={(event) => void submit(event)} className="space-y-3">
    <Select name="decision" label="Decision" values={['continue', 'close', 'refer']} />
    <Select name="outcomeCode" label="Closure outcome" values={['engagement-restored', 'no-concern', 'support-continuing', 'no-response']} />
    <Select name="targetServiceCode" label="Referral target" values={['wellbeing', 'safeguarding', 'academic-status-review', 'sponsor-compliance-review']} />
    <Submit>Record review</Submit>
  </form></Card>;
}
interface FormProps { caseId: string; onDone: () => Promise<void>; onError: (value: string) => void }
function message(cause: unknown) { return cause instanceof ApiError ? (cause.detail ?? cause.message) : 'Action failed'; }
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded border bg-white p-4"><h2 className="mb-3 font-semibold">{title}</h2>{children}</div>;
}
function Select({ name, label, values }: { name: string; label: string; values: string[] }) {
  return <label className="block text-sm">{label}<select name={name} className="mt-1 w-full rounded border px-3 py-2">{values.map((value) => <option key={value}>{value}</option>)}</select></label>;
}
function Submit({ children }: { children: React.ReactNode }) {
  return <button className="w-full rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700">{children}</button>;
}
function Timeline({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return <div className="rounded border bg-white p-4"><h2 className="font-semibold">{title}</h2>
    <div className="mt-3 space-y-3">{children.length ? children : <p className="text-sm text-gray-500">{empty}</p>}</div></div>;
}
function TimelineItem({ heading, date, children }: { heading: string; date: string | null; children: React.ReactNode }) {
  return <div className="border-l-2 border-indigo-200 pl-3"><div className="flex justify-between gap-3">
    <p className="text-sm font-medium">{heading}</p><time className="text-xs text-gray-500">{date ? new Date(date).toLocaleString('en-GB') : 'No date'}</time></div>
    <div className="mt-1 text-sm text-gray-600">{children}</div></div>;
}
