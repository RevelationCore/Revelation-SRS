import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';

import { requirePermission } from '@revelation-srs/auth';

const ErrorSchema = Type.Object({ title: Type.String(), detail: Type.Optional(Type.String()) });

export async function notificationRoutes(fastify: FastifyInstance): Promise<void> {
  // ── GET /notifications/stream — SSE long-poll ────────────────────────────
  // Authenticated; emits `data: <json>\n\n` events as notifications arrive.
  fastify.get('/notifications/stream', {
    schema: {
      security: [{ bearerAuth: [] }],
      description: 'Open an SSE stream for real-time notifications',
    },
    preHandler: [requirePermission('notifications:read')],
  }, async (request, reply) => {
    const tenantId = request.tenantId;
    const connectionId = randomUUID();

    reply.raw.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (event: string, data: string) => {
      reply.raw.write(`event: ${event}\ndata: ${data}\n\n`);
    };

    const personId = request.user.srsPersonId ?? request.user.sub;

    fastify.notificationService.addConnection(connectionId, {
      tenantId,
      personId,
      send,
      close: () => reply.raw.end(),
    });

    // Heartbeat every 25 s to keep the connection alive through proxies
    const heartbeat = setInterval(() => {
      reply.raw.write(': heartbeat\n\n');
    }, 25_000);

    reply.raw.on('close', () => {
      clearInterval(heartbeat);
      fastify.notificationService.removeConnection(connectionId);
    });

    // Do not call reply.send() — we are managing the raw response directly
    await new Promise<void>(() => { /* held open until client disconnects */ });
  });

  // ── GET /notifications — paginated list ─────────────────────────────────
  fastify.get('/notifications', {
    schema: {
      security: [{ bearerAuth: [] }],
      querystring: Type.Object({
        limit:      Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 })),
        unreadOnly: Type.Optional(Type.Boolean({ default: false })),
      }),
      response: {
        200: Type.Array(Type.Object({
          id:        Type.String({ format: 'uuid' }),
          personId:  Type.String({ format: 'uuid' }),
          category:  Type.String(),
          title:     Type.String(),
          body:      Type.String(),
          linkUrl:   Type.Union([Type.String(), Type.Null()]),
          readAt:    Type.Union([Type.String(), Type.Null()]),
          createdAt: Type.String(),
        })),
      },
    },
    preHandler: [requirePermission('notifications:read')],
  }, async (request, reply) => {
    const q = request.query as { limit?: number; unreadOnly?: boolean };
    const tenantId = request.tenantId;
    const personId = request.user.srsPersonId ?? request.user.sub;

    const opts: { limit?: number; unreadOnly?: boolean } = {};
    if (q.limit !== undefined)      opts.limit      = q.limit;
    if (q.unreadOnly !== undefined) opts.unreadOnly  = q.unreadOnly;

    const rows = await fastify.notificationService.list(tenantId, personId, opts);
    return reply.send(rows);
  });

  // ── PATCH /notifications/:id/read — mark as read ─────────────────────────
  fastify.patch('/notifications/:id/read', {
    schema: {
      security: [{ bearerAuth: [] }],
      params: Type.Object({
        id: Type.String({ format: 'uuid' }),
      }),
      response: {
        204: Type.Null(),
        404: Type.Object({ message: Type.String() }),
      },
    },
    preHandler: [requirePermission('notifications:read')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const tenantId = request.tenantId;
    const personId = request.user.srsPersonId ?? request.user.sub;

    const updated = await fastify.notificationService.markRead(tenantId, personId, id);
    if (!updated) return reply.status(404).send({ message: 'Notification not found or already read' });
    return reply.status(204).send();
  });

  // ── GET /admin/students/:personId/notifications — list for a specific student ─
  fastify.get('/admin/students/:personId/notifications', {
    schema: {
      security: [{ bearerAuth: [] }],
      params: Type.Object({
        personId: Type.String({ format: 'uuid' }),
      }),
      querystring: Type.Object({
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 })),
      }),
      response: {
        200: Type.Array(Type.Object({
          id:        Type.String({ format: 'uuid' }),
          personId:  Type.String({ format: 'uuid' }),
          category:  Type.String(),
          title:     Type.String(),
          body:      Type.String(),
          linkUrl:   Type.Union([Type.String(), Type.Null()]),
          readAt:    Type.Union([Type.String(), Type.Null()]),
          createdAt: Type.String(),
        })),
      },
    },
    preHandler: [requirePermission('notifications:read')],
  }, async (request, reply) => {
    const { personId } = request.params as { personId: string };
    const q = request.query as { limit?: number };
    const opts: { limit?: number } = {};
    if (q.limit !== undefined) opts.limit = q.limit;
    const rows = await fastify.notificationService.list(request.tenantId, personId, opts);
    return reply.send(rows);
  });

  // ── POST /admin/notifications — create a notification for any person ─────────
  fastify.post('/admin/notifications', {
    schema: {
      security: [{ bearerAuth: [] }],
      body: Type.Object({
        personId: Type.String({ format: 'uuid' }),
        category: Type.String({ minLength: 1 }),
        title:    Type.String({ minLength: 1 }),
        body:     Type.String({ minLength: 1 }),
        linkUrl:  Type.Optional(Type.String()),
      }),
      response: {
        201: Type.Object({ id: Type.String() }),
        403: ErrorSchema,
      },
    },
    preHandler: [requirePermission('notifications:write')],
  }, async (request, reply) => {
    const b = request.body as {
      personId: string;
      category: string;
      title:    string;
      body:     string;
      linkUrl?: string;
    };
    const row = await fastify.notificationService.deliver(request.tenantId, b);
    return reply.status(201).send({ id: row.id });
  });
}
