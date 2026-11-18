import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { startTestApp, type TestApp } from './helpers/test-app.js';

/**
 * Email through the fake mail server: staff send and reply from the
 * institution's mailbox; external people send in through the simulator (the
 * same path as a provider's inbound hook); the email channel of the
 * communications dispatch now really sends.
 */

interface Message {
  id: string; directionCode: string; fromAddress: string; toAddress: string; subject: string; bodyText: string;
  personId: string | null; threadId: string; inReplyToId: string | null; communicationDispatchId: string | null;
  statusCode: string; failureReason: string | null; transportCode: string; transportMessageId: string | null;
  readAt: string | null; readBy: string | null;
}
interface SimMessage { directionCode: string; messageId: string; fromAddress: string; toAddress: string; subject: string; bodyText: string; inReplyToMessageId: string | null }

let ctx: TestApp;
let registry: string;
let tenantAdmin: string;
let integration: string;
let personId: string;
const STUDENT_EMAIL = 'nina.rahman@student.example.ac.uk';

async function call<T>(jwt: string, method: 'GET' | 'POST', url: string, payload?: unknown): Promise<{ status: number; body: T }> {
  const res = await ctx.app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${jwt}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
}

async function enableEmailChannel(on: boolean): Promise<void> {
  const flags = (await call<Array<{ flagKey: string; featureFlagId: string }>>(tenantAdmin, 'GET', '/feature-flags')).body;
  const flag = flags.find((f) => f.flagKey === 'communications.channel.email.enabled')!;
  await ctx.db.execute(sql`
    UPDATE feature_flag_assignment
    SET active_to = GREATEST(now() - interval '1 millisecond', active_from + interval '1 millisecond'), status_code = 'retired'
    WHERE flag_id = ${flag.featureFlagId}::uuid AND tenant_id = ${ctx.tenantId}::uuid AND (active_to IS NULL OR active_to > now())
  `);
  const res = await call(tenantAdmin, 'POST', `/feature-flags/${flag.featureFlagId}/assignments`, { variantKey: on ? 'on' : 'off', activeFrom: new Date(Date.now() - 1000).toISOString() });
  expect(res.status).toBe(201);
}

beforeAll(async () => {
  ctx = await startTestApp();
  registry = await ctx.makeJwt();
  tenantAdmin = await ctx.makeJwt({ roles: ['tenant-administrator'] });
  integration = await ctx.makeJwt({ roles: ['integration-service'] });
  const student = await call<{ personId: string }>(registry, 'POST', '/students', {
    legalFirstName: 'Nina', legalFamilyName: 'Rahman', emailInstitutional: STUDENT_EMAIL,
  });
  expect(student.status).toBe(201);
  personId = student.body.personId;
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

describe('sending from the institution', () => {
  it('reports the sending address and the fake transport', async () => {
    const res = await call<{ fromAddress: string; transportCode: string; unreadCount: number }>(registry, 'GET', '/email/settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ fromAddress: 'registry@revelation.example.ac.uk', transportCode: 'fake', unreadCount: 0 });
  });

  it('sends to a student, matches them by address, and the fake server delivers it to their mailbox', async () => {
    const sent = await call<Message>(registry, 'POST', '/email/messages', { to: STUDENT_EMAIL, subject: 'Your timetable', bodyText: 'Your timetable is ready.' });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({
      directionCode: 'outbound', fromAddress: 'registry@revelation.example.ac.uk', toAddress: STUDENT_EMAIL,
      statusCode: 'sent', failureReason: null, transportCode: 'fake', personId, inReplyToId: null,
    });
    expect(sent.body.threadId).toBe(sent.body.id);

    const mailbox = await call<SimMessage[]>(registry, 'GET', `/email-simulator/messages?address=${encodeURIComponent(STUDENT_EMAIL.toUpperCase())}`);
    expect(mailbox.body).toEqual([expect.objectContaining({
      directionCode: 'to-external', messageId: sent.body.transportMessageId, subject: 'Your timetable', bodyText: 'Your timetable is ready.',
    })]);
    const boxes = await call<Array<{ address: string; received: number; sent: number }>>(registry, 'GET', '/email-simulator/mailboxes');
    expect(boxes.body).toContainEqual(expect.objectContaining({ address: STUDENT_EMAIL, received: 1, sent: 0 }));
  });

  it('records a refused delivery as failed and delivers nothing', async () => {
    const res = await call<Message>(registry, 'POST', '/email/messages', { to: 'someone@nowhere.invalid', subject: 'Hello', bodyText: 'Hi' });
    expect(res.status).toBe(201);
    expect(res.body.statusCode).toBe('failed');
    expect(res.body.failureReason).toMatch(/refused someone@nowhere\.invalid/);
    expect((await call<SimMessage[]>(registry, 'GET', '/email-simulator/messages?address=someone@nowhere.invalid')).body).toEqual([]);
  });

  it('rejects an address that is not one', async () => {
    expect((await call(registry, 'POST', '/email/messages', { to: 'not-an-address', subject: 'x', bodyText: 'y' })).status).toBe(422);
  });
});

describe('receiving, reading and replying', () => {
  it('threads a student\'s email, their reply-to-reply, and the staff reply', async () => {
    const sendIn = await call<{ messageId: string; srsMessageId: string }>(registry, 'POST', '/email-simulator/send-to-institution', {
      from: STUDENT_EMAIL, subject: 'Extension request', bodyText: 'Could I have an extension?',
    });
    expect(sendIn.status).toBe(201);

    const settings = await call<{ unreadCount: number }>(registry, 'GET', '/email/settings');
    expect(settings.body.unreadCount).toBe(1);
    const unread = await call<Message[]>(registry, 'GET', '/email/messages?direction=inbound&unread=true');
    expect(unread.body).toEqual([expect.objectContaining({
      id: sendIn.body.srsMessageId, directionCode: 'inbound', statusCode: 'received', fromAddress: STUDENT_EMAIL,
      toAddress: 'registry@revelation.example.ac.uk', personId, readAt: null, transportMessageId: sendIn.body.messageId,
    })]);

    const read = await call<Message>(registry, 'POST', `/email/messages/${sendIn.body.srsMessageId}/read`);
    expect(read.body.readAt).not.toBeNull();
    expect(read.body.readBy).toBe('test-user-001');
    expect((await call<{ unreadCount: number }>(registry, 'GET', '/email/settings')).body.unreadCount).toBe(0);

    const reply = await call<Message>(registry, 'POST', '/email/messages', {
      to: STUDENT_EMAIL, subject: 'Re: Extension request', bodyText: 'Yes, one week.', inReplyToId: sendIn.body.srsMessageId,
    });
    expect(reply.body).toMatchObject({ threadId: sendIn.body.srsMessageId, inReplyToId: sendIn.body.srsMessageId, personId, statusCode: 'sent' });

    // The student's client sets In-Reply-To to the reply they received.
    const delivered = (await call<SimMessage[]>(registry, 'GET', `/email-simulator/messages?address=${STUDENT_EMAIL}`)).body
      .find((m) => m.subject === 'Re: Extension request')!;
    expect(delivered.inReplyToMessageId).toBe(sendIn.body.messageId);
    const second = await call<{ srsMessageId: string }>(registry, 'POST', '/email-simulator/send-to-institution', {
      from: STUDENT_EMAIL, subject: 'Re: Re: Extension request', bodyText: 'Thank you!', inReplyToMessageId: delivered.messageId,
    });

    const thread = await call<{ message: Message; thread: Message[] }>(registry, 'GET', `/email/messages/${second.body.srsMessageId}`);
    expect(thread.body.thread.map((m) => m.bodyText)).toEqual(['Could I have an extension?', 'Yes, one week.', 'Thank you!']);
    expect(thread.body.message.threadId).toBe(sendIn.body.srsMessageId);
  });

  it('leaves mail from an unknown address unmatched', async () => {
    const res = await call<{ srsMessageId: string }>(registry, 'POST', '/email-simulator/send-to-institution', {
      from: 'parent@example.com', subject: 'Question', bodyText: 'Hello',
    });
    const msg = await call<{ message: Message }>(registry, 'GET', `/email/messages/${res.body.srsMessageId}`);
    expect(msg.body.message.personId).toBeNull();
  });

  it('the provider hook records a message once, however often it is retried', async () => {
    const payload = { messageId: '<retry-1@provider.example>', from: 'applicant@example.com', to: 'admissions@revelation.example.ac.uk', subject: 'Offer', bodyText: 'I accept', provider: 'test-provider' };
    const first = await call<{ id: string; duplicate: boolean }>(integration, 'POST', '/email/inbound', payload);
    const again = await call<{ id: string; duplicate: boolean }>(integration, 'POST', '/email/inbound', payload);
    expect(first.body.duplicate).toBe(false);
    expect(again.body).toEqual({ id: first.body.id, duplicate: true });
    const msg = await call<{ message: Message }>(registry, 'GET', `/email/messages/${first.body.id}`);
    expect(msg.body.message).toMatchObject({ transportCode: 'test-provider', toAddress: 'admissions@revelation.example.ac.uk' });
  });
});

describe('access', () => {
  it('keeps the mailbox, the hook and the simulator to their roles', async () => {
    const student = await ctx.makeJwt({ roles: ['student'] });
    expect((await call(student, 'GET', '/email/messages')).status).toBe(403);
    expect((await call(student, 'POST', '/email/messages', { to: STUDENT_EMAIL, subject: 'x', bodyText: 'y' })).status).toBe(403);
    expect((await call(student, 'GET', '/email-simulator/mailboxes')).status).toBe(403);
    expect((await call(registry, 'POST', '/email/inbound', { messageId: '<x@y>', from: 'a@b.example', to: 'c@d.example', subject: 's', bodyText: 'b' })).status).toBe(403);
  });

  it('shows another tenant none of this tenant\'s mail', async () => {
    const other = await ctx.makeJwt({ tenantId: ctx.secondTenantId });
    expect((await call<Message[]>(other, 'GET', '/email/messages')).body).toEqual([]);
    expect((await call<unknown[]>(other, 'GET', '/email-simulator/mailboxes')).body).toEqual([]);
  });
});

describe('communications dispatch on the email channel', () => {
  it('renders the template and sends it, linked to the dispatch', async () => {
    await enableEmailChannel(true);
    try {
      const res = await call<{ dispatchId: string; statusCode: string }>(registry, 'POST', '/communications/dispatch', {
        templateKey: 'enrolment.welcome', channelCode: 'email', subjectEntityType: 'person', subjectEntityId: personId,
        payload: { studentName: 'Nina', institutionName: 'Test University', academicYear: '2026-27' },
      });
      expect(res.body.statusCode).toBe('dispatched');

      const outbound = (await call<Message[]>(registry, 'GET', `/email/messages?direction=outbound&personId=${personId}`)).body;
      const sent = outbound.find((m) => m.communicationDispatchId === res.body.dispatchId)!;
      expect(sent).toMatchObject({ toAddress: STUDENT_EMAIL, subject: 'Welcome to your studies at Test University', statusCode: 'sent' });
      expect(sent.bodyText).toContain('Dear Nina');
      expect(sent.bodyText).toContain('for 2026-27 has been confirmed');
    } finally {
      await enableEmailChannel(false);
    }
  });

  it('fails a dispatch with no address to send to', async () => {
    await enableEmailChannel(true);
    try {
      const res = await call<{ statusCode: string; suppressionReason?: string }>(registry, 'POST', '/communications/dispatch', {
        templateKey: 'enrolment.welcome', channelCode: 'email', subjectEntityType: 'enrolment', subjectEntityId: '00000000-0000-0000-0000-000000000099',
      });
      expect(res.body.statusCode).toBe('failed');
      expect(res.body.suppressionReason).toMatch(/No email address/);
    } finally {
      await enableEmailChannel(false);
    }
  });
});
