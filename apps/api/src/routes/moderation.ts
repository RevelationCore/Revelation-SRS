import { Type } from '@sinclair/typebox';
import { requireAnyPermission, requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

const ErrorSchema = Type.Object({
  type:   Type.String(),
  title:  Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const CreateMarkSetBody = Type.Object({
  assessmentComponentId: Type.String(),
  markIds:               Type.Array(Type.String()),
  sourceQueryHash:        Type.String(),
});

const StartReviewBody = Type.Object({
  markSetId:   Type.String(),
  ruleVersion: Type.String(),
});

const RecordSampleBody = Type.Object({
  markId:           Type.String(),
  sampleReasonCode: Type.String(),
  originalMark:     Type.Number(),
});

const CompleteReviewBody = Type.Object({
  outcomeCode: Type.Union([
    Type.Literal('no-change'),
    Type.Literal('adjusted'),
    Type.Literal('escalated'),
  ]),
});

const ModerationReviewSchema = Type.Object({
  moderationReviewId: Type.String(),
  markSetId:          Type.String(),
  moderatorActorId:   Type.String(),
  ruleVersion:        Type.String(),
  startedAt:          Type.String(),
  completedAt:        Type.Union([Type.String(), Type.Null()]),
  outcomeCode:        Type.Union([Type.String(), Type.Null()]),
});

export function moderationRoutes(fastify: FastifyInstance): void {
  fastify.get(
    '/moderation/reviews',
    {
      schema: {
        querystring: Type.Object({ onlyOpen: Type.Optional(Type.Boolean()) }),
        response: { 200: Type.Array(ModerationReviewSchema) },
      },
      preHandler: [requireAnyPermission('mark:read:all', 'mark:write')],
    },
    async (request, reply) => {
      const { onlyOpen } = request.query as { onlyOpen?: boolean };
      const reviews = await fastify.moderationService.listReviews(request.tenantId, onlyOpen);
      await reply.send(reviews.map((r) => ({
        ...r,
        startedAt:   r.startedAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
      })));
    },
  );

  fastify.post(
    '/moderation/mark-sets',
    {
      schema: {
        body:     CreateMarkSetBody,
        response: { 201: Type.Object({ markSetId: Type.String() }), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('mark:write')],
    },
    async (request, reply) => {
      const body = request.body as { assessmentComponentId: string; markIds: string[]; sourceQueryHash: string };
      const markSetId = await fastify.moderationService.createMarkSet(request.tenantId, body, request.user.sub);

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'mark_set',
        entityId:         markSetId,
        actionType:       'create',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(201).send({ markSetId });
    },
  );

  fastify.post(
    '/moderation/reviews',
    {
      schema: {
        body:     StartReviewBody,
        response: { 201: Type.Object({ reviewId: Type.String() }) },
      },
      preHandler: [requirePermission('mark:write')],
    },
    async (request, reply) => {
      const { markSetId, ruleVersion } = request.body as { markSetId: string; ruleVersion: string };
      const reviewId = await fastify.moderationService.startReview(request.tenantId, markSetId, ruleVersion, request.user.sub);
      await reply.code(201).send({ reviewId });
    },
  );

  fastify.post(
    '/moderation/reviews/:reviewId/samples',
    {
      schema: {
        params:   Type.Object({ reviewId: Type.String() }),
        body:     RecordSampleBody,
        response: { 201: Type.Object({ sampleId: Type.String() }) },
      },
      preHandler: [requirePermission('mark:write')],
    },
    async (request, reply) => {
      const { reviewId } = request.params as { reviewId: string };
      const body = request.body as { markId: string; sampleReasonCode: string; originalMark: number };
      const sampleId = await fastify.moderationService.recordSample(request.tenantId, reviewId, body);
      await reply.code(201).send({ sampleId });
    },
  );

  fastify.patch(
    '/moderation/reviews/:reviewId/complete',
    {
      schema: {
        params:   Type.Object({ reviewId: Type.String() }),
        body:     CompleteReviewBody,
        response: { 204: Type.Null(), 404: ErrorSchema },
      },
      preHandler: [requirePermission('mark:write')],
    },
    async (request, reply) => {
      const { reviewId } = request.params as { reviewId: string };
      const { outcomeCode } = request.body as { outcomeCode: string };
      await fastify.moderationService.completeReview(request.tenantId, reviewId, outcomeCode);

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'moderation_review',
        entityId:         reviewId,
        fieldName:        'outcome_code',
        afterValue:       outcomeCode,
        actionType:       'update',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(204).send();
    },
  );
}
