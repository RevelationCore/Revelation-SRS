import { requirePermission } from '@revelation-srs/auth';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import type {
  AddActionInput, RecordContactInput, ReviewCaseInput, TriageAlertInput,
} from '../services/engagement-intervention-service.js';

const ErrorSchema = Type.Object({
  type: Type.String(), title: Type.String(), status: Type.Number(),
  detail: Type.Optional(Type.String()), correlationId: Type.Optional(Type.String()),
});
const Headers = Type.Object({ 'idempotency-key': Type.String({ minLength: 1, maxLength: 200 }) });
const MutationResult = Type.Object({
  created: Type.Boolean(),
}, { additionalProperties: true });

export function engagementInterventionRoutes(fastify: FastifyInstance): void {
  fastify.post('/engagement/alerts/:alertId/triage', {
    schema: {
      params: Type.Object({ alertId: Type.String({ format: 'uuid' }) }), headers: Headers,
      body: Type.Object({
        decision: Type.Union([Type.Literal('no-action'), Type.Literal('open-intervention')]),
        assignedRoleCode: Type.Optional(Type.String({ minLength: 1 })),
        assignedActorId: Type.Optional(Type.String({ minLength: 1 })),
        dueAt: Type.Optional(Type.String({ format: 'date-time' })),
        reasonCode: Type.String({ minLength: 1 }),
      }),
      response: { 200: MutationResult, 201: MutationResult, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('engagement:case:manage')],
  }, async (request, reply) => {
    const { alertId } = request.params as { alertId: string };
    const result = await fastify.engagementInterventionService.triage(
      alertId, request.tenantId, request.body as TriageAlertInput,
      String(request.headers['idempotency-key'] ?? ''), request.user.sub, request.id,
    );
    await reply.code(result.created ? 201 : 200).send(result);
  });

  fastify.get('/engagement/cases/:caseId', {
    schema: {
      params: Type.Object({ caseId: Type.String({ format: 'uuid' }) }),
      response: { 200: Type.Object({
        intervention: Type.Record(Type.String(), Type.Unknown()),
        contacts: Type.Array(Type.Record(Type.String(), Type.Unknown())),
        actions: Type.Array(Type.Record(Type.String(), Type.Unknown())),
        referrals: Type.Array(Type.Record(Type.String(), Type.Unknown())),
      }), 404: ErrorSchema },
    },
    preHandler: [requirePermission('engagement:case:read')],
  }, async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    await reply.send(await fastify.engagementInterventionService.getCase(caseId, request.tenantId));
  });

  fastify.post('/engagement/cases/:caseId/contacts', {
    schema: {
      params: Type.Object({ caseId: Type.String({ format: 'uuid' }) }), headers: Headers,
      body: Type.Object({
        channelCode: Type.Union([
          Type.Literal('email'), Type.Literal('telephone'), Type.Literal('sms'),
          Type.Literal('portal'), Type.Literal('in-person'), Type.Literal('letter'),
        ]),
        attemptedAt: Type.String({ format: 'date-time' }),
        outcomeCode: Type.Union([
          Type.Literal('no-response'), Type.Literal('contacted'),
          Type.Literal('response-received'), Type.Literal('wrong-contact-details'),
        ]),
        communicationLocale: Type.Optional(Type.String({ minLength: 2, maxLength: 20 })),
        operationalNote: Type.Optional(Type.String({ maxLength: 500 })),
      }),
      response: { 200: MutationResult, 201: MutationResult, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('engagement:case:manage')],
  }, async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const result = await fastify.engagementInterventionService.recordContact(
      caseId, request.tenantId, request.body as RecordContactInput,
      String(request.headers['idempotency-key'] ?? ''), request.user.sub,
    );
    await reply.code(result.created ? 201 : 200).send(result);
  });

  fastify.post('/engagement/cases/:caseId/actions', {
    schema: {
      params: Type.Object({ caseId: Type.String({ format: 'uuid' }) }), headers: Headers,
      body: Type.Object({
        actionTypeCode: Type.String({ minLength: 1 }),
        operationalInstruction: Type.Optional(Type.String({ maxLength: 500 })),
        ownerRoleCode: Type.Optional(Type.String()), ownerActorId: Type.Optional(Type.String()),
        dueAt: Type.Optional(Type.String({ format: 'date-time' })),
      }),
      response: { 200: MutationResult, 201: MutationResult, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('engagement:case:manage')],
  }, async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const result = await fastify.engagementInterventionService.addAction(
      caseId, request.tenantId, request.body as AddActionInput,
      String(request.headers['idempotency-key'] ?? ''), request.user.sub,
    );
    await reply.code(result.created ? 201 : 200).send(result);
  });

  fastify.post('/engagement/cases/:caseId/review', {
    schema: {
      params: Type.Object({ caseId: Type.String({ format: 'uuid' }) }), headers: Headers,
      body: Type.Object({
        expectedVersionId: Type.String({ format: 'uuid' }),
        decision: Type.Union([Type.Literal('continue'), Type.Literal('close'), Type.Literal('refer')]),
        outcomeCode: Type.Optional(Type.String()), reviewAt: Type.String({ format: 'date-time' }),
        nextDueAt: Type.Optional(Type.String({ format: 'date-time' })),
        referral: Type.Optional(Type.Object({
          targetServiceCode: Type.Union([
            Type.Literal('wellbeing'), Type.Literal('safeguarding'),
            Type.Literal('academic-status-review'), Type.Literal('sponsor-compliance-review'),
          ]),
          referralTypeCode: Type.Union([
            Type.Literal('support-request'), Type.Literal('immediate-risk'),
            Type.Literal('status-review'), Type.Literal('compliance-review'),
          ]),
          externalReference: Type.Optional(Type.String({ maxLength: 200 })),
        })),
      }),
      response: { 200: MutationResult, 201: MutationResult, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('engagement:case:refer')],
  }, async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const result = await fastify.engagementInterventionService.review(
      caseId, request.tenantId, request.body as ReviewCaseInput,
      String(request.headers['idempotency-key'] ?? ''), request.user.sub, request.id,
    );
    await reply.code(result.created ? 201 : 200).send(result);
  });
}

declare module 'fastify' {
  interface FastifyInstance {
    engagementInterventionService: import('../services/engagement-intervention-service.js').EngagementInterventionService;
  }
}
