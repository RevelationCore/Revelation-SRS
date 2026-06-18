import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

import type {
  AdjustmentDistributionDto,
  AdjustmentDto,
  RecordAdjustmentInput,
} from '../platform/adjustments/adjustment-service.js';

const ErrorSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const AdjustmentSchema = Type.Object({
  adjustmentId: Type.String(),
  enrolmentId: Type.String(),
  personId: Type.String(),
  adjustmentTypeCode: Type.String(),
  scopeCode: Type.String(),
  notes: Type.Union([Type.String(), Type.Null()]),
  actorId: Type.String(),
  validFrom: Type.String(),
  validTo: Type.Union([Type.String(), Type.Null()]),
  recordedAt: Type.String(),
  recordedUntil: Type.Union([Type.String(), Type.Null()]),
});

const DistributionSchema = Type.Object({
  distributionId: Type.String(),
  adjustmentId: Type.String(),
  targetSystem: Type.String(),
  statusCode: Type.String(),
  distributedAt: Type.Union([Type.String(), Type.Null()]),
  failureReason: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

const RecordAdjustmentBody = Type.Object({
  enrolmentId: Type.String(),
  adjustmentTypeCode: Type.String({ minLength: 1 }),
  scopeCode: Type.String({ minLength: 1 }),
  validFrom: Type.String({ format: 'date-time' }),
  validTo: Type.Optional(Type.String({ format: 'date-time' })),
  notes: Type.Optional(Type.String()),
});

const ListAdjustmentQuery = Type.Object({
  enrolmentId: Type.Optional(Type.String()),
});

const AcknowledgeDistributionBody = Type.Object({
  targetSystem: Type.String({ minLength: 1 }),
});

export function adjustmentRoutes(fastify: FastifyInstance): void {
  fastify.post(
    '/students/:personId/adjustments',
    {
      schema: {
        params: Type.Object({ personId: Type.String() }),
        body: RecordAdjustmentBody,
        response: {
          201: Type.Object({ adjustmentId: Type.String() }),
          404: ErrorSchema,
          422: ErrorSchema,
        },
      },
      preHandler: [requirePermission('adjustment:write')],
    },
    async (request, reply) => {
      const { personId } = request.params as { personId: string };
      const body = request.body as RecordAdjustmentInput;
      const adjustmentId = await fastify.adjustmentService.recordAdjustment(
        request.tenantId,
        personId,
        body,
        request.user.sub,
      );

      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'reasonable_adjustment',
        entityId: adjustmentId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });

      await reply.code(201).send({ adjustmentId });
    },
  );

  fastify.get(
    '/students/:personId/adjustments',
    {
      schema: {
        params: Type.Object({ personId: Type.String() }),
        querystring: ListAdjustmentQuery,
        response: { 200: Type.Array(AdjustmentSchema), 404: ErrorSchema },
      },
      preHandler: [requirePermission('adjustment:read:all')],
    },
    async (request, reply) => {
      const { personId } = request.params as { personId: string };
      const query = request.query as { enrolmentId?: string };
      const adjustments = await fastify.adjustmentService.listAdjustments(
        personId,
        request.tenantId,
        query.enrolmentId,
      );
      await reply.send(adjustments.map(adjustmentToWire));
    },
  );

  fastify.get(
    '/adjustments/:adjustmentId',
    {
      schema: {
        params: Type.Object({ adjustmentId: Type.String() }),
        response: { 200: AdjustmentSchema, 404: ErrorSchema },
      },
      preHandler: [requirePermission('adjustment:read:all')],
    },
    async (request, reply) => {
      const { adjustmentId } = request.params as { adjustmentId: string };
      const adjustment = await fastify.adjustmentService.getAdjustment(adjustmentId, request.tenantId);
      await reply.send(adjustmentToWire(adjustment));
    },
  );

  fastify.get(
    '/adjustments/:adjustmentId/distributions',
    {
      schema: {
        params: Type.Object({ adjustmentId: Type.String() }),
        response: { 200: Type.Array(DistributionSchema), 404: ErrorSchema },
      },
      preHandler: [requirePermission('adjustment:read:all')],
    },
    async (request, reply) => {
      const { adjustmentId } = request.params as { adjustmentId: string };
      const distributions = await fastify.adjustmentService.listDistributions(adjustmentId, request.tenantId);
      await reply.send(distributions.map(distributionToWire));
    },
  );

  fastify.post(
    '/adjustments/:adjustmentId/distributions/:distributionId/acknowledge',
    {
      schema: {
        params: Type.Object({
          adjustmentId: Type.String(),
          distributionId: Type.String(),
        }),
        body: AcknowledgeDistributionBody,
        response: { 204: Type.Null(), 404: ErrorSchema },
      },
      preHandler: [requirePermission('integration:manage')],
    },
    async (request, reply) => {
      const { adjustmentId, distributionId } = request.params as {
        adjustmentId: string;
        distributionId: string;
      };
      const body = request.body as { targetSystem: string };
      await fastify.adjustmentService.acknowledgeDistribution(
        adjustmentId,
        distributionId,
        request.tenantId,
        body.targetSystem,
      );
      await reply.code(204).send();
    },
  );

  fastify.post(
    '/adjustments/:adjustmentId/expire',
    {
      schema: {
        params: Type.Object({ adjustmentId: Type.String() }),
        response: { 204: Type.Null(), 404: ErrorSchema },
      },
      preHandler: [requirePermission('adjustment:write')],
    },
    async (request, reply) => {
      const { adjustmentId } = request.params as { adjustmentId: string };
      await fastify.adjustmentService.expireAdjustment(adjustmentId, request.tenantId, request.user.sub);

      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'reasonable_adjustment',
        entityId: adjustmentId,
        actionType: 'update',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
        reasonText: 'Adjustment expired',
      });

      await reply.code(204).send();
    },
  );
}

function adjustmentToWire(adjustment: AdjustmentDto) {
  return {
    ...adjustment,
    validFrom: adjustment.validFrom.toISOString(),
    validTo: adjustment.validTo?.toISOString() ?? null,
    recordedAt: adjustment.recordedAt.toISOString(),
    recordedUntil: adjustment.recordedUntil?.toISOString() ?? null,
  };
}

function distributionToWire(distribution: AdjustmentDistributionDto) {
  return {
    ...distribution,
    distributedAt: distribution.distributedAt?.toISOString() ?? null,
    createdAt: distribution.createdAt.toISOString(),
    updatedAt: distribution.updatedAt.toISOString(),
  };
}
