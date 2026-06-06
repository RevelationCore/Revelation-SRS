import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

import type { FoiExtractDto, FoiRequestDto, FoiRequestInput } from '../platform/regulatory/foi-service.js';

const ErrorSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const FoiRequestSchema = Type.Object({
  requestId: Type.String(),
  requestReference: Type.String(),
  receivedDate: Type.String(),
  statutoryDeadlineDate: Type.String(),
  description: Type.String(),
  statusCode: Type.String(),
  legalBasis: Type.Union([Type.String(), Type.Null()]),
  closedAt: Type.Union([Type.String(), Type.Null()]),
});

const FoiExtractSchema = Type.Object({
  extractId: Type.String(),
  requestId: Type.String(),
  generatedAt: Type.String(),
  generatedBy: Type.String(),
  querySummary: Type.String(),
  recordCount: Type.Number(),
  payload: Type.Record(Type.String(), Type.Unknown()),
});

export function regulatoryFoiRoutes(fastify: FastifyInstance): void {
  fastify.post(
    '/regulatory/foi/requests',
    {
      schema: {
        body: Type.Object({
          requestReference: Type.String({ minLength: 1 }),
          receivedDate: Type.String(),
          description: Type.String({ minLength: 1 }),
          legalBasis: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        }),
        response: {
          201: Type.Object({
            requestId: Type.String(),
            statutoryDeadlineDate: Type.String(),
          }),
          422: ErrorSchema,
        },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const result = await fastify.foiService.recordRequest(
        request.tenantId,
        request.body as FoiRequestInput,
        request.user.sub,
      );
      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'foi_request',
        entityId: result.requestId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });
      await reply.code(201).send(result);
    },
  );

  fastify.get(
    '/regulatory/foi/requests',
    {
      schema: {
        querystring: Type.Object({
          statusCode: Type.Optional(Type.String()),
          dueWithinDays: Type.Optional(Type.Number()),
        }),
        response: { 200: Type.Array(FoiRequestSchema) },
      },
      preHandler: [requirePermission('regulatory:read')],
    },
    async (request, reply) => {
      const query = request.query as { statusCode?: string; dueWithinDays?: number };
      const rows = await fastify.foiService.listRequests(request.tenantId, query);
      await reply.send(rows.map(requestToWire));
    },
  );

  fastify.get(
    '/regulatory/foi/requests/:requestId',
    {
      schema: {
        params: Type.Object({ requestId: Type.String() }),
        response: { 200: FoiRequestSchema, 404: ErrorSchema },
      },
      preHandler: [requirePermission('regulatory:read')],
    },
    async (request, reply) => {
      const { requestId } = request.params as { requestId: string };
      const row = await fastify.foiService.getRequest(requestId, request.tenantId);
      await reply.send(requestToWire(row));
    },
  );

  fastify.post(
    '/regulatory/foi/requests/:requestId/extract',
    {
      schema: {
        params: Type.Object({ requestId: Type.String() }),
        body: Type.Object({ querySummary: Type.String({ minLength: 1 }) }),
        response: { 201: FoiExtractSchema, 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const { requestId } = request.params as { requestId: string };
      const { querySummary } = request.body as { querySummary: string };
      const result = await fastify.foiService.generateExtract(
        requestId,
        request.tenantId,
        querySummary,
        request.user.sub,
      );
      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'foi_extract',
        entityId: result.extractId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
        afterValue: { querySummary },
      });
      await reply.code(201).send(extractToWire(result));
    },
  );

  fastify.patch(
    '/regulatory/foi/requests/:requestId/status',
    {
      schema: {
        params: Type.Object({ requestId: Type.String() }),
        body: Type.Object({ statusCode: Type.String({ minLength: 1 }) }),
        response: { 200: FoiRequestSchema, 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const { requestId } = request.params as { requestId: string };
      const { statusCode } = request.body as { statusCode: string };
      const row = await fastify.foiService.updateRequestStatus(
        requestId,
        request.tenantId,
        statusCode,
        request.user.sub,
      );
      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'foi_request',
        entityId: requestId,
        actionType: 'update',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });
      await reply.send(requestToWire(row));
    },
  );
}

function requestToWire(row: FoiRequestDto) {
  return {
    ...row,
    closedAt: row.closedAt?.toISOString() ?? null,
  };
}

function extractToWire(row: FoiExtractDto) {
  return {
    ...row,
    generatedAt: row.generatedAt.toISOString(),
  };
}
