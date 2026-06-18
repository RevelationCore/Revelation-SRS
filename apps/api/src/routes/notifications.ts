import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';

import { requirePermission } from '@revelation-srs/auth';

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
    const personId = request.user.sub;
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
    const personId = request.user.sub;

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
    const personId = request.user.sub;

    const updated = await fastify.notificationService.markRead(tenantId, personId, id);
    if (!updated) return reply.status(404).send({ message: 'Notification not found or already read' });
    return reply.status(204).send();
  });
}
