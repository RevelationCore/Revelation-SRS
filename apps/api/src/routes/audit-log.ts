import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

const AuditLogEntrySchema = Type.Object({
  id:                 Type.String(),
  tenantId:           Type.Union([Type.String(), Type.Null()]),
  entityType:         Type.String(),
  entityId:           Type.String(),
  fieldName:          Type.Union([Type.String(), Type.Null()]),
  beforeValue:        Type.Unknown(),
  afterValue:         Type.Unknown(),
  actionType:         Type.String(),
  actorType:          Type.String(),
  actorId:            Type.String(),
  actorDisplayName:   Type.Union([Type.String(), Type.Null()]),
  occurredAt:         Type.String(),
  correlationId:      Type.Union([Type.String(), Type.Null()]),
  workflowInstanceId: Type.Union([Type.String(), Type.Null()]),
  reasonCode:         Type.Union([Type.String(), Type.Null()]),
  reasonText:         Type.Union([Type.String(), Type.Null()]),
});

// eslint-disable-next-line @typescript-eslint/require-await
export async function auditLogRoutes(fastify: FastifyInstance): Promise<void> {
  // ── GET /audit-log ──────────────────────────────────────────────────────────
  //
  // Paginated entity audit log — returns audit records for a specific entity.
  // Requires: entityType and entityId query parameters.
  // Optional: limit (1–200, default 50), before (ISO timestamp cursor for pagination).

  fastify.get(
    '/audit-log',
    {
      schema: {
        summary:     'Entity audit log',
        description: 'Returns a paginated list of audit log entries for a specific entity (entityType + entityId).',
        tags:        ['Audit'],
        querystring: Type.Object({
          entityType: Type.String({ minLength: 1 }),
          entityId:   Type.String({ minLength: 1 }),
          limit:      Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
          before:     Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Array(AuditLogEntrySchema),
        },
      },
      preHandler: [requirePermission('audit-log:read')],
    },
    async (request, reply) => {
      const { entityType, entityId, limit, before } = request.query as {
        entityType: string; entityId: string; limit?: number; before?: string;
      };
      const opts: { limit?: number; before?: string } = {};
      if (limit  !== undefined) opts.limit  = limit;
      if (before !== undefined) opts.before = before;
      const entries = await fastify.audit.listByEntity(
        request.tenantId,
        entityType,
        entityId,
        opts,
      );
      return reply.send(entries);
    },
  );
}
