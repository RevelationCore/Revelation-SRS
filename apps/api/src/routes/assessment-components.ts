import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

import type {
  AssessmentComponentDto,
  CreateAssessmentComponentInput,
  UpdateAssessmentComponentInput,
} from '../platform/assessment/component-service.js';

const ErrorSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const AssessmentComponentSchema = Type.Object({
  assessmentComponentId: Type.String(),
  moduleOfferingId: Type.String(),
  componentTypeCode: Type.String(),
  title: Type.String(),
  weighting: Type.Number(),
  passMarkOverride: Type.Union([Type.Number(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

const AssessmentComponentBody = Type.Object({
  componentTypeCode: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1 }),
  weighting: Type.Integer({ minimum: 1, maximum: 100 }),
  passMarkOverride: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
});

const AssessmentComponentPatchBody = Type.Object({
  componentTypeCode: Type.Optional(Type.String({ minLength: 1 })),
  title: Type.Optional(Type.String({ minLength: 1 })),
  weighting: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  passMarkOverride: Type.Optional(Type.Union([Type.Number({ minimum: 0, maximum: 100 }), Type.Null()])),
});

export function assessmentComponentRoutes(fastify: FastifyInstance): void {
  fastify.get(
    '/module-offerings/:moduleOfferingId/components',
    {
      schema: {
        params: Type.Object({ moduleOfferingId: Type.String() }),
        response: { 200: Type.Array(AssessmentComponentSchema), 404: ErrorSchema },
      },
      preHandler: [requirePermission('catalogue:read')],
    },
    async (request, reply) => {
      const { moduleOfferingId } = request.params as { moduleOfferingId: string };
      const components = await fastify.assessmentComponentService.listAssessmentComponents(
        moduleOfferingId,
        request.tenantId,
      );
      await reply.send(components.map(assessmentComponentToWire));
    },
  );

  fastify.post(
    '/module-offerings/:moduleOfferingId/components',
    {
      schema: {
        params: Type.Object({ moduleOfferingId: Type.String() }),
        body: AssessmentComponentBody,
        response: {
          201: Type.Object({ assessmentComponentId: Type.String() }),
          404: ErrorSchema,
          422: ErrorSchema,
        },
      },
      preHandler: [requirePermission('catalogue:write')],
    },
    async (request, reply) => {
      const { moduleOfferingId } = request.params as { moduleOfferingId: string };
      const body = request.body as CreateAssessmentComponentInput;
      const assessmentComponentId = await fastify.assessmentComponentService.createAssessmentComponent(
        request.tenantId,
        moduleOfferingId,
        body,
      );

      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'assessment_component',
        entityId: assessmentComponentId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });

      await reply.code(201).send({ assessmentComponentId });
    },
  );

  fastify.patch(
    '/module-offerings/:moduleOfferingId/components/:assessmentComponentId',
    {
      schema: {
        params: Type.Object({
          moduleOfferingId: Type.String(),
          assessmentComponentId: Type.String(),
        }),
        body: AssessmentComponentPatchBody,
        response: { 204: Type.Null(), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('catalogue:write')],
    },
    async (request, reply) => {
      const { assessmentComponentId } = request.params as {
        moduleOfferingId: string;
        assessmentComponentId: string;
      };
      const { moduleOfferingId } = request.params as {
        moduleOfferingId: string;
        assessmentComponentId: string;
      };
      const body = request.body as UpdateAssessmentComponentInput;

      await fastify.assessmentComponentService.updateAssessmentComponent(
        assessmentComponentId,
        request.tenantId,
        body,
        moduleOfferingId,
      );

      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'assessment_component',
        entityId: assessmentComponentId,
        afterValue: body,
        actionType: 'update',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });

      await reply.code(204).send();
    },
  );
}

function assessmentComponentToWire(component: AssessmentComponentDto) {
  return {
    ...component,
    createdAt: component.createdAt.toISOString(),
    updatedAt: component.updatedAt.toISOString(),
  };
}
