import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import { ForbiddenError } from '@revelation-srs/domain';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const RetentionDetailSchema = Type.Object({
  personId: Type.String(),
  action:   Type.Union([
    Type.Literal('anonymised'),
    Type.Literal('flagged-for-dpo'),
    Type.Literal('skipped-award-hold'),
    Type.Literal('skipped-hold'),
    Type.Literal('skipped-restriction'),
    Type.Literal('skipped-open-request'),
    Type.Literal('skipped-schedule'),
  ]),
  reason: Type.Optional(Type.String()),
});

const RetentionSweepResultSchema = Type.Object({
  tenantId:   Type.String(),
  dryRun:     Type.Boolean(),
  checkedAt:  Type.String(),
  eligible:   Type.Number(),
  anonymised: Type.Number(),
  flagged:    Type.Number(),
  skipped:    Type.Number(),
  details:    Type.Array(RetentionDetailSchema),
});

const ProblemSchema = Type.Object({
  type: Type.String(), title: Type.String(), status: Type.Number(), detail: Type.Optional(Type.String()), instance: Type.Optional(Type.String()),
});

const PlanSchema = Type.Object({
  planId:          Type.String(),
  statusCode:      Type.String(),
  preparedBy:      Type.String(),
  preparedAt:      Type.String(),
  approvedBy:      Type.Union([Type.String(), Type.Null()]),
  approvedAt:      Type.Union([Type.String(), Type.Null()]),
  rejectedBy:      Type.Union([Type.String(), Type.Null()]),
  rejectionReason: Type.Union([Type.String(), Type.Null()]),
  executedBy:      Type.Union([Type.String(), Type.Null()]),
  executedAt:      Type.Union([Type.String(), Type.Null()]),
  personIds:       Type.Array(Type.String()),
});

const ExecutionSchema = Type.Object({
  planId:       Type.String(),
  executedAt:   Type.String(),
  anonymised:   Type.Number(),
  certificates: Type.Array(Type.Object({ personId: Type.String(), certificateRef: Type.String() })),
});

const PlanParams = Type.Object({ planId: Type.String({ format: 'uuid' }) });

/** The preparer of a plan never approves or rejects it (BL-327). */
async function separationOfDuties(request: FastifyRequest, reply: FastifyReply, err: unknown): Promise<boolean> {
  if (!(err instanceof ForbiddenError)) return false;
  await reply.code(403).type('application/problem+json').send({
    type: 'https://srs.example.com/errors/separation-of-duties', title: 'Separation of duties', status: 403, detail: err.message, instance: request.url,
  });
  return true;
}

// eslint-disable-next-line @typescript-eslint/require-await
export async function adminRetentionRoutes(fastify: FastifyInstance): Promise<void> {
  // ── POST /admin/retention/enforce ─────────────────────────────────────────
  //
  // Dry run of a retention sweep for the caller's tenant: who would be
  // anonymised, flagged or skipped, and why. ?dryRun=false is refused (409):
  // disposal goes through an approved plan (BL-327, below).
  //
  // Requires permission: retention:enforce

  fastify.post(
    '/admin/retention/enforce',
    {
      schema: {
        summary:     'Retention enforcement sweep',
        description: 'Dry run of a data retention sweep for the tenant: identifies eligible persons and returns counts without making changes. dryRun=false is refused (409); disposal needs an approved plan (POST /admin/retention/plans).',
        tags:        ['Admin', 'Privacy'],
        querystring: Type.Object({
          dryRun: Type.Optional(Type.Boolean({ default: true })),
        }),
        response: {
          200: RetentionSweepResultSchema,
          409: ProblemSchema,
        },
      },
      preHandler: [requirePermission('retention:enforce')],
    },
    async (request, reply) => {
      const { dryRun = true } = request.query as { dryRun?: boolean };
      const result = await fastify.retentionService.runRetentionSweep(request.tenantId, dryRun);
      return reply.send(result);
    },
  );

  // ── Two-person disposal (BL-327) ───────────────────────────────────────────
  // prepare (retention:enforce) → approve or reject by someone else
  // (retention:approve) → execute (retention:enforce), all or nothing.
  const planTags = ['Admin', 'Privacy'];

  fastify.post('/admin/retention/plans', {
    schema: { summary: 'Prepare a retention disposal plan', tags: planTags, response: { 201: PlanSchema, 422: ProblemSchema } },
    preHandler: [requirePermission('retention:enforce')],
  }, async (request, reply) => {
    const plan = await fastify.retentionService.preparePlan(request.tenantId, request.user.sub);
    return reply.code(201).send(plan);
  });

  fastify.get('/admin/retention/plans', {
    schema: { summary: 'List retention disposal plans', tags: planTags, response: { 200: Type.Array(PlanSchema) } },
    preHandler: [requirePermission('retention:enforce')],
  }, async (request, reply) => reply.send(await fastify.retentionService.listPlans(request.tenantId)));

  fastify.get('/admin/retention/plans/:planId', {
    schema: { summary: 'Get a retention disposal plan', tags: planTags, params: PlanParams, response: { 200: PlanSchema, 404: ProblemSchema } },
    preHandler: [requirePermission('retention:enforce')],
  }, async (request, reply) => {
    const { planId } = request.params as { planId: string };
    return reply.send(await fastify.retentionService.getPlan(request.tenantId, planId));
  });

  fastify.post('/admin/retention/plans/:planId/approve', {
    schema: { summary: 'Approve a retention disposal plan (not its preparer)', tags: planTags, params: PlanParams, response: { 200: PlanSchema, 403: ProblemSchema, 404: ProblemSchema, 409: ProblemSchema } },
    preHandler: [requirePermission('retention:approve')],
  }, async (request, reply) => {
    const { planId } = request.params as { planId: string };
    try {
      return await reply.send(await fastify.retentionService.approvePlan(request.tenantId, planId, request.user.sub));
    } catch (err) {
      if (await separationOfDuties(request, reply, err)) return reply;
      throw err;
    }
  });

  fastify.post('/admin/retention/plans/:planId/reject', {
    schema: {
      summary: 'Reject a retention disposal plan (not its preparer)', tags: planTags, params: PlanParams,
      body: Type.Object({ reason: Type.String({ minLength: 1, maxLength: 2000 }) }),
      response: { 200: PlanSchema, 403: ProblemSchema, 404: ProblemSchema, 409: ProblemSchema },
    },
    preHandler: [requirePermission('retention:approve')],
  }, async (request, reply) => {
    const { planId } = request.params as { planId: string };
    const { reason } = request.body as { reason: string };
    try {
      return await reply.send(await fastify.retentionService.rejectPlan(request.tenantId, planId, request.user.sub, reason));
    } catch (err) {
      if (await separationOfDuties(request, reply, err)) return reply;
      throw err;
    }
  });

  fastify.post('/admin/retention/plans/:planId/execute', {
    schema: { summary: 'Execute an approved retention disposal plan (irreversible)', tags: planTags, params: PlanParams, response: { 200: ExecutionSchema, 404: ProblemSchema, 409: ProblemSchema } },
    preHandler: [requirePermission('retention:enforce')],
  }, async (request, reply) => {
    const { planId } = request.params as { planId: string };
    return reply.send(await fastify.retentionService.executePlan(request.tenantId, planId, request.user.sub));
  });
}
