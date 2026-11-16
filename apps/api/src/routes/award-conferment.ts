import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { AwardConferment, AwardRecommendation, ReassessmentPlan } from '@revelation-srs/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';

const ErrorSchema = Type.Object({ type: Type.String(), title: Type.String(), status: Type.Number(), detail: Type.Optional(Type.String()) });
const Nullable = <T extends ReturnType<typeof Type.String>>(t: T) => Type.Union([t, Type.Null()]);
const DateString = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' });

const ConfermentSchema = Type.Object({
  confermentId: Type.String(), recommendationId: Type.String(), awardId: Type.String(), confermentDate: Type.String(),
  authorityRef: Type.String(), conferredBy: Type.String(), conferredAt: Type.String(),
});
const RecommendationSchema = Type.Object({
  recommendationId: Type.String(), enrolmentId: Type.String(), personId: Type.String(), examBoardId: Nullable(Type.String()),
  awardTypeCode: Type.String(), qualificationCode: Type.String(), classificationCode: Type.String(),
  calculatedClassificationCode: Nullable(Type.String()), aggregateMark: Type.Union([Type.Number(), Type.Null()]),
  discretionReason: Nullable(Type.String()), authorityRef: Nullable(Type.String()), statusCode: Type.String(),
  recommendedBy: Type.String(), recommendedAt: Type.String(), withdrawnReason: Nullable(Type.String()),
  conferment: Type.Union([ConfermentSchema, Type.Null()]),
});
const PlanSchema = Type.Object({
  reassessmentPlanId: Type.String(), enrolmentId: Type.String(), progressionDecisionId: Type.String(), planTypeCode: Type.String(),
  moduleRegistrationId: Nullable(Type.String()), assessmentComponentId: Nullable(Type.String()), academicPeriodId: Nullable(Type.String()),
  attemptNumber: Type.Integer(), markCap: Type.Union([Type.Integer(), Type.Null()]), dueDate: Nullable(Type.String()),
  statusCode: Type.String(), outcomeNote: Nullable(Type.String()), createdBy: Type.String(), createdAt: Type.String(),
  closedBy: Nullable(Type.String()), closedAt: Nullable(Type.String()),
});

/** Award recommendation and conferment, and reassessment plans (BPR-D14; BP-06-002/003). */
export function awardConfermentRoutes(fastify: FastifyInstance): void {
  fastify.get('/enrolments/:enrolmentId/award-recommendations', {
    schema: { params: Type.Object({ enrolmentId: Type.String() }), response: { 200: Type.Array(RecommendationSchema) } },
    preHandler: [requirePermission('progression:read')],
  }, async (request, reply) => {
    const { enrolmentId } = request.params as { enrolmentId: string };
    const list = await fastify.confermentService.listForEnrolment(request.tenantId, enrolmentId);
    await reply.send(list.map((r) => recommendationToWire(r, r.conferment)));
  });

  fastify.post('/enrolments/:enrolmentId/award-recommendations', {
    schema: {
      params: Type.Object({ enrolmentId: Type.String() }),
      body: Type.Object({
        awardTypeCode: Type.Union([Type.Literal('standard'), Type.Literal('exit'), Type.Literal('aegrotat'), Type.Literal('posthumous')]),
        qualificationCode: Type.String({ minLength: 1, maxLength: 50 }), classificationCode: Type.String({ minLength: 1, maxLength: 50 }),
        examBoardId: Type.Optional(Type.String()), discretionReason: Type.Optional(Type.String({ maxLength: 2000 })),
        authorityRef: Type.Optional(Type.String({ maxLength: 200 })),
      }),
      response: { 201: RecommendationSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('award:recommend')],
  }, async (request, reply) => {
    const { enrolmentId } = request.params as { enrolmentId: string };
    const rec = await fastify.confermentService.recommend(request.tenantId, enrolmentId, request.body as never, request.user.sub);
    await audit(fastify, request, 'award_recommendation', rec.id, 'create', `Recommended ${rec.awardTypeCode} ${rec.qualificationCode} ${rec.classificationCode}`);
    await reply.code(201).send(recommendationToWire(rec, null));
  });

  fastify.post('/award-recommendations/:recommendationId/conferment', {
    schema: {
      params: Type.Object({ recommendationId: Type.String() }),
      body: Type.Object({ confermentDate: DateString, authorityRef: Type.String({ minLength: 1, maxLength: 200 }) }),
      response: { 201: RecommendationSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('award:confer')],
  }, async (request, reply) => {
    const { recommendationId } = request.params as { recommendationId: string };
    const { recommendation, conferment } = await fastify.confermentService.confer(request.tenantId, recommendationId, request.body as never, request.user.sub);
    await audit(fastify, request, 'award_conferment', conferment.id, 'create', `Conferred award ${conferment.awardId}`);
    await reply.code(201).send(recommendationToWire(recommendation, conferment));
  });

  fastify.post('/award-recommendations/:recommendationId/withdrawal', {
    schema: {
      params: Type.Object({ recommendationId: Type.String() }), body: Type.Object({ reason: Type.String({ minLength: 1, maxLength: 2000 }) }),
      response: { 200: RecommendationSchema, 404: ErrorSchema, 409: ErrorSchema },
    },
    preHandler: [requirePermission('award:recommend')],
  }, async (request, reply) => {
    const { recommendationId } = request.params as { recommendationId: string };
    const { reason } = request.body as { reason: string };
    const rec = await fastify.confermentService.withdrawRecommendation(request.tenantId, recommendationId, reason);
    await audit(fastify, request, 'award_recommendation', rec.id, 'update', 'Recommendation withdrawn');
    await reply.send(recommendationToWire(rec, null));
  });

  fastify.get('/enrolments/:enrolmentId/reassessment-plans', {
    schema: { params: Type.Object({ enrolmentId: Type.String() }), response: { 200: Type.Array(PlanSchema) } },
    preHandler: [requirePermission('reassessment:read')],
  }, async (request, reply) => {
    const { enrolmentId } = request.params as { enrolmentId: string };
    await reply.send((await fastify.confermentService.listPlans(request.tenantId, enrolmentId)).map(planToWire));
  });

  fastify.post('/progression-decisions/:progressionDecisionId/reassessment-plans', {
    schema: {
      params: Type.Object({ progressionDecisionId: Type.String() }),
      body: Type.Object({
        planTypeCode: Type.String(), moduleRegistrationId: Type.Optional(Type.String()), assessmentComponentId: Type.Optional(Type.String()),
        academicPeriodId: Type.Optional(Type.String()), dueDate: Type.Optional(DateString), markCap: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
      }),
      response: { 201: PlanSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('reassessment:write')],
  }, async (request, reply) => {
    const { progressionDecisionId } = request.params as { progressionDecisionId: string };
    const plan = await fastify.confermentService.createPlan(request.tenantId, progressionDecisionId, request.body as never, request.user.sub);
    await audit(fastify, request, 'reassessment_plan', plan.id, 'create', `Planned ${plan.planTypeCode} (attempt ${plan.attemptNumber})`);
    await reply.code(201).send(planToWire(plan));
  });

  fastify.post('/reassessment-plans/:planId/closure', {
    schema: {
      params: Type.Object({ planId: Type.String() }),
      body: Type.Object({
        statusCode: Type.Union([Type.Literal('completed'), Type.Literal('expired'), Type.Literal('cancelled')]),
        note: Type.Optional(Type.String({ maxLength: 2000 })),
      }),
      response: { 200: PlanSchema, 404: ErrorSchema, 409: ErrorSchema },
    },
    preHandler: [requirePermission('reassessment:write')],
  }, async (request, reply) => {
    const { planId } = request.params as { planId: string };
    const plan = await fastify.confermentService.closePlan(request.tenantId, planId, request.body as never, request.user.sub);
    await audit(fastify, request, 'reassessment_plan', plan.id, 'update', `Plan ${plan.statusCode}`);
    await reply.send(planToWire(plan));
  });
}

async function audit(fastify: FastifyInstance, request: FastifyRequest, entityType: string, entityId: string, actionType: 'create' | 'update', reasonText: string) {
  await fastify.audit.record({
    tenantId: request.tenantId, entityType, entityId, actionType, actorType: 'user', actorId: request.user.sub,
    actorDisplayName: request.user.displayName, correlationId: request.id, reasonText,
  });
}

function confermentToWire(c: AwardConferment) {
  return {
    confermentId: c.id, recommendationId: c.recommendationId, awardId: c.awardId, confermentDate: c.confermentDate,
    authorityRef: c.authorityRef, conferredBy: c.conferredBy, conferredAt: c.conferredAt.toISOString(),
  };
}

function recommendationToWire(r: AwardRecommendation, conferment: AwardConferment | null) {
  const { id, tenantId: _t, ...rest } = r;
  return { recommendationId: id, ...rest, recommendedAt: r.recommendedAt.toISOString(), conferment: conferment ? confermentToWire(conferment) : null };
}

function planToWire(p: ReassessmentPlan) {
  const { id, tenantId: _t, ...rest } = p;
  return { reassessmentPlanId: id, ...rest, createdAt: p.createdAt.toISOString(), closedAt: p.closedAt?.toISOString() ?? null };
}
