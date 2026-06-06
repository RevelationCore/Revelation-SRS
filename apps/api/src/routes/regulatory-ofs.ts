import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

import type { OfsExtractDto } from '../platform/regulatory/ofs-service.js';

const ErrorSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const OfsExtractSchema = Type.Object({
  extractId: Type.String(),
  extractTypeCode: Type.String(),
  academicYear: Type.String(),
  generatedAt: Type.String(),
  generatedBy: Type.String(),
  recordCount: Type.Number(),
  statusCode: Type.String(),
  payload: Type.Record(Type.String(), Type.Unknown()),
});

export function regulatoryOfsRoutes(fastify: FastifyInstance): void {
  fastify.post(
    '/regulatory/ofs/b3-extracts',
    {
      schema: {
        body: Type.Object({ academicYear: Type.String({ minLength: 1 }) }),
        response: {
          200: Type.Object({
            extractId: Type.String(),
            recordCount: Type.Number(),
            payload: Type.Record(Type.String(), Type.Unknown()),
          }),
        },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const { academicYear } = request.body as { academicYear: string };
      const result = await fastify.ofsService.generateB3Extract(request.tenantId, academicYear, request.user.sub);
      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'ofs_extract',
        entityId: result.extractId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });
      await reply.send(result);
    },
  );

  fastify.get(
    '/regulatory/ofs/b3-extracts/:extractId',
    {
      schema: {
        params: Type.Object({ extractId: Type.String() }),
        response: { 200: OfsExtractSchema, 404: ErrorSchema },
      },
      preHandler: [requirePermission('regulatory:read')],
    },
    async (request, reply) => {
      const { extractId } = request.params as { extractId: string };
      const extract = await fastify.ofsService.getExtract(extractId, request.tenantId);
      await reply.send(extractToWire(extract));
    },
  );

  fastify.post(
    '/regulatory/ofs/participation-reports',
    {
      schema: {
        body: Type.Object({ academicYear: Type.String({ minLength: 1 }) }),
        response: {
          200: Type.Object({
            extractId: Type.String(),
            recordCount: Type.Number(),
            payload: Type.Record(Type.String(), Type.Unknown()),
          }),
        },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const { academicYear } = request.body as { academicYear: string };
      const result = await fastify.ofsService.generateParticipationReport(request.tenantId, academicYear, request.user.sub);
      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'ofs_extract',
        entityId: result.extractId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });
      await reply.send(result);
    },
  );
}

function extractToWire(extract: OfsExtractDto) {
  return {
    ...extract,
    generatedAt: extract.generatedAt.toISOString(),
  };
}
