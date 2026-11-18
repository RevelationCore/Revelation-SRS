import { randomUUID } from 'node:crypto';

import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { EmailMessage } from '@revelation-srs/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ValidationError } from '@revelation-srs/domain';

import { isEmailAddress } from '../platform/email/email-service.js';
import {
  listSimulatorMailboxes, listSimulatorMessages, recordSimulatorSendIn,
} from '../platform/integration/simulators/email-simulator.js';

const ErrorSchema = Type.Object({ type: Type.String(), title: Type.String(), status: Type.Number(), detail: Type.Optional(Type.String()) });
const Nullable = <T extends ReturnType<typeof Type.String>>(t: T) => Type.Union([t, Type.Null()]);

const MessageSchema = Type.Object({
  id:                      Type.String(),
  directionCode:           Type.String(),
  fromAddress:             Type.String(),
  toAddress:               Type.String(),
  subject:                 Type.String(),
  bodyText:                Type.String(),
  personId:                Nullable(Type.String()),
  threadId:                Type.String(),
  inReplyToId:             Nullable(Type.String()),
  communicationDispatchId: Nullable(Type.String()),
  statusCode:              Type.String(),
  failureReason:           Nullable(Type.String()),
  transportCode:           Type.String(),
  transportMessageId:      Nullable(Type.String()),
  sentBy:                  Nullable(Type.String()),
  readAt:                  Nullable(Type.String()),
  readBy:                  Nullable(Type.String()),
  createdAt:               Type.String(),
});

const SimulatorMessageSchema = Type.Object({
  id:                 Type.String(),
  directionCode:      Type.String(),
  messageId:          Type.String(),
  fromAddress:        Type.String(),
  toAddress:          Type.String(),
  subject:            Type.String(),
  bodyText:           Type.String(),
  inReplyToMessageId: Nullable(Type.String()),
  createdBy:          Type.String(),
  createdAt:          Type.String(),
});

function wire(m: EmailMessage) {
  return { ...m, readAt: m.readAt?.toISOString() ?? null, createdAt: m.createdAt.toISOString() };
}

async function audit(fastify: FastifyInstance, request: FastifyRequest, m: EmailMessage, reasonText: string) {
  await fastify.audit.record({
    tenantId: request.tenantId, entityType: 'email_message', entityId: m.id, actionType: 'create', actorType: 'user',
    actorId: request.user.sub, actorDisplayName: request.user.displayName, correlationId: request.id, reasonText,
  });
}

/**
 * The institution's mailbox (staff read, send and reply) and the inbound
 * hook an email provider calls when mail arrives.
 */
export function emailRoutes(fastify: FastifyInstance): void {
  fastify.get('/email/settings', {
    schema: { response: { 200: Type.Object({ fromAddress: Type.String(), transportCode: Type.String(), unreadCount: Type.Number() }) } },
    preHandler: [requirePermission('email:read')],
  }, async (request, reply) => {
    await reply.send({
      fromAddress: fastify.emailService.fromAddress,
      transportCode: fastify.emailService.transportCode,
      unreadCount: await fastify.emailService.unreadCount(request.tenantId),
    });
  });

  fastify.get('/email/messages', {
    schema: {
      querystring: Type.Object({
        direction: Type.Optional(Type.Union([Type.Literal('inbound'), Type.Literal('outbound')])),
        personId:  Type.Optional(Type.String()),
        unread:    Type.Optional(Type.Boolean()),
        limit:     Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
      }),
      response: { 200: Type.Array(MessageSchema) },
    },
    preHandler: [requirePermission('email:read')],
  }, async (request, reply) => {
    const q = request.query as { direction?: 'inbound' | 'outbound'; personId?: string; unread?: boolean; limit?: number };
    const rows = await fastify.emailService.list(request.tenantId, {
      ...(q.direction ? { direction: q.direction } : {}),
      ...(q.personId ? { personId: q.personId } : {}),
      ...(q.unread ? { unreadOnly: true } : {}),
      ...(q.limit ? { limit: q.limit } : {}),
    });
    await reply.send(rows.map(wire));
  });

  /** A message and the rest of its thread, oldest first. */
  fastify.get('/email/messages/:messageId', {
    schema: {
      params: Type.Object({ messageId: Type.String() }),
      response: { 200: Type.Object({ message: MessageSchema, thread: Type.Array(MessageSchema) }), 404: ErrorSchema },
    },
    preHandler: [requirePermission('email:read')],
  }, async (request, reply) => {
    const { messageId } = request.params as { messageId: string };
    const message = await fastify.emailService.get(request.tenantId, messageId);
    const thread = await fastify.emailService.thread(request.tenantId, message.threadId);
    await reply.send({ message: wire(message), thread: thread.map(wire) });
  });

  fastify.post('/email/messages/:messageId/read', {
    schema: { params: Type.Object({ messageId: Type.String() }), response: { 200: MessageSchema, 404: ErrorSchema } },
    preHandler: [requirePermission('email:read')],
  }, async (request, reply) => {
    const { messageId } = request.params as { messageId: string };
    await reply.send(wire(await fastify.emailService.markRead(request.tenantId, messageId, request.user.sub)));
  });

  /** Send a new message, or a reply (inReplyToId). A refused delivery is recorded as failed. */
  fastify.post('/email/messages', {
    schema: {
      body: Type.Object({
        to:          Type.String({ minLength: 3, maxLength: 320 }),
        subject:     Type.String({ minLength: 1, maxLength: 300 }),
        bodyText:    Type.String({ minLength: 1, maxLength: 50_000 }),
        personId:    Type.Optional(Type.String()),
        inReplyToId: Type.Optional(Type.String()),
      }),
      response: { 201: MessageSchema, 404: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('email:send')],
  }, async (request, reply) => {
    const body = request.body as { to: string; subject: string; bodyText: string; personId?: string; inReplyToId?: string };
    const sent = await fastify.emailService.send(request.tenantId, body, request.user.sub);
    await audit(fastify, request, sent, `Email to ${sent.toAddress} (${sent.statusCode})`);
    await reply.code(201).send(wire(sent));
  });

  /**
   * The inbound hook: an email provider posts each message delivered to the
   * institution's addresses. Idempotent on messageId (the Message-ID header).
   */
  fastify.post('/email/inbound', {
    schema: {
      body: Type.Object({
        messageId: Type.String({ minLength: 1, maxLength: 998 }),
        from:      Type.String({ minLength: 3, maxLength: 320 }),
        to:        Type.String({ minLength: 3, maxLength: 320 }),
        subject:   Type.String({ maxLength: 998 }),
        bodyText:  Type.String({ maxLength: 200_000 }),
        inReplyTo: Type.Optional(Type.String({ maxLength: 998 })),
        provider:  Type.Optional(Type.String({ maxLength: 64 })),
      }),
      response: { 200: Type.Object({ id: Type.String(), duplicate: Type.Boolean() }), 422: ErrorSchema },
    },
    preHandler: [requirePermission('email:receive')],
  }, async (request, reply) => {
    const b = request.body as { messageId: string; from: string; to: string; subject: string; bodyText: string; inReplyTo?: string; provider?: string };
    const { message, duplicate } = await fastify.emailService.receive(request.tenantId, {
      messageId: b.messageId, from: b.from, to: b.to, subject: b.subject, bodyText: b.bodyText,
      transportCode: b.provider ?? 'inbound-hook',
      ...(b.inReplyTo ? { inReplyTo: b.inReplyTo } : {}),
    });
    await reply.send({ id: message.id, duplicate });
  });
}

/**
 * The fake mail server's own screens (registered only with the fake
 * transport): external mailboxes, and sending mail in as an external person.
 */
export function emailSimulatorRoutes(fastify: FastifyInstance): void {
  fastify.get('/email-simulator/mailboxes', {
    schema: { response: { 200: Type.Array(Type.Object({ address: Type.String(), received: Type.Number(), sent: Type.Number(), lastActivity: Type.String() })) } },
    preHandler: [requirePermission('email-simulator:use')],
  }, async (request, reply) => {
    const rows = await listSimulatorMailboxes(fastify.db, request.tenantId);
    await reply.send(rows.map((r) => ({ ...r, lastActivity: r.lastActivity.toISOString() })));
  });

  fastify.get('/email-simulator/messages', {
    schema: {
      querystring: Type.Object({ address: Type.String({ minLength: 3 }) }),
      response: { 200: Type.Array(SimulatorMessageSchema) },
    },
    preHandler: [requirePermission('email-simulator:use')],
  }, async (request, reply) => {
    const { address } = request.query as { address: string };
    const rows = await listSimulatorMessages(fastify.db, request.tenantId, address);
    await reply.send(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
  });

  /** Send mail to the institution as an external person, through the same path as the inbound hook. */
  fastify.post('/email-simulator/send-to-institution', {
    schema: {
      body: Type.Object({
        from:               Type.String({ minLength: 3, maxLength: 320 }),
        to:                 Type.Optional(Type.String({ minLength: 3, maxLength: 320 })),
        subject:            Type.String({ maxLength: 300 }),
        bodyText:           Type.String({ minLength: 1, maxLength: 50_000 }),
        inReplyToMessageId: Type.Optional(Type.String({ maxLength: 998 })),
      }),
      response: { 201: Type.Object({ messageId: Type.String(), srsMessageId: Type.String() }), 422: ErrorSchema },
    },
    preHandler: [requirePermission('email-simulator:use')],
  }, async (request, reply) => {
    const b = request.body as { from: string; to?: string; subject: string; bodyText: string; inReplyToMessageId?: string };
    const to = (b.to ?? fastify.emailService.fromAddress).trim();
    if (!isEmailAddress(b.from)) throw new ValidationError(`'${b.from}' is not an email address`, [{ field: 'from', message: 'Must be an email address' }]);
    if (!isEmailAddress(to)) throw new ValidationError(`'${to}' is not an email address`, [{ field: 'to', message: 'Must be an email address' }]);
    const messageId = `<${randomUUID()}@fake-mail.example>`;
    await recordSimulatorSendIn(fastify.db, request.tenantId, {
      messageId, from: b.from.trim(), to, subject: b.subject, bodyText: b.bodyText, createdBy: request.user.sub,
      ...(b.inReplyToMessageId ? { inReplyTo: b.inReplyToMessageId } : {}),
    });
    const { message } = await fastify.emailService.receive(request.tenantId, {
      messageId, from: b.from, to, subject: b.subject, bodyText: b.bodyText, transportCode: 'fake',
      ...(b.inReplyToMessageId ? { inReplyTo: b.inReplyToMessageId } : {}),
    });
    await reply.code(201).send({ messageId, srsMessageId: message.id });
  });
}
