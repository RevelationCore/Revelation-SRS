import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

import type { ModuleResultDto } from '../platform/assessment/module-result-service.js';

const ErrorSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const ModuleResultSchema = Type.Object({
  moduleResultId: Type.String(),
  moduleRegistrationId: Type.String(),
  aggregateMark: Type.Number(),
  resultCode: Type.String(),
  locked: Type.Boolean(),
  calculatedAt: Type.String(),
  validFrom: Type.String(),
  validTo: Type.Union([Type.String(), Type.Null()]),
  recordedAt: Type.String(),
  recordedUntil: Type.Union([Type.String(), Type.Null()]),
});

export function moduleResultRoutes(fastify: FastifyInstance): void {
  fastify.get(
    '/module-registrations/:moduleRegistrationId/result',
    {
      schema: {
        params: Type.Object({ moduleRegistrationId: Type.String() }),
        response: { 200: ModuleResultSchema, 404: ErrorSchema },
      },
      preHandler: [requirePermission('mark:read:all')],
    },
    async (request, reply) => {
      const { moduleRegistrationId } = request.params as { moduleRegistrationId: string };
      const result = await fastify.moduleResultService.getResult(moduleRegistrationId, request.tenantId);
      await reply.send(moduleResultToWire(result));
    },
  );

  fastify.get(
    '/module-registrations/:moduleRegistrationId/result/history',
    {
      schema: {
        params: Type.Object({ moduleRegistrationId: Type.String() }),
        response: { 200: Type.Array(ModuleResultSchema), 404: ErrorSchema },
      },
      preHandler: [requirePermission('mark:read:all')],
    },
    async (request, reply) => {
      const { moduleRegistrationId } = request.params as { moduleRegistrationId: string };
      const history = await fastify.moduleResultService.getResultHistory(moduleRegistrationId, request.tenantId);
      await reply.send(history.map(moduleResultToWire));
    },
  );
}

function moduleResultToWire(result: ModuleResultDto) {
  return {
    ...result,
    calculatedAt: result.calculatedAt.toISOString(),
    validFrom: result.validFrom.toISOString(),
    validTo: result.validTo?.toISOString() ?? null,
    recordedAt: result.recordedAt.toISOString(),
    recordedUntil: result.recordedUntil?.toISOString() ?? null,
  };
}
