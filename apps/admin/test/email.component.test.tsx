import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { EmailPage } from '../src/pages/EmailPage.js';
import { EmailSimulatorPage } from '../src/pages/EmailSimulatorPage.js';

const API = 'http://localhost:3000/bff/srs';
const INSTITUTION = 'registry@revelation.example.ac.uk';

const inbound = {
  id: 'm1', directionCode: 'inbound', fromAddress: 'nina@student.example.ac.uk', toAddress: INSTITUTION,
  subject: 'Extension request', bodyText: 'Could I have an extension?', personId: 'person-001', threadId: 'm1',
  inReplyToId: null, communicationDispatchId: null, statusCode: 'received', failureReason: null, transportCode: 'fake',
  transportMessageId: '<m1@fake>', sentBy: null, readAt: null, readBy: null, createdAt: '2026-11-18T09:00:00Z',
};

const student = {
  personId: 'person-001', studentNumber: 'S1000001', hesaId: null, personStatusCode: 'student', sourceSystem: null, createdAt: '2025-09-01T00:00:00Z',
  identity: { legalFirstName: 'Nina', legalFamilyName: 'Rahman', preferredName: null, emailInstitutional: 'nina@student.example.ac.uk', emailPersonal: null },
};

describe('email mailbox', () => {
  it('lists unread mail matched to a student, marks it read on opening, and sends a reply in the thread', async () => {
    const state = { read: false, replies: [] as Array<Record<string, unknown>> };
    server.use(
      http.get(`${API}/api/v1/email/settings`, () => HttpResponse.json({ fromAddress: INSTITUTION, transportCode: 'fake', unreadCount: state.read ? 0 : 1 })),
      http.get(`${API}/api/v1/email/messages`, () => HttpResponse.json([{ ...inbound, readAt: state.read ? '2026-11-18T10:00:00Z' : null }])),
      http.get(`${API}/api/v1/email/messages/m1`, () => HttpResponse.json({
        message: { ...inbound, readAt: state.read ? '2026-11-18T10:00:00Z' : null },
        thread: [inbound, ...state.replies],
      })),
      http.post(`${API}/api/v1/email/messages/m1/read`, () => { state.read = true; return HttpResponse.json({ ...inbound, readAt: '2026-11-18T10:00:00Z' }); }),
      http.post(`${API}/api/v1/email/messages`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        const sent = { ...inbound, id: 'm2', directionCode: 'outbound', fromAddress: INSTITUTION, toAddress: body['to'], subject: body['subject'], bodyText: body['bodyText'], inReplyToId: 'm1', statusCode: 'sent', createdAt: '2026-11-18T10:05:00Z' };
        state.replies.push(sent);
        return HttpResponse.json(sent, { status: 201 });
      }),
      http.get(`${API}/api/v1/students/person-001`, () => HttpResponse.json(student)),
    );
    const { container } = renderWithProviders(<EmailPage />, { roles: ['registry-administrator'] });

    expect(await screen.findByRole('tab', { name: 'Inbox (1 unread)' })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Received messages' });
    expect(within(list).getByText('From nina@student.example.ac.uk')).toBeInTheDocument();
    expect(await within(list).findByRole('link', { name: 'Nina Rahman (S1000001)' })).toBeInTheDocument();
    expect(within(list).getByText('Unread')).toBeInTheDocument();
    await expectNoA11yViolations(container);

    await userEvent.click(within(list).getByRole('button', { name: 'Extension request' }));
    expect(await screen.findByText('Could I have an extension?', { selector: 'p' })).toBeInTheDocument();
    expect(await screen.findByRole('tab', { name: 'Inbox' })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Reply to nina@student.example.ac.uk'), 'Yes, one week.');
    await userEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    const conversation = await screen.findByRole('list', { name: 'Conversation' });
    expect(await within(conversation).findByText('Yes, one week.')).toBeInTheDocument();
    expect(state.replies[0]).toMatchObject({ toAddress: 'nina@student.example.ac.uk', subject: 'Re: Extension request', inReplyToId: 'm1' });
  });

  it('shows an automated notice that was not delivered in Sent', async () => {
    const failed = {
      ...inbound, id: 'm9', directionCode: 'outbound', fromAddress: INSTITUTION, toAddress: 'team@nowhere.invalid', subject: '3 overdue tasks',
      personId: null, communicationDispatchId: 'd1', statusCode: 'failed', failureReason: 'The fake mail server refused team@nowhere.invalid', readAt: null,
    };
    server.use(
      http.get(`${API}/api/v1/email/settings`, () => HttpResponse.json({ fromAddress: INSTITUTION, transportCode: 'fake', unreadCount: 0 })),
      http.get(`${API}/api/v1/email/messages`, ({ request }) =>
        HttpResponse.json(new URL(request.url).searchParams.get('direction') === 'outbound' ? [failed] : [])),
    );
    renderWithProviders(<EmailPage />, { roles: ['registry-administrator'] });
    expect(await screen.findByText('No mail has been received.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Sent' }));
    const list = await screen.findByRole('list', { name: 'Sent messages' });
    expect(within(list).getByText('To team@nowhere.invalid · automated notice')).toBeInTheDocument();
    expect(within(list).getByText('Not delivered')).toBeInTheDocument();
  });
});

describe('email simulator', () => {
  it('shows what an external mailbox received and replies into the institution', async () => {
    let sentIn: Record<string, unknown> | null = null;
    const delivered = {
      id: 's1', directionCode: 'to-external', messageId: '<m2@srs>', fromAddress: INSTITUTION, toAddress: 'nina@student.example.ac.uk',
      subject: 'Your timetable', bodyText: 'Your timetable is ready.', inReplyToMessageId: null, createdBy: 'fake-mail-server', createdAt: '2026-11-18T09:00:00Z',
    };
    server.use(
      http.get(`${API}/api/v1/email/settings`, () => HttpResponse.json({ fromAddress: INSTITUTION, transportCode: 'fake', unreadCount: 0 })),
      http.get(`${API}/api/v1/email-simulator/mailboxes`, () => HttpResponse.json([{ address: 'nina@student.example.ac.uk', received: 1, sent: sentIn ? 1 : 0, lastActivity: '2026-11-18T09:00:00Z' }])),
      http.get(`${API}/api/v1/email-simulator/messages`, () => HttpResponse.json([delivered])),
      http.post(`${API}/api/v1/email-simulator/send-to-institution`, async ({ request }) => {
        sentIn = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ messageId: '<x@fake>', srsMessageId: 'm3' }, { status: 201 });
      }),
    );
    const { container } = renderWithProviders(<EmailSimulatorPage />, { roles: ['registry-administrator'] });

    await userEvent.click(await screen.findByRole('button', { name: /nina@student\.example\.ac\.uk/ }));
    const box = await screen.findByRole('list', { name: 'Messages for nina@student.example.ac.uk' });
    expect(within(box).getByText('Your timetable is ready.')).toBeInTheDocument();
    await expectNoA11yViolations(container);

    await userEvent.click(within(box).getByRole('button', { name: 'Reply as nina@student.example.ac.uk' }));
    expect(screen.getByLabelText('Subject')).toHaveValue('Re: Your timetable');
    expect(screen.getByLabelText(/^To \(institution address\)/)).toHaveValue(INSTITUTION);
    await userEvent.type(screen.getByLabelText(/^Message(?!s)/), 'Thanks!');
    await userEvent.click(screen.getByRole('button', { name: 'Send to the institution' }));

    expect(await screen.findByText(/It is now in the institution's inbox/)).toBeInTheDocument();
    expect(sentIn).toEqual({
      from: 'nina@student.example.ac.uk', to: INSTITUTION, subject: 'Re: Your timetable', bodyText: 'Thanks!', inReplyToMessageId: '<m2@srs>',
    });
  });
});
