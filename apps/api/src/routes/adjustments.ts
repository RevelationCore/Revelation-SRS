import { Type } from '@sinclair/typebox';
import { requireAnyPermission, requirePermission, requireSelfOrPermission } from '@revelation-srs/auth';
import { ConflictError, hasPermission, NotFoundError } from '@revelation-srs/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type {
  AdjustmentDistributionDto,
  AdjustmentDto,
  AdjustmentTaskDto,
  RecordAdjustmentInput,
  ReplyActor,
} from '../platform/adjustments/adjustment-service.js';
import type { TargetConfigDto } from '../platform/adjustments/target-config.js';

const ErrorSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const AmountSchema = Type.Object({
  value: Type.Number({ exclusiveMinimum: 0, maximum: 999999.99 }),
  unitCode: Type.String({ minLength: 1 }),
}, { description: 'Structured amount, e.g. { value: 25, unitCode: "percent-of-duration" }' });

const AdjustmentSchema = Type.Object({
  adjustmentId: Type.String(),
  enrolmentId: Type.String(),
  personId: Type.String(),
  adjustmentTypeCode: Type.String(),
  scopeCode: Type.String(),
  amount: Type.Union([AmountSchema, Type.Null()]),
  notes: Type.Union([Type.String(), Type.Null()]),
  actorId: Type.String(),
  validFrom: Type.String(),
  validTo: Type.Union([Type.String(), Type.Null()]),
  recordedAt: Type.String(),
  recordedUntil: Type.Union([Type.String(), Type.Null()]),
  sourceCaseId: Type.Union([Type.String(), Type.Null()]),
  outcomeDocumentId: Type.Union([Type.String(), Type.Null()]),
  // ADR-033: the authority it was recorded under.
  provenanceCode: Type.String(),
  manualProposalId: Type.Union([Type.String(), Type.Null()]),
});

const DistributionSchema = Type.Object({
  distributionId: Type.String(),
  adjustmentId: Type.String(),
  targetSystem: Type.String(),
  statusCode: Type.String(),
  fulfilmentModeCode: Type.String(),
  distributedAt: Type.Union([Type.String(), Type.Null()]),
  failureReason: Type.Union([Type.String(), Type.Null()]),
  requestPublishedAt: Type.Union([Type.String(), Type.Null()]),
  withdrawalRequestedAt: Type.Union([Type.String(), Type.Null()]),
  withdrawalPublishedAt: Type.Union([Type.String(), Type.Null()]),
  withdrawnAt: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

const RecordAdjustmentBody = Type.Object({
  enrolmentId: Type.String(),
  adjustmentTypeCode: Type.String({ minLength: 1 }),
  scopeCode: Type.String({ minLength: 1 }),
  validFrom: Type.String({ format: 'date-time' }),
  validTo: Type.Optional(Type.String({ format: 'date-time' })),
  amount: Type.Optional(AmountSchema),
  notes: Type.Optional(Type.String()),
  sourceCaseId: Type.Optional(Type.String()),
});

const ListAdjustmentQuery = Type.Object({
  enrolmentId: Type.Optional(Type.String()),
});

const TaskSchema = Type.Object({
  distributionId: Type.String(),
  adjustmentId: Type.String(),
  targetSystem: Type.String(),
  action: Type.Union([Type.Literal('apply'), Type.Literal('remove')]),
  statusCode: Type.String(),
  failureReason: Type.Union([Type.String(), Type.Null()]),
  personId: Type.String(),
  studentNumber: Type.Union([Type.String(), Type.Null()]),
  studentName: Type.Union([Type.String(), Type.Null()]),
  enrolmentId: Type.String(),
  adjustmentTypeCode: Type.String(),
  scopeCode: Type.String(),
  amount: Type.Union([AmountSchema, Type.Null()]),
  validFrom: Type.String(),
  validTo: Type.Union([Type.String(), Type.Null()]),
  dueSince: Type.String(),
  ownerDescription: Type.Union([Type.String(), Type.Null()]),
  overdue: Type.Boolean(),
});

const TargetConfigSchema = Type.Object({
  targetSystem: Type.String(),
  fulfilmentModeCode: Type.String(),
  ownerDescription: Type.Union([Type.String(), Type.Null()]),
  alertAfterHours: Type.Integer(),
  notifyEmail: Type.Union([Type.String(), Type.Null()]),
  lastOverdueNoticeAt: Type.Union([Type.String(), Type.Null()]),
  isDefault: Type.Boolean(),
  updatedAt: Type.Union([Type.String(), Type.Null()]),
  updatedBy: Type.Union([Type.String(), Type.Null()]),
});

const TargetConfigBody = Type.Object({
  fulfilmentModeCode: Type.String({ minLength: 1 }),
  ownerDescription: Type.Optional(Type.Union([Type.String({ maxLength: 200 }), Type.Null()])),
  alertAfterHours: Type.Optional(Type.Integer({ minimum: 1, maximum: 8760 })),
  /** Team mailbox sent a daily digest while tasks are overdue. */
  notifyEmail: Type.Optional(Type.Union([Type.String({ maxLength: 254 }), Type.Null()])),
});

/**
 * Replies come from an integration connector (integration:manage) or from a
 * person working the manual task queue (adjustment:fulfil), who may only reply
 * for manual targets. A person's reply is audited.
 */
function replyActor(request: FastifyRequest): ReplyActor {
  return hasPermission(request.user.roles, 'integration:manage') || hasPermission(request.user.roles, 'adjustment-distribution:reply:vle')
    ? 'connector' : 'person';
}

/**
 * A caller holding only adjustment-distribution:reply:vle (the VLE
 * connector, ADR-032) replies only for connected 'vle' distributions:
 * another target is 404, another mode 409.
 */
async function assertVleConnectorScope(fastify: FastifyInstance, request: FastifyRequest, adjustmentId: string, distributionId: string, targetSystem: string): Promise<void> {
  const roles = request.user.roles;
  if (hasPermission(roles, 'integration:manage') || hasPermission(roles, 'adjustment:fulfil')) return;
  const distribution = (await fastify.adjustmentService.listDistributions(adjustmentId, request.tenantId)).find((d) => d.distributionId === distributionId);
  if (targetSystem !== 'vle' || !distribution || distribution.targetSystem !== 'vle') throw new NotFoundError('AdjustmentDistribution', distributionId);
  if (distribution.fulfilmentModeCode !== 'connected') throw new ConflictError(`This distribution is fulfilled by a ${distribution.fulfilmentModeCode} target; the VLE connector replies only for connected ones`);
}

async function auditPersonReply(
  fastify: FastifyInstance,
  request: FastifyRequest,
  actor: ReplyActor,
  distributionId: string,
  reasonText: string,
): Promise<void> {
  if (actor !== 'person') return;
  await fastify.audit.record({
    tenantId: request.tenantId,
    entityType: 'adjustment_distribution',
    entityId: distributionId,
    actionType: 'update',
    actorType: 'user',
    actorId: request.user.sub,
    actorDisplayName: request.user.displayName,
    correlationId: request.id,
    reasonText,
  });
}

const DistributionFailureBody = Type.Object({
  targetSystem: Type.String({ minLength: 1 }),
  reason: Type.String({ minLength: 1, maxLength: 2000 }),
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
        headers: Type.Object({
          'x-idempotency-key': Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
          'idempotency-key':   Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
        }),
        response: {
          200: Type.Object({ adjustmentId: Type.String() }),
          201: Type.Object({ adjustmentId: Type.String() }),
          404: ErrorSchema,
          409: ErrorSchema,
          422: ErrorSchema,
        },
      },
      // ADR-033 (BL-376): only the wellbeing service records a core adjustment
      // here, naming the case that approved it (ADR-029). A case-less one is a
      // manual proposal a second person approves (BL-378).
      preHandler: [requirePermission('adjustment:record-approved')],
    },
    async (request, reply) => {
      const { personId } = request.params as { personId: string };
      const { sourceCaseId, ...body } = request.body as RecordAdjustmentInput & { sourceCaseId?: string };
      if (!sourceCaseId) {
        await reply.code(422).type('application/problem+json').send({
          type: 'https://srs.example.com/errors/unprocessable', title: 'Source case required', status: 422,
          detail: 'An adjustment recorded by the wellbeing service must name the approving case (sourceCaseId)', instance: request.url,
        });
        return;
      }
      // The wellbeing module sends x-idempotency-key; the platform-controls
      // routes use idempotency-key. Accept either.
      const headers = request.headers as Record<string, string | undefined>;
      const idempotencyKey = headers['x-idempotency-key'] ?? headers['idempotency-key'];
      const { adjustmentId, replayed } = await fastify.adjustmentService.recordAuthorisedAdjustment(
        request.tenantId,
        personId,
        body,
        { kind: 'wellbeing-case', sourceCaseId },
        request.user.sub,
        idempotencyKey,
      );

      // A replay recorded nothing new, so there is nothing new to audit.
      if (replayed) {
        await reply.code(200).send({ adjustmentId });
        return;
      }

      // The SRS is itself the 'exams' target: add the arrangement to entries
      // already generated for exams not yet sat (BL-058). The worker's
      // reconcile loop retries if this fails.
      try {
        await fastify.examEntryService.applyExamAdditions(request.tenantId);
      } catch (err) {
        request.log.warn({ err, adjustmentId }, 'Exam entry refresh deferred to the reconcile loop');
      }

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
      preHandler: [requireSelfOrPermission('adjustment:read:own', 'adjustment:read:all')],
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
        response: { 204: Type.Null(), 404: ErrorSchema, 409: ErrorSchema },
      },
      preHandler: [requireAnyPermission('integration:manage', 'adjustment:fulfil', 'adjustment-distribution:reply:vle')],
    },
    async (request, reply) => {
      const { adjustmentId, distributionId } = request.params as {
        adjustmentId: string;
        distributionId: string;
      };
      const body = request.body as { targetSystem: string };
      await assertVleConnectorScope(fastify, request, adjustmentId, distributionId, body.targetSystem);
      const actor = replyActor(request);
      await fastify.adjustmentService.acknowledgeDistribution(
        adjustmentId,
        distributionId,
        request.tenantId,
        body.targetSystem,
        actor,
      );
      await auditPersonReply(fastify, request, actor, distributionId, 'Manual adjustment task: confirmed applied');
      await reply.code(204).send();
    },
  );

  fastify.post(
    '/adjustments/:adjustmentId/distributions/:distributionId/failure',
    {
      schema: {
        params: Type.Object({
          adjustmentId: Type.String(),
          distributionId: Type.String(),
        }),
        body: DistributionFailureBody,
        response: { 204: Type.Null(), 404: ErrorSchema, 409: ErrorSchema },
      },
      preHandler: [requireAnyPermission('integration:manage', 'adjustment:fulfil', 'adjustment-distribution:reply:vle')],
    },
    async (request, reply) => {
      const { adjustmentId, distributionId } = request.params as {
        adjustmentId: string;
        distributionId: string;
      };
      const body = request.body as { targetSystem: string; reason: string };
      await assertVleConnectorScope(fastify, request, adjustmentId, distributionId, body.targetSystem);
      const actor = replyActor(request);
      await fastify.adjustmentService.reportDistributionFailure(
        adjustmentId,
        distributionId,
        request.tenantId,
        body.targetSystem,
        body.reason,
        actor,
      );
      await auditPersonReply(fastify, request, actor, distributionId, 'Manual adjustment task: reported cannot apply');
      await reply.code(204).send();
    },
  );

  fastify.post(
    '/adjustments/:adjustmentId/distributions/:distributionId/withdrawal/acknowledge',
    {
      schema: {
        params: Type.Object({
          adjustmentId: Type.String(),
          distributionId: Type.String(),
        }),
        body: AcknowledgeDistributionBody,
        response: { 204: Type.Null(), 404: ErrorSchema, 409: ErrorSchema },
      },
      preHandler: [requireAnyPermission('integration:manage', 'adjustment:fulfil', 'adjustment-distribution:reply:vle')],
    },
    async (request, reply) => {
      const { adjustmentId, distributionId } = request.params as {
        adjustmentId: string;
        distributionId: string;
      };
      const body = request.body as { targetSystem: string };
      await assertVleConnectorScope(fastify, request, adjustmentId, distributionId, body.targetSystem);
      const actor = replyActor(request);
      await fastify.adjustmentService.acknowledgeWithdrawal(
        adjustmentId,
        distributionId,
        request.tenantId,
        body.targetSystem,
        actor,
      );
      await auditPersonReply(fastify, request, actor, distributionId, 'Manual adjustment task: confirmed removed');
      await reply.code(204).send();
    },
  );

  // ── Manual task queue and target fulfilment settings ─────────────────────

  fastify.get(
    '/adjustment-tasks',
    {
      schema: {
        querystring: Type.Object({ targetSystem: Type.Optional(Type.String()) }),
        response: { 200: Type.Array(TaskSchema) },
      },
      preHandler: [requirePermission('adjustment:fulfil')],
    },
    async (request, reply) => {
      const { targetSystem } = request.query as { targetSystem?: string };
      const tasks = await fastify.adjustmentService.listTasks(request.tenantId, targetSystem ? { targetSystem } : {});
      await reply.send(tasks.map(taskToWire));
    },
  );

  fastify.get(
    '/adjustment-targets',
    {
      schema: { response: { 200: Type.Array(TargetConfigSchema) } },
      preHandler: [requireAnyPermission('config:read', 'adjustment:fulfil')],
    },
    async (request, reply) => {
      const configs = await fastify.adjustmentTargetConfigService.list(request.tenantId);
      await reply.send(configs.map(targetConfigToWire));
    },
  );

  fastify.put(
    '/adjustment-targets/:targetSystem',
    {
      schema: {
        params: Type.Object({ targetSystem: Type.String() }),
        body: TargetConfigBody,
        response: { 200: TargetConfigSchema, 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('config:write')],
    },
    async (request, reply) => {
      const { targetSystem } = request.params as { targetSystem: string };
      const body = request.body as { fulfilmentModeCode: string; ownerDescription?: string | null; alertAfterHours?: number; notifyEmail?: string | null };
      const before = await fastify.adjustmentTargetConfigService.get(request.tenantId, targetSystem);
      const updated = await fastify.adjustmentTargetConfigService.set(request.tenantId, targetSystem, body, request.user.sub);
      // A tenant setting: recorded against the tenant, the target in fieldName.
      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'adjustment_target_config',
        entityId: request.tenantId,
        fieldName: `${targetSystem}.fulfilment_mode_code`,
        beforeValue: { fulfilmentModeCode: before.fulfilmentModeCode, isDefault: before.isDefault },
        afterValue: { fulfilmentModeCode: updated.fulfilmentModeCode, ownerDescription: updated.ownerDescription, alertAfterHours: updated.alertAfterHours, notifyEmail: updated.notifyEmail },
        actionType: 'update',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
        reasonText: `Fulfilment mode set to ${body.fulfilmentModeCode}`,
      });
      await reply.send(targetConfigToWire(updated));
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
      // The SRS is itself the 'exams' target: remove the ended arrangement
      // from entries for exams not yet sat and confirm the withdrawal.
      await fastify.examEntryService.applyExamWithdrawals(request.tenantId);

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

  // ── Outcome document ────────────────────────────────────────────────────
  //
  // Detail document expanding on the coded adjustment (e.g. a specific
  // seating/equipment/software specification), when type/scope/notes alone
  // aren't expressive enough. Staff-authored (upload is adjustment:write
  // only — a student can view but not attach their own "official" outcome
  // document); download is self-or-all, matching the list route above.

  fastify.post(
    '/students/:personId/adjustments/:adjustmentId/outcome-document',
    {
      schema: {
        params: Type.Object({ personId: Type.String(), adjustmentId: Type.String() }),
        response: {
          201: Type.Object({ documentId: Type.String(), checksumSha256: Type.String() }),
          400: ErrorSchema,
          404: ErrorSchema,
          422: ErrorSchema,
        },
      },
      preHandler: [requirePermission('adjustment:write')],
    },
    async (request, reply) => {
      const { personId, adjustmentId } = request.params as { personId: string; adjustmentId: string };

      const file = await request.file();
      if (!file) return reply.code(400).send({ error: 'multipart file field is required' });
      const content = await file.toBuffer();

      const result = await fastify.adjustmentService.attachOutcomeDocument(
        adjustmentId,
        personId,
        request.tenantId,
        request.user.sub,
        { filename: file.filename, mimeType: file.mimetype, content },
      );

      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'reasonable_adjustment',
        entityId: adjustmentId,
        actionType: 'update',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
        reasonText: 'Outcome document attached',
      });

      await reply.code(201).send(result);
    },
  );

  fastify.get(
    '/students/:personId/adjustments/:adjustmentId/outcome-document',
    {
      schema: {
        params: Type.Object({ personId: Type.String(), adjustmentId: Type.String() }),
        response: { 404: ErrorSchema },
      },
      preHandler: [requireSelfOrPermission('adjustment:read:own', 'adjustment:read:all')],
    },
    async (request, reply) => {
      const { personId, adjustmentId } = request.params as { personId: string; adjustmentId: string };
      const doc = await fastify.adjustmentService.getOutcomeDocument(
        adjustmentId, personId, request.tenantId, request.user.sub,
      );
      await reply
        .header('content-type', doc.mimeType)
        .header('content-disposition', `attachment; filename="${doc.filename}"`)
        .send(doc.content);
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
    requestPublishedAt: distribution.requestPublishedAt?.toISOString() ?? null,
    withdrawalRequestedAt: distribution.withdrawalRequestedAt?.toISOString() ?? null,
    withdrawalPublishedAt: distribution.withdrawalPublishedAt?.toISOString() ?? null,
    withdrawnAt: distribution.withdrawnAt?.toISOString() ?? null,
    createdAt: distribution.createdAt.toISOString(),
    updatedAt: distribution.updatedAt.toISOString(),
  };
}

function taskToWire(task: AdjustmentTaskDto) {
  return {
    ...task,
    validFrom: task.validFrom.toISOString(),
    validTo: task.validTo?.toISOString() ?? null,
    dueSince: task.dueSince.toISOString(),
  };
}

function targetConfigToWire(config: TargetConfigDto) {
  return {
    ...config,
    updatedAt: config.updatedAt?.toISOString() ?? null,
    lastOverdueNoticeAt: config.lastOverdueNoticeAt?.toISOString() ?? null,
  };
}
