import { Type } from '@sinclair/typebox';
import { requireAnyPermission, requirePermission } from '@revelation-srs/auth';
import { hasPermission } from '@revelation-srs/domain';
import type { FastifyInstance } from 'fastify';

import type {
  IngestMarkInput,
  MarkDto,
  UpdateMarkInput,
} from '../platform/assessment/mark-service.js';

const ErrorSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const MarkSchema = Type.Object({
  markId: Type.String(),
  moduleRegistrationId: Type.String(),
  assessmentComponentId: Type.String(),
  assessmentSubmissionId: Type.Union([Type.String(), Type.Null()]),
  attemptNumber: Type.Number(),
  rawMark: Type.Number(),
  adjustedMark: Type.Number(),
  penaltyApplied: Type.Boolean(),
  penaltyPercent: Type.Union([Type.Number(), Type.Null()]),
  locked: Type.Boolean(),
  sourceSystem: Type.Union([Type.String(), Type.Null()]),
  actorId: Type.String(),
  validFrom: Type.String(),
  validTo: Type.Union([Type.String(), Type.Null()]),
  recordedAt: Type.String(),
  recordedUntil: Type.Union([Type.String(), Type.Null()]),
});

const IngestMarkBody = Type.Object({
  assessmentComponentId: Type.String(),
  rawMark: Type.Number({ minimum: 0, maximum: 100 }),
  attemptNumber: Type.Optional(Type.Integer({ minimum: 1 })),
  sourceSystem: Type.Optional(Type.String()),
  sourceReference: Type.Optional(Type.String()),
  submittedAt: Type.Optional(Type.String({ format: 'date-time' })),
  dueAt: Type.Optional(Type.String({ format: 'date-time' })),
  rawPayload: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

const UpdateMarkBody = Type.Object({
  rawMark: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
  reason: Type.Optional(Type.String()),
  submittedAt: Type.Optional(Type.String({ format: 'date-time' })),
  dueAt: Type.Optional(Type.String({ format: 'date-time' })),
});

export function markRoutes(fastify: FastifyInstance): void {
  fastify.get(
    '/module-registrations/:moduleRegistrationId/marks',
    {
      schema: {
        params: Type.Object({ moduleRegistrationId: Type.String() }),
        response: { 200: Type.Array(MarkSchema), 404: ErrorSchema },
      },
      preHandler: [requirePermission('mark:read:all')],
    },
    async (request, reply) => {
      const { moduleRegistrationId } = request.params as { moduleRegistrationId: string };
      const marks = await fastify.markService.listMarks(moduleRegistrationId, request.tenantId);
      await reply.send(marks.map(markToWire));
    },
  );

  fastify.post(
    '/module-registrations/:moduleRegistrationId/marks',
    {
      schema: {
        params: Type.Object({ moduleRegistrationId: Type.String() }),
        body: IngestMarkBody,
        response: {
          200: Type.Object({ markId: Type.String() }),
          201: Type.Object({ markId: Type.String() }),
          404: ErrorSchema,
          422: ErrorSchema,
        },
      },
      // ADR-032: staff with mark:write, or the VLE connector, whose
      // mark:record-from-vle records VLE marks only, each with its reference.
      preHandler: [requireAnyPermission('mark:write', 'mark:record-from-vle')],
    },
    async (request, reply) => {
      const { moduleRegistrationId } = request.params as { moduleRegistrationId: string };
      const body = request.body as IngestMarkInput;
      if (!hasPermission(request.user.roles, 'mark:write')) {
        if (body.sourceSystem !== 'vle' || !body.sourceReference) {
          await reply.code(422).type('application/problem+json').send({
            type: 'https://srs.example.com/errors/unprocessable', title: 'VLE mark required', status: 422,
            detail: 'The VLE connector records marks with sourceSystem vle and the VLE submission reference (sourceReference)', instance: request.url,
          });
          return;
        }
        // The submission reference makes a repeat idempotent.
        const existing = await fastify.markService.findMarkBySource(request.tenantId, moduleRegistrationId, 'vle', body.sourceReference);
        if (existing) {
          await reply.code(200).send({ markId: existing });
          return;
        }
      }
      const markId = await fastify.markService.ingestMark(
        request.tenantId,
        moduleRegistrationId,
        body,
        request.user.sub,
      );

      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'mark',
        entityId: markId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });

      await reply.code(201).send({ markId });
    },
  );

  fastify.get(
    '/marks/:markId/history',
    {
      schema: {
        params: Type.Object({ markId: Type.String() }),
        response: { 200: Type.Array(MarkSchema) },
      },
      preHandler: [requirePermission('mark:read:all')],
    },
    async (request, reply) => {
      const { markId } = request.params as { markId: string };
      const history = await fastify.markService.getMarkHistory(markId, request.tenantId);
      await reply.send(history.map(markToWire));
    },
  );

  fastify.patch(
    '/marks/:markId',
    {
      schema: {
        params: Type.Object({ markId: Type.String() }),
        body: UpdateMarkBody,
        response: { 204: Type.Null(), 403: ErrorSchema, 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('mark:write')],
    },
    async (request, reply) => {
      const { markId } = request.params as { markId: string };
      const body = request.body as UpdateMarkInput;
      await fastify.markService.updateMark(markId, request.tenantId, body, request.user.sub);

      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'mark',
        entityId: markId,
        afterValue: body,
        actionType: 'update',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
        ...(body.reason ? { reasonText: body.reason } : {}),
      });

      await reply.code(204).send();
    },
  );
}

function markToWire(mark: MarkDto) {
  return {
    ...mark,
    validFrom: mark.validFrom.toISOString(),
    validTo: mark.validTo?.toISOString() ?? null,
    recordedAt: mark.recordedAt.toISOString(),
    recordedUntil: mark.recordedUntil?.toISOString() ?? null,
  };
}
