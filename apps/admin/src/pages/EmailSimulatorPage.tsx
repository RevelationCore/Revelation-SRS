import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PageHeader, Card, CardHeader, CardBody, Button, Input, Textarea, LabelledField, Spinner, StatusNotice,
} from '@revelation-srs/ui';

import {
  type SimulatorMailbox, type SimulatorMessage, getEmailSettings, listSimulatorMailboxes, listSimulatorMessages, sendToInstitution,
} from '../api/email.js';
import { errorText } from './WellbeingShared.js';

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * The fake mail server, seen from outside the institution: every external
 * mailbox the SRS has written to, what each received, and a form to send
 * mail in as that person (or anyone). Development and demo only.
 */
export function EmailSimulatorPage() {
  const [institutionAddress, setInstitutionAddress] = useState('');
  const [mailboxes, setMailboxes] = useState<SimulatorMailbox[] | null>(null);
  const [selected, setSelected] = useState('');
  const [messages, setMessages] = useState<SimulatorMessage[] | null>(null);
  const [replyTo, setReplyTo] = useState<SimulatorMessage | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadMailboxes = useCallback(async () => {
    try {
      const [s, boxes] = await Promise.all([getEmailSettings(), listSimulatorMailboxes()]);
      setInstitutionAddress(s.fromAddress);
      setMailboxes(boxes);
    } catch (err) {
      setError(errorText(err, 'Failed to load the fake mail server'));
    }
  }, []);

  const loadMessages = useCallback(async (address: string) => {
    setMessages(null);
    try {
      setMessages(await listSimulatorMessages(address));
    } catch (err) {
      setError(errorText(err, 'Failed to load the mailbox'));
    }
  }, []);

  useEffect(() => { void loadMailboxes(); }, [loadMailboxes]);
  useEffect(() => { if (selected) void loadMessages(selected); }, [selected, loadMessages]);

  async function sent(from: string) {
    setNotice(`Delivered to ${institutionAddress}. It is now in the institution's inbox.`);
    setReplyTo(null);
    await loadMailboxes();
    setSelected(from.toLowerCase());
    await loadMessages(from.toLowerCase());
  }

  return (
    <div>
      <PageHeader
        title="Email simulator"
        description="The fake mail server that carries the SRS's email in development and demos. Nothing here reaches a real inbox."
      />
      <p className="mt-2 text-sm">
        <Link to="/email" className="text-primary-600 hover:underline">Open the institution's mailbox</Link>
      </p>
      {notice && <div className="mt-4"><StatusNotice>{notice}</StatusNotice></div>}
      {error && <p role="alert" className="mt-4 text-sm text-danger-600">{error}</p>}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="External mailboxes" description="Addresses the institution has written to or heard from." />
          <CardBody>
            {mailboxes === null ? <div className="flex justify-center py-6"><Spinner /></div>
              : mailboxes.length === 0 ? <p className="text-sm text-neutral-600">No mail yet. Send something from the institution, or send mail in below.</p>
              : (
                <ul className="divide-y divide-neutral-100" aria-label="External mailboxes">
                  {mailboxes.map((b) => (
                    <li key={b.address}>
                      <button type="button" onClick={() => { setSelected(b.address); setReplyTo(null); }}
                        aria-current={b.address === selected ? 'true' : undefined}
                        className={`w-full px-2 py-2 text-left text-sm hover:bg-neutral-50 ${b.address === selected ? 'bg-primary-50 font-medium' : ''}`}>
                        <span className="block truncate">{b.address}</span>
                        <span className="text-xs text-neutral-500">{b.received} received · {b.sent} sent · {when(b.lastActivity)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
          </CardBody>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          {selected && (
            <Card>
              <CardHeader title={`Mailbox of ${selected}`} />
              <CardBody>
                {messages === null ? <div className="flex justify-center py-6"><Spinner /></div>
                  : messages.length === 0 ? <p className="text-sm text-neutral-600">Empty.</p>
                  : (
                    <ol className="space-y-3" aria-label={`Messages for ${selected}`}>
                      {messages.map((m) => (
                        <li key={m.id} className={`rounded border p-3 text-sm ${m.directionCode === 'to-external' ? 'border-neutral-200' : 'border-primary-100 bg-primary-50'}`}>
                          <p className="text-xs text-neutral-500">
                            {m.directionCode === 'to-external' ? `Received from ${m.fromAddress}` : `Sent to ${m.toAddress}`} · {when(m.createdAt)}
                          </p>
                          <p className="mt-1 font-medium">{m.subject}</p>
                          <p className="mt-1 whitespace-pre-wrap">{m.bodyText}</p>
                          {m.directionCode === 'to-external' && (
                            <Button size="sm" variant="secondary" className="mt-2" onClick={() => setReplyTo(m)}>
                              Reply as {selected}
                            </Button>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
              </CardBody>
            </Card>
          )}

          <SendInForm
            key={replyTo?.id ?? selected}
            institutionAddress={institutionAddress}
            defaultFrom={replyTo ? replyTo.toAddress : selected}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            onSent={(from) => void sent(from)}
          />
        </div>
      </div>
    </div>
  );
}

function SendInForm({ institutionAddress, defaultFrom, replyTo, onCancelReply, onSent }: {
  institutionAddress: string; defaultFrom: string; replyTo: SimulatorMessage | null;
  onCancelReply: () => void; onSent: (from: string) => void;
}) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(replyTo?.fromAddress ?? institutionAddress);
  const [subject, setSubject] = useState(replyTo ? (/^re:/i.test(replyTo.subject) ? replyTo.subject : `Re: ${replyTo.subject}`) : '');
  const [bodyText, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (!to && institutionAddress) setTo(institutionAddress); }, [institutionAddress, to]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await sendToInstitution({
        from: from.trim(), to: to.trim(), subject: subject.trim(), bodyText,
        ...(replyTo ? { inReplyToMessageId: replyTo.messageId } : {}),
      });
      onSent(from.trim());
    } catch (err) {
      setError(errorText(err, 'The fake mail server did not accept the message'));
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={replyTo ? `Reply to "${replyTo.subject}"` : 'Send an email to the institution'}
        description="Arrives through the same inbound hook a real email provider would call. A sender whose address is on a student record is matched to that student."
        actions={replyTo ? <Button size="sm" variant="ghost" onClick={onCancelReply}>Cancel reply</Button> : undefined}
      />
      <CardBody>
        {error && <p role="alert" className="mb-3 text-sm text-danger-600">{error}</p>}
        <form onSubmit={(e) => void submit(e)} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <LabelledField label="From (external sender)" htmlFor="sim-from" required>
            <Input id="sim-from" type="email" value={from} onChange={(e) => setFrom(e.target.value)} />
          </LabelledField>
          <LabelledField label="To (institution address)" htmlFor="sim-to" required>
            <Input id="sim-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} />
          </LabelledField>
          <div className="md:col-span-2">
            <LabelledField label="Subject" htmlFor="sim-subject">
              <Input id="sim-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </LabelledField>
          </div>
          <div className="md:col-span-2">
            <LabelledField label="Message" htmlFor="sim-body" required>
              <Textarea id="sim-body" rows={5} value={bodyText} onChange={(e) => setBody(e.target.value)} />
            </LabelledField>
          </div>
          <div className="md:col-span-2">
            <Button type="submit" disabled={busy || !from.trim() || !to.trim() || !bodyText.trim()}>{busy ? 'Sending…' : 'Send to the institution'}</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
