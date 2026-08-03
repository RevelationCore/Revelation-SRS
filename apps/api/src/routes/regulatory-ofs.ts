import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

import type { OfsExtractDto, OfsGenerationRequestDto } from '../platform/regulatory/ofs-service.js';

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

  // ── Generation approval workflow (BPR-W12 rollout) ──────────────────────────
  const OfsGenerationRequestSchema = Type.Object({
    workflowInstanceId: Type.String(),
    workflowTaskId:      Type.String(),
    statusCode:          Type.String(),
    context:             Type.Record(Type.String(), Type.Unknown()),
    startedAt:           Type.String(),
  });

  fastify.post(
    '/regulatory/ofs/generation-requests',
    {
      schema: {
        body: Type.Object({
          extractTypeCode: Type.Union([Type.Literal('b3-student-outcomes'), Type.Literal('access-participation-progress')]),
          academicYear:    Type.String({ minLength: 1 }),
          reason:          Type.Optional(Type.String()),
        }),
        response: { 202: OfsGenerationRequestSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const { extractTypeCode, academicYear, reason } = request.body as {
        extractTypeCode: 'b3-student-outcomes' | 'access-participation-progress';
        academicYear: string;
        reason?: string;
      };

      const generationRequest = await fastify.ofsService.requestExtractGeneration(
        request.tenantId, extractTypeCode, academicYear, request.user.sub, reason,
      );

      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'ofs_extract',
        entityId: generationRequest.workflowInstanceId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });

      await reply.code(202).send(ofsGenerationRequestToWire(generationRequest));
    },
  );

  fastify.get(
    '/regulatory/ofs/generation-requests',
    {
      schema: { response: { 200: Type.Array(OfsGenerationRequestSchema) } },
      preHandler: [requirePermission('regulatory:decide')],
    },
    async (request, reply) => {
      const requests = await fastify.ofsService.listPendingGenerationRequests(request.tenantId);
      await reply.send(requests.map(ofsGenerationRequestToWire));
    },
  );

  fastify.post(
    '/regulatory/ofs/generation-requests/:workflowInstanceId/decision',
    {
      schema: {
        params: Type.Object({ workflowInstanceId: Type.String() }),
        body: Type.Object({
          decisionCode: Type.Union([Type.Literal('approved'), Type.Literal('rejected')]),
          reason:       Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Object({ extractId: Type.Union([Type.String(), Type.Null()]) }),
          404: ErrorSchema, 422: ErrorSchema,
        },
      },
      preHandler: [requirePermission('regulatory:decide')],
    },
    async (request, reply) => {
      const { workflowInstanceId } = request.params as { workflowInstanceId: string };
      const { decisionCode, reason } = request.body as { decisionCode: 'approved' | 'rejected'; reason?: string };

      const result = await fastify.ofsService.decideExtractGeneration(
        request.tenantId, workflowInstanceId, decisionCode, request.user.sub, reason,
      );

      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'ofs_extract',
        entityId: workflowInstanceId,
        actionType: 'update',
        fieldName: 'decision_code',
        afterValue: { decisionCode },
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });

      await reply.send(result);
    },
  );
}

function ofsGenerationRequestToWire(generationRequest: OfsGenerationRequestDto) {
  return {
    ...generationRequest,
    startedAt: generationRequest.startedAt.toISOString(),
  };
}

function extractToWire(extract: OfsExtractDto) {
  return {
    ...extract,
    generatedAt: extract.generatedAt.toISOString(),
  };
}
