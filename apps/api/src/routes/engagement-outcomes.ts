import { Type } from '@sinclair/typebox';
import { requireSelfOrPermission, requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

import type {
  EngagementOutcomeDto,
  RecordEngagementOutcomeInput,
} from '../platform/engagement-outcomes/service.js';

const ErrorSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const EngagementOutcomeSchema = Type.Object({
  engagementOutcomeId: Type.String(),
  personId: Type.String(),
  enrolmentId: Type.String(),
  moduleRegistrationId: Type.Union([Type.String(), Type.Null()]),
  outcomeCode: Type.String(),
  severityCode: Type.Union([Type.String(), Type.Null()]),
  sourceAlertId: Type.Union([Type.String(), Type.Null()]),
  sourceModule: Type.String(),
  actorId: Type.String(),
  validFrom: Type.String(),
  validTo: Type.Union([Type.String(), Type.Null()]),
  recordedAt: Type.String(),
});

const RecordEngagementOutcomeBody = Type.Object({
  enrolmentId: Type.String(),
  moduleRegistrationId: Type.Optional(Type.String()),
  outcomeCode: Type.String({ minLength: 1 }),
  severityCode: Type.Optional(Type.String()),
  effectiveFrom: Type.String({ format: 'date-time' }),
  sourceAlertId: Type.Optional(Type.String()),
  // Populated only for outcomeCode 'referred-sponsor-compliance'.
  policyVersionId: Type.Optional(Type.String()),
  evidenceWindowFrom: Type.Optional(Type.String({ format: 'date-time' })),
  evidenceWindowTo: Type.Optional(Type.String({ format: 'date-time' })),
  evidenceSnapshot: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  evidenceHash: Type.Optional(Type.String()),
  reevaluationRequired: Type.Optional(Type.Boolean()),
});

const ListEngagementOutcomeQuery = Type.Object({
  enrolmentId: Type.Optional(Type.String()),
});

export function engagementOutcomeRoutes(fastify: FastifyInstance): void {
  fastify.post(
    '/students/:personId/engagement-outcomes',
    {
      schema: {
        params: Type.Object({ personId: Type.String() }),
        body: RecordEngagementOutcomeBody,
        response: {
          201: Type.Object({ engagementOutcomeId: Type.String() }),
          404: ErrorSchema,
          422: ErrorSchema,
        },
      },
      preHandler: [requirePermission('engagement-outcome:write')],
    },
    async (request, reply) => {
      const { personId } = request.params as { personId: string };
      const body = request.body as RecordEngagementOutcomeInput;
      const engagementOutcomeId = await fastify.engagementOutcomeService.recordOutcome(
        request.tenantId,
        personId,
        body,
        request.user.sub,
      );

      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'engagement_outcome',
        entityId: engagementOutcomeId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });

      await reply.code(201).send({ engagementOutcomeId });
    },
  );

  fastify.get(
    '/students/:personId/engagement-outcomes',
    {
      schema: {
        params: Type.Object({ personId: Type.String() }),
        querystring: ListEngagementOutcomeQuery,
        response: { 200: Type.Array(EngagementOutcomeSchema), 404: ErrorSchema },
      },
      preHandler: [requireSelfOrPermission('engagement-outcome:read:own', 'engagement-outcome:read:all')],
    },
    async (request, reply) => {
      const { personId } = request.params as { personId: string };
      const query = request.query as { enrolmentId?: string };
      const outcomes = await fastify.engagementOutcomeService.listOutcomes(
        personId,
        request.tenantId,
        query.enrolmentId,
      );
      await reply.send(outcomes.map(engagementOutcomeToWire));
    },
  );
}

function engagementOutcomeToWire(outcome: EngagementOutcomeDto) {
  return {
    ...outcome,
    validFrom: outcome.validFrom.toISOString(),
    validTo: outcome.validTo?.toISOString() ?? null,
    recordedAt: outcome.recordedAt.toISOString(),
  };
}
