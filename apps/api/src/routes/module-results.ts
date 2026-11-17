import { Type } from '@sinclair/typebox';
import { requirePermission, requireAnyPermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

import type { ModuleResultDto } from '../platform/assessment/module-result-service.js';

import { RuleVersionSchema } from './rule-version-schema.js';

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
  ruleVersions: Type.Array(RuleVersionSchema, { description: 'The rules this result used (D-35); empty for results calculated before that was recorded' }),
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
      preHandler: [requireAnyPermission('mark:read:own', 'mark:read:all')],
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

  // How a result was calculated (D-35): the exact rule versions of its current version.
  fastify.get(
    '/module-results/:moduleResultId/evidence',
    {
      schema: {
        params: Type.Object({ moduleResultId: Type.String() }),
        response: { 200: Type.Intersect([ModuleResultSchema, Type.Object({ versionId: Type.String() })]), 404: ErrorSchema },
      },
      preHandler: [requirePermission('mark:read:all')],
    },
    async (request, reply) => {
      const { moduleResultId } = request.params as { moduleResultId: string };
      const evidence = await fastify.moduleResultService.getEvidence(request.tenantId, moduleResultId);
      await reply.send({ ...moduleResultToWire(evidence), versionId: evidence.versionId });
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
