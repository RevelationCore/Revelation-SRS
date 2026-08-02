import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

import type { RecordSupportOutcomeInput } from '../platform/adjustments/support-outcome-service.js';

const ErrorSchema = Type.Object({
  type:   Type.String(),
  title:  Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const SupportOutcomeSchema = Type.Object({
  supportOutcomeId:     Type.String(),
  enrolmentId:          Type.String(),
  sourceCaseId:         Type.Union([Type.String(), Type.Null()]),
  sourceDecisionId:     Type.Union([Type.String(), Type.Null()]),
  outcomeTypeCode:      Type.String(),
  minimumNecessaryText: Type.String(),
  visibilityScopeCode:  Type.String(),
  actorId:              Type.String(),
  validFrom:            Type.String(),
  validTo:              Type.Union([Type.String(), Type.Null()]),
  recordedAt:           Type.String(),
  recordedUntil:        Type.Union([Type.String(), Type.Null()]),
});

const RecordSupportOutcomeBody = Type.Object({
  sourceCaseId:         Type.Optional(Type.String()),
  sourceDecisionId:     Type.Optional(Type.String()),
  outcomeTypeCode:      Type.String(),
  minimumNecessaryText: Type.String(),
  visibilityScopeCode:  Type.String(),
});

const DistributeBody = Type.Object({
  targetSystemCodes: Type.Array(Type.String()),
});

export function supportOutcomesRoutes(fastify: FastifyInstance): void {
  fastify.post(
    '/enrolments/:enrolmentId/support-outcomes',
    {
      schema: {
        params:   Type.Object({ enrolmentId: Type.String() }),
        body:     RecordSupportOutcomeBody,
        response: { 201: Type.Object({ supportOutcomeId: Type.String() }), 422: ErrorSchema },
      },
      preHandler: [requirePermission('adjustment:write')],
    },
    async (request, reply) => {
      const { enrolmentId } = request.params as { enrolmentId: string };
      const body = request.body as Omit<RecordSupportOutcomeInput, 'enrolmentId'>;
      const supportOutcomeId = await fastify.supportOutcomeService.recordOutcome(
        request.tenantId,
        { enrolmentId, ...body },
        request.user.sub,
      );

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'support_outcome',
        entityId:         supportOutcomeId,
        actionType:       'create',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(201).send({ supportOutcomeId });
    },
  );

  fastify.get(
    '/enrolments/:enrolmentId/support-outcomes',
    {
      schema: {
        params:   Type.Object({ enrolmentId: Type.String() }),
        response: { 200: Type.Array(SupportOutcomeSchema) },
      },
      preHandler: [requirePermission('adjustment:read:all')],
    },
    async (request, reply) => {
      const { enrolmentId } = request.params as { enrolmentId: string };
      const outcomes = await fastify.supportOutcomeService.listOutcomesForEnrolment(enrolmentId, request.tenantId);
      await reply.send(outcomes);
    },
  );

  fastify.post(
    '/support-outcomes/:supportOutcomeId/distribute',
    {
      schema: {
        params:   Type.Object({ supportOutcomeId: Type.String() }),
        body:     DistributeBody,
        response: { 201: Type.Object({ distributionItemIds: Type.Array(Type.String()) }), 404: ErrorSchema },
      },
      preHandler: [requirePermission('adjustment:write')],
    },
    async (request, reply) => {
      const { supportOutcomeId } = request.params as { supportOutcomeId: string };
      const { targetSystemCodes } = request.body as { targetSystemCodes: string[] };
      const distributionItemIds = await fastify.supportOutcomeService.distributeToTargets(
        request.tenantId,
        supportOutcomeId,
        targetSystemCodes,
      );
      await reply.code(201).send({ distributionItemIds });
    },
  );
}
