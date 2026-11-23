import { Type } from '@sinclair/typebox';
import { requireAnyPermission, requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type {
  AdjustmentProposalDto,
  ProposalDecisionCode,
  ProposeAdjustmentInput,
} from '../platform/adjustments/adjustment-proposal-service.js';

const ErrorSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const AmountSchema = Type.Object({
  value: Type.Number({ exclusiveMinimum: 0, maximum: 999999.99 }),
  unitCode: Type.String({ minLength: 1 }),
});

const ProposeBody = Type.Object({
  enrolmentId: Type.String({ format: 'uuid' }),
  adjustmentTypeCode: Type.String({ minLength: 1 }),
  scopeCode: Type.String({ minLength: 1 }),
  validFrom: Type.String({ format: 'date-time' }),
  validTo: Type.Optional(Type.String({ format: 'date-time' })),
  amount: Type.Optional(AmountSchema),
  manualReasonCode: Type.String({ minLength: 1 }),
  externalReference: Type.String({ minLength: 1, maxLength: 100, description: 'Where the decision is held, e.g. the disability service case number. An identifier, never narrative.' }),
}, { additionalProperties: false });

const DecisionBody = Type.Object({
  decisionCode: Type.Union([Type.Literal('approved'), Type.Literal('rejected')]),
  reason: Type.Optional(Type.String({ maxLength: 500 })),
}, { additionalProperties: false });

const ProposalSchema = Type.Object({
  proposalId: Type.String(),
  personId: Type.String(),
  enrolmentId: Type.String(),
  adjustmentTypeCode: Type.String(),
  scopeCode: Type.String(),
  amount: Type.Union([AmountSchema, Type.Null()]),
  validFrom: Type.String(),
  validTo: Type.Union([Type.String(), Type.Null()]),
  manualReasonCode: Type.String(),
  externalReference: Type.String(),
  statusCode: Type.String(),
  proposedBy: Type.String(),
  proposedAt: Type.String(),
  workflowInstanceId: Type.Union([Type.String(), Type.Null()]),
  decidedBy: Type.Union([Type.String(), Type.Null()]),
  decidedAt: Type.Union([Type.String(), Type.Null()]),
  decisionReason: Type.Union([Type.String(), Type.Null()]),
  adjustmentId: Type.Union([Type.String(), Type.Null()]),
});

const DecisionResponse = Type.Object({
  proposalId: Type.String(),
  statusCode: Type.String(),
  adjustmentId: Type.Union([Type.String(), Type.Null()]),
  decisionStatus: Type.Union([Type.Literal('applied'), Type.Literal('pending')]),
});

/**
 * The app strips unknown body fields before validation, which would turn a
 * caller's notes or sourceCaseId into silence. Refuse them instead (ADR-033:
 * no free text reaches core, and a proposal has no case).
 */
export function refuseUnknownFields(allowed: readonly string[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const raw = request.body;
    if (!raw || typeof raw !== 'object') return;
    const unknown = Object.keys(raw).filter((k) => !allowed.includes(k));
    if (unknown.length === 0) return;
    await reply.code(400).type('application/problem+json').send({
      type: 'https://srs.example.com/errors/bad-request', title: 'Bad request', status: 400,
      detail: `Not accepted: ${unknown.join(', ')}. A manual adjustment carries coded values, dates, a reason code and an external reference only`,
      instance: request.url,
    });
  };
}

function proposalToWire(p: AdjustmentProposalDto) {
  return {
    ...p,
    validFrom: p.validFrom.toISOString(),
    validTo: p.validTo?.toISOString() ?? null,
    proposedAt: p.proposedAt.toISOString(),
    decidedAt: p.decidedAt?.toISOString() ?? null,
  };
}

/** ADR-033 item 5: manual adjustment proposals and their decision (BL-378), and migration batch release (BL-379). */
export function adjustmentProposalRoutes(fastify: FastifyInstance): void {
  fastify.post(
    '/students/:personId/adjustment-proposals',
    {
      schema: {
        params: Type.Object({ personId: Type.String({ format: 'uuid' }) }),
        body: ProposeBody,
        response: { 201: Type.Object({ proposalId: Type.String(), statusCode: Type.String() }), 400: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('adjustment:propose')],
      preValidation: refuseUnknownFields(Object.keys(ProposeBody.properties)),
    },
    async (request, reply) => {
      const { personId } = request.params as { personId: string };
      const proposal = await fastify.adjustmentProposalService.propose(
        request.tenantId, personId, request.body as ProposeAdjustmentInput,
        { sub: request.user.sub, srsPersonId: request.user.srsPersonId },
      );
      await fastify.audit.record({
        tenantId: request.tenantId, entityType: 'adjustment_proposal', entityId: proposal.proposalId, actionType: 'create', actorType: 'user',
        actorId: request.user.sub, actorDisplayName: request.user.displayName, correlationId: request.id,
        reasonText: `Manual adjustment proposed (${proposal.manualReasonCode})`,
      });
      await reply.code(201).send({ proposalId: proposal.proposalId, statusCode: proposal.statusCode });
    },
  );

  fastify.get(
    '/adjustment-proposals',
    {
      schema: {
        querystring: Type.Object({
          statusCode: Type.Optional(Type.String()),
          personId: Type.Optional(Type.String({ format: 'uuid' })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
          offset: Type.Optional(Type.Integer({ minimum: 0 })),
        }),
        response: { 200: Type.Array(ProposalSchema) },
      },
      preHandler: [requireAnyPermission('adjustment:propose', 'adjustment:approve-manual')],
    },
    async (request, reply) => {
      const q = request.query as { statusCode?: string; personId?: string; limit?: number; offset?: number };
      await reply.send((await fastify.adjustmentProposalService.list(request.tenantId, q)).map(proposalToWire));
    },
  );

  fastify.get(
    '/adjustment-proposals/:proposalId',
    {
      schema: {
        params: Type.Object({ proposalId: Type.String({ format: 'uuid' }) }),
        response: { 200: ProposalSchema, 404: ErrorSchema },
      },
      preHandler: [requireAnyPermission('adjustment:propose', 'adjustment:approve-manual')],
    },
    async (request, reply) => {
      const { proposalId } = request.params as { proposalId: string };
      await reply.send(proposalToWire(await fastify.adjustmentProposalService.get(request.tenantId, proposalId)));
    },
  );

  fastify.post(
    '/adjustment-proposals/:proposalId/decision',
    {
      schema: {
        params: Type.Object({ proposalId: Type.String({ format: 'uuid' }) }),
        body: DecisionBody,
        response: { 200: DecisionResponse, 202: DecisionResponse, 400: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('adjustment:approve-manual')],
      preValidation: refuseUnknownFields(Object.keys(DecisionBody.properties)),
    },
    async (request, reply) => {
      const { proposalId } = request.params as { proposalId: string };
      const { decisionCode, reason } = request.body as { decisionCode: ProposalDecisionCode; reason?: string };
      const decided = await fastify.adjustmentProposalService.decide(
        request.tenantId, proposalId, decisionCode, { sub: request.user.sub, srsPersonId: request.user.srsPersonId }, reason,
      );
      const audit = { tenantId: request.tenantId, actorType: 'user' as const, actorId: request.user.sub, actorDisplayName: request.user.displayName, correlationId: request.id };
      await fastify.audit.record({ ...audit, entityType: 'adjustment_proposal', entityId: proposalId, actionType: 'update', reasonText: decisionCode });
      if (decided.adjustmentId) {
        await fastify.audit.record({
          ...audit, entityType: 'reasonable_adjustment', entityId: decided.adjustmentId, actionType: 'create',
          reasonText: `Manual adjustment approved (proposal ${proposalId})`,
        });
      }
      await reply.code(decided.decisionStatus === 'pending' ? 202 : 200).send({
        proposalId, statusCode: decided.statusCode, adjustmentId: decided.adjustmentId, decisionStatus: decided.decisionStatus,
      });
    },
  );

  // ── Migration batches (ADR-033 item 7, SME-8, BL-379) ────────────────────

  const BatchSummary = Type.Object({
    batchId: Type.String(), total: Type.Integer(), current: Type.Integer(),
    released: Type.Integer(), unreleased: Type.Integer(), ended: Type.Integer(),
  });
  const ReleaseBody = Type.Object({
    expectedCount: Type.Integer({ minimum: 0, description: 'The number of current adjustments the legacy report shows for this batch' }),
    reconciliationReference: Type.String({ minLength: 1, maxLength: 100, description: 'The reference of the legacy report the count was checked against. An identifier, never narrative.' }),
  }, { additionalProperties: false });

  fastify.get(
    '/adjustment-migration-batches/:batchId',
    {
      schema: { params: Type.Object({ batchId: Type.String({ format: 'uuid' }) }), response: { 200: BatchSummary, 404: ErrorSchema } },
      preHandler: [requirePermission('adjustment:release-migrated')],
    },
    async (request, reply) => {
      const { batchId } = request.params as { batchId: string };
      await reply.send(await fastify.adjustmentService.summariseMigrationBatch(request.tenantId, batchId));
    },
  );

  fastify.post(
    '/adjustment-migration-batches/:batchId/release',
    {
      schema: {
        params: Type.Object({ batchId: Type.String({ format: 'uuid' }) }),
        body: ReleaseBody,
        response: {
          200: Type.Object({ released: Type.Integer(), alreadyReleased: Type.Integer(), ended: Type.Integer() }),
          400: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema,
        },
      },
      preHandler: [requirePermission('adjustment:release-migrated')],
      preValidation: refuseUnknownFields(Object.keys(ReleaseBody.properties)),
    },
    async (request, reply) => {
      const { batchId } = request.params as { batchId: string };
      const body = request.body as { expectedCount: number; reconciliationReference: string };
      const result = await fastify.adjustmentService.releaseMigrationBatch(request.tenantId, batchId, body, request.user.sub);
      if (result.released > 0) {
        try {
          await fastify.examEntryService.applyExamAdditions(request.tenantId);
        } catch (err) {
          request.log.warn({ err, batchId }, 'Exam entry refresh deferred to the reconcile loop');
        }
      }
      await fastify.audit.record({
        tenantId: request.tenantId, entityType: 'adjustment_migration_batch', entityId: batchId, actionType: 'update', actorType: 'user',
        actorId: request.user.sub, actorDisplayName: request.user.displayName, correlationId: request.id,
        reasonText: `Released ${result.released} migrated adjustments (${result.alreadyReleased} already released, ${result.ended} ended); expected ${body.expectedCount}, reconciled against ${body.reconciliationReference.trim()}`,
      });
      await reply.send(result);
    },
  );
}
