import { Type } from '@sinclair/typebox';
import { requireAnyPermission, requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

import type { ProposalDecisionCode } from '../platform/adjustments/adjustment-proposal-service.js';
import type { AdjustmentWithdrawalDto, ProposeWithdrawalInput } from '../platform/adjustments/adjustment-withdrawal-service.js';

import { refuseUnknownFields } from './adjustment-proposals.js';

const ErrorSchema = Type.Object({ type: Type.String(), title: Type.String(), status: Type.Number(), detail: Type.Optional(Type.String()) });

const ProposeBody = Type.Object({
  withdrawalReasonCode: Type.String({ minLength: 1 }),
  externalReference: Type.String({ minLength: 1, maxLength: 100, description: 'Where the evidence is held, e.g. the student\'s written request or the review record. An identifier, never narrative.' }),
  replacementAdjustmentId: Type.Optional(Type.String({ format: 'uuid' })),
}, { additionalProperties: false });

const DecisionBody = Type.Object({
  decisionCode: Type.Union([Type.Literal('approved'), Type.Literal('rejected')]),
  reason: Type.Optional(Type.String({ maxLength: 500 })),
}, { additionalProperties: false });

const WithdrawalSchema = Type.Object({
  withdrawalId: Type.String(),
  adjustmentId: Type.String(),
  personId: Type.String(),
  withdrawalReasonCode: Type.String(),
  externalReference: Type.String(),
  replacementAdjustmentId: Type.Union([Type.String(), Type.Null()]),
  statusCode: Type.String(),
  proposedBy: Type.String(),
  proposedAt: Type.String(),
  workflowInstanceId: Type.Union([Type.String(), Type.Null()]),
  decidedBy: Type.Union([Type.String(), Type.Null()]),
  decidedAt: Type.Union([Type.String(), Type.Null()]),
  decisionReason: Type.Union([Type.String(), Type.Null()]),
  withdrawnAt: Type.Union([Type.String(), Type.Null()]),
});

const DecisionResponse = Type.Object({
  withdrawalId: Type.String(),
  statusCode: Type.String(),
  adjustmentId: Type.String(),
  withdrawnAt: Type.Union([Type.String(), Type.Null()]),
  decisionStatus: Type.Union([Type.Literal('applied'), Type.Literal('pending')]),
});

function toWire(w: AdjustmentWithdrawalDto) {
  return { ...w, proposedAt: w.proposedAt.toISOString(), decidedAt: w.decidedAt?.toISOString() ?? null, withdrawnAt: w.withdrawnAt?.toISOString() ?? null };
}

/** ADR-034 items 5 and 8 (BL-408): withdrawal proposals and their decision. */
export function adjustmentWithdrawalRoutes(fastify: FastifyInstance): void {
  fastify.post(
    '/students/:personId/adjustments/:adjustmentId/withdrawal-proposals',
    {
      schema: {
        params: Type.Object({ personId: Type.String({ format: 'uuid' }), adjustmentId: Type.String({ format: 'uuid' }) }),
        body: ProposeBody,
        response: { 201: Type.Object({ withdrawalId: Type.String(), statusCode: Type.String() }), 400: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('adjustment:propose-withdrawal')],
      preValidation: refuseUnknownFields(Object.keys(ProposeBody.properties)),
    },
    async (request, reply) => {
      const { personId, adjustmentId } = request.params as { personId: string; adjustmentId: string };
      const w = await fastify.adjustmentWithdrawalService.propose(request.tenantId, personId, adjustmentId, request.body as ProposeWithdrawalInput,
        { sub: request.user.sub, srsPersonId: request.user.srsPersonId });
      await fastify.audit.record({
        tenantId: request.tenantId, entityType: 'adjustment_withdrawal', entityId: w.withdrawalId, actionType: 'create', actorType: 'user',
        actorId: request.user.sub, actorDisplayName: request.user.displayName, correlationId: request.id, reasonText: w.withdrawalReasonCode,
      });
      await reply.code(201).send({ withdrawalId: w.withdrawalId, statusCode: w.statusCode });
    },
  );

  fastify.get(
    '/adjustment-withdrawals',
    {
      schema: {
        querystring: Type.Object({
          statusCode: Type.Optional(Type.String()),
          personId: Type.Optional(Type.String({ format: 'uuid' })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
          offset: Type.Optional(Type.Integer({ minimum: 0 })),
        }),
        response: { 200: Type.Array(WithdrawalSchema) },
      },
      preHandler: [requireAnyPermission('adjustment:propose-withdrawal', 'adjustment:approve-withdrawal')],
    },
    async (request, reply) => {
      const q = request.query as { statusCode?: string; personId?: string; limit?: number; offset?: number };
      await reply.send((await fastify.adjustmentWithdrawalService.list(request.tenantId, q)).map(toWire));
    },
  );

  fastify.get(
    '/adjustment-withdrawals/:withdrawalId',
    {
      schema: { params: Type.Object({ withdrawalId: Type.String({ format: 'uuid' }) }), response: { 200: WithdrawalSchema, 404: ErrorSchema } },
      preHandler: [requireAnyPermission('adjustment:propose-withdrawal', 'adjustment:approve-withdrawal')],
    },
    async (request, reply) => {
      const { withdrawalId } = request.params as { withdrawalId: string };
      await reply.send(toWire(await fastify.adjustmentWithdrawalService.get(request.tenantId, withdrawalId)));
    },
  );

  fastify.post(
    '/adjustment-withdrawals/:withdrawalId/decision',
    {
      schema: {
        params: Type.Object({ withdrawalId: Type.String({ format: 'uuid' }) }),
        body: DecisionBody,
        response: { 200: DecisionResponse, 202: DecisionResponse, 400: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('adjustment:approve-withdrawal')],
      preValidation: refuseUnknownFields(Object.keys(DecisionBody.properties)),
    },
    async (request, reply) => {
      const { withdrawalId } = request.params as { withdrawalId: string };
      const { decisionCode, reason } = request.body as { decisionCode: ProposalDecisionCode; reason?: string };
      const decided = await fastify.adjustmentWithdrawalService.decide(request.tenantId, withdrawalId, decisionCode,
        { sub: request.user.sub, srsPersonId: request.user.srsPersonId }, reason);
      // The adjustment's own audit row is written by the withdrawal itself.
      await fastify.audit.record({
        tenantId: request.tenantId, entityType: 'adjustment_withdrawal', entityId: withdrawalId, actionType: 'update', actorType: 'user',
        actorId: request.user.sub, actorDisplayName: request.user.displayName, correlationId: request.id, reasonText: decisionCode,
      });
      await reply.code(decided.decisionStatus === 'pending' ? 202 : 200).send({
        withdrawalId, statusCode: decided.statusCode, adjustmentId: decided.adjustmentId,
        withdrawnAt: decided.withdrawnAt?.toISOString() ?? null, decisionStatus: decided.decisionStatus,
      });
    },
  );
}
