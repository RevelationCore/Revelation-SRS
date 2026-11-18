import { api } from './client.js';

// The institution's mailbox, and the fake mail server that stands in for
// the outside world (development and demo only).

export interface EmailMessage {
  id: string;
  directionCode: 'outbound' | 'inbound';
  fromAddress: string;
  toAddress: string;
  subject: string;
  bodyText: string;
  personId: string | null;
  threadId: string;
  inReplyToId: string | null;
  communicationDispatchId: string | null;
  statusCode: 'sent' | 'failed' | 'received';
  failureReason: string | null;
  transportCode: string;
  transportMessageId: string | null;
  sentBy: string | null;
  readAt: string | null;
  readBy: string | null;
  createdAt: string;
}

export interface EmailSettings {
  fromAddress: string;
  transportCode: string;
  unreadCount: number;
}

export function getEmailSettings(): Promise<EmailSettings> {
  return api.get('/api/v1/email/settings');
}

export function listEmail(query: { direction?: 'inbound' | 'outbound'; personId?: string; unread?: boolean } = {}): Promise<EmailMessage[]> {
  const q = new URLSearchParams();
  if (query.direction) q.set('direction', query.direction);
  if (query.personId) q.set('personId', query.personId);
  if (query.unread) q.set('unread', 'true');
  const s = q.toString();
  return api.get(`/api/v1/email/messages${s ? `?${s}` : ''}`);
}

export function getEmailThread(messageId: string): Promise<{ message: EmailMessage; thread: EmailMessage[] }> {
  return api.get(`/api/v1/email/messages/${messageId}`);
}

export function markEmailRead(messageId: string): Promise<EmailMessage> {
  return api.post(`/api/v1/email/messages/${messageId}/read`);
}

export function sendEmail(input: { to: string; subject: string; bodyText: string; personId?: string; inReplyToId?: string }): Promise<EmailMessage> {
  return api.post('/api/v1/email/messages', input);
}

// ── Fake mail server ─────────────────────────────────────────────────────────

export interface SimulatorMailbox {
  address: string;
  received: number;
  sent: number;
  lastActivity: string;
}

export interface SimulatorMessage {
  id: string;
  directionCode: 'to-external' | 'to-institution';
  messageId: string;
  fromAddress: string;
  toAddress: string;
  subject: string;
  bodyText: string;
  inReplyToMessageId: string | null;
  createdBy: string;
  createdAt: string;
}

export function listSimulatorMailboxes(): Promise<SimulatorMailbox[]> {
  return api.get('/api/v1/email-simulator/mailboxes');
}

export function listSimulatorMessages(address: string): Promise<SimulatorMessage[]> {
  return api.get(`/api/v1/email-simulator/messages?address=${encodeURIComponent(address)}`);
}

export function sendToInstitution(input: {
  from: string; to?: string; subject: string; bodyText: string; inReplyToMessageId?: string;
}): Promise<{ messageId: string; srsMessageId: string }> {
  return api.post('/api/v1/email-simulator/send-to-institution', input);
}
