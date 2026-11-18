import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  PageHeader, Card, CardHeader, CardBody, Button, Input, Textarea, LabelledField, Badge, Spinner,
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@revelation-srs/ui';

import {
  type EmailMessage, type EmailSettings, getEmailSettings, getEmailThread, listEmail, markEmailRead, sendEmail,
} from '../api/email.js';
import { getStudent } from '../api/students.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { PersonCell, StudentPicker, errorText, usePersonNames } from './WellbeingShared.js';

type Folder = 'inbox' | 'sent';

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

/** The institution's mailbox: mail from students and others, and what the SRS has sent. */
export function EmailPage() {
  const { roles } = useAuth();
  const canSend = userHasAnyPermission(roles, ['email:send']);
  const canSimulate = userHasAnyPermission(roles, ['email-simulator:use']);
  const [params, setParams] = useSearchParams();
  const openId = params.get('message');

  const [folder, setFolder] = useState<Folder>('inbox');
  const [settings, setSettings] = useState<EmailSettings | null>(null);
  const [messages, setMessages] = useState<EmailMessage[] | null>(null);
  const [error, setError] = useState('');
  const [composing, setComposing] = useState(false);
  const names = usePersonNames((messages ?? []).flatMap((m) => (m.personId ? [m.personId] : [])));

  const load = useCallback(async () => {
    setError('');
    try {
      const [s, list] = await Promise.all([getEmailSettings(), listEmail({ direction: folder === 'inbox' ? 'inbound' : 'outbound' })]);
      setSettings(s);
      setMessages(list);
    } catch (err) {
      setError(errorText(err, 'Failed to load the mailbox'));
    }
  }, [folder]);

  useEffect(() => { void load(); }, [load]);

  function open(id: string | null) {
    setComposing(false);
    setParams(id ? { message: id } : {});
  }

  return (
    <div>
      <PageHeader
        title="Email"
        description={settings
          ? `Mail to and from ${settings.fromAddress}. ${settings.transportCode === 'fake' ? 'Mail is carried by the fake mail server: nothing reaches a real inbox.' : ''}`
          : 'The institution\'s mailbox.'}
        actions={canSend ? <Button size="sm" onClick={() => { setParams({}); setComposing((v) => !v); }}>{composing ? 'Cancel' : 'New message'}</Button> : undefined}
      />
      {settings?.transportCode === 'fake' && canSimulate && (
        <p className="mt-2 text-sm">
          <Link to="/operations/email-simulator" className="text-primary-600 hover:underline">Open the email simulator</Link> to see what recipients received, or to send mail in as a student.
        </p>
      )}

      {composing && (
        <div className="mt-4">
          <Compose onSent={(m) => { setComposing(false); setFolder('sent'); open(m.id); void load(); }} />
        </div>
      )}

      {openId && !composing && (
        <div className="mt-4">
          <ThreadView messageId={openId} canSend={canSend} onClose={() => open(null)} onChanged={() => void load()} />
        </div>
      )}

      <Tabs value={folder} onValueChange={(v) => setFolder(v as Folder)} className="mt-6">
        <TabsList>
          <TabsTrigger value="inbox">Inbox{settings && settings.unreadCount > 0 ? ` (${settings.unreadCount} unread)` : ''}</TabsTrigger>
          <TabsTrigger value="sent">Sent</TabsTrigger>
        </TabsList>
        {(['inbox', 'sent'] as const).map((f) => (
          <TabsContent key={f} value={f}>
            {error ? <p className="text-sm text-danger-600">{error}</p>
              : messages === null ? <div className="flex justify-center py-10"><Spinner /></div>
              : messages.length === 0 ? <p className="py-4 text-sm text-neutral-600">{f === 'inbox' ? 'No mail has been received.' : 'Nothing has been sent.'}</p>
              : (
                <Card>
                  <ul className="divide-y divide-neutral-100" aria-label={f === 'inbox' ? 'Received messages' : 'Sent messages'}>
                    {messages.map((m) => {
                      const unread = m.directionCode === 'inbound' && !m.readAt;
                      return (
                        <li key={m.id} className={`flex items-start gap-4 px-4 py-3 ${m.id === openId ? 'bg-primary-50' : ''}`}>
                          <div className="min-w-0 flex-1">
                            <button type="button" onClick={() => open(m.id)} className={`block truncate text-left text-sm hover:underline ${unread ? 'font-semibold text-neutral-900' : 'text-neutral-800'}`}>
                              {m.subject}
                            </button>
                            <p className="truncate text-xs text-neutral-500">
                              {f === 'inbox' ? `From ${m.fromAddress}` : `To ${m.toAddress}`}
                              {m.communicationDispatchId ? ' · automated notice' : ''}
                            </p>
                            {m.personId && <p className="text-xs"><PersonCell personId={m.personId} names={names} /></p>}
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <span className="text-xs text-neutral-500">{when(m.createdAt)}</span>
                            {unread && <Badge value="unread" label="Unread" />}
                            {m.statusCode === 'failed' && <Badge value="failed" label="Not delivered" />}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function ThreadView({ messageId, canSend, onClose, onChanged }: { messageId: string; canSend: boolean; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<{ message: EmailMessage; thread: EmailMessage[] } | null>(null);
  const [error, setError] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const names = usePersonNames(data?.message.personId ? [data.message.personId] : []);

  const load = useCallback(async () => {
    setError('');
    try {
      const d = await getEmailThread(messageId);
      if (d.message.directionCode === 'inbound' && !d.message.readAt) {
        await markEmailRead(messageId);
        onChanged();
      }
      setData(d);
    } catch (err) {
      setError(errorText(err, 'Failed to open the message'));
    }
  }, [messageId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(); }, [load]);

  if (error) return <p className="text-sm text-danger-600">{error}</p>;
  if (!data) return <div className="flex justify-center py-6"><Spinner /></div>;

  const { message, thread } = data;
  // Reply to the latest inbound message in the thread, or to this one.
  const replyTo = [...thread].reverse().find((m) => m.directionCode === 'inbound') ?? message;
  const replyAddress = replyTo.directionCode === 'inbound' ? replyTo.fromAddress : replyTo.toAddress;
  const replySubject = /^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`;

  async function sendReply(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await sendEmail({ to: replyAddress, subject: replySubject, bodyText: reply, inReplyToId: replyTo.id });
      setReply('');
      await load();
      onChanged();
    } catch (err) {
      setError(errorText(err, 'The reply was not sent'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={message.subject}
        description={message.personId ? undefined : 'Not matched to a student: the address is not on any student record.'}
        actions={<Button size="sm" variant="ghost" onClick={onClose}>Close</Button>}
      />
      <CardBody>
        {message.personId && <p className="mb-3 text-sm">Student: <PersonCell personId={message.personId} names={names} /></p>}
        <ol className="space-y-3" aria-label="Conversation">
          {thread.map((m) => (
            <li key={m.id} className={`rounded border p-3 text-sm ${m.directionCode === 'inbound' ? 'border-neutral-200 bg-white' : 'border-primary-100 bg-primary-50'}`}>
              <p className="text-xs text-neutral-500">
                {m.directionCode === 'inbound' ? `From ${m.fromAddress}` : `Sent to ${m.toAddress}`} · {when(m.createdAt)}
              </p>
              {m.statusCode === 'failed' && <p className="mt-1 text-xs text-danger-600">Not delivered: {m.failureReason}</p>}
              <p className="mt-2 whitespace-pre-wrap">{m.bodyText}</p>
            </li>
          ))}
        </ol>
        {canSend && (
          <form onSubmit={(e) => void sendReply(e)} className="mt-4 space-y-2">
            <LabelledField label={`Reply to ${replyAddress}`} htmlFor="email-reply">
              <Textarea id="email-reply" rows={4} value={reply} onChange={(e) => setReply(e.target.value)} />
            </LabelledField>
            <Button type="submit" size="sm" disabled={busy || !reply.trim()}>{busy ? 'Sending…' : 'Send reply'}</Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

function Compose({ onSent }: { onSent: (m: EmailMessage) => void }) {
  const [personId, setPersonId] = useState('');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyText, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function pickStudent(id: string) {
    setPersonId(id);
    if (!id) return;
    try {
      const s = await getStudent(id);
      const address = s.identity?.emailInstitutional ?? s.identity?.emailPersonal;
      if (address) setTo(address);
      else setError('This student has no email address on record');
    } catch (err) {
      setError(errorText(err, 'Could not look up the student'));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const sent = await sendEmail({ to: to.trim(), subject: subject.trim(), bodyText, ...(personId ? { personId } : {}) });
      if (sent.statusCode === 'failed') {
        setError(`Not delivered: ${sent.failureReason ?? 'the mail server refused it'}`);
        setBusy(false);
        return;
      }
      onSent(sent);
    } catch (err) {
      setError(errorText(err, 'The message was not sent'));
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="New message" description="Choose a student to use the address on their record, or type any address." />
      <CardBody>
        {error && <p role="alert" className="mb-3 text-sm text-danger-600">{error}</p>}
        <form onSubmit={(e) => void submit(e)} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <LabelledField label="Student (optional)" htmlFor="compose-student">
            <StudentPicker id="compose-student" value={personId} onChange={(id) => void pickStudent(id)} />
          </LabelledField>
          <LabelledField label="To" htmlFor="compose-to" required>
            <Input id="compose-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} />
          </LabelledField>
          <div className="md:col-span-2">
            <LabelledField label="Subject" htmlFor="compose-subject" required>
              <Input id="compose-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </LabelledField>
          </div>
          <div className="md:col-span-2">
            <LabelledField label="Message" htmlFor="compose-body" required>
              <Textarea id="compose-body" rows={6} value={bodyText} onChange={(e) => setBody(e.target.value)} />
            </LabelledField>
          </div>
          <div className="md:col-span-2">
            <Button type="submit" disabled={busy || !to.trim() || !subject.trim() || !bodyText.trim()}>{busy ? 'Sending…' : 'Send'}</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
