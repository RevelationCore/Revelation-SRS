import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

import type {
  CreateEnrolmentInput,
  DownstreamTriggerDto,
  EnrolmentDto,
  EnrolmentHistoryDto,
  EnrolmentStatusCode,
  EnrolmentTransitionDto,
  FeeLiabilityDto,
} from '../platform/enrolment/service.js';
import { transitionAuditValue } from '../platform/workflow/transition-service.js';
import { clockNow } from '../platform/clock.js';

const EnrolmentSchema = Type.Object({
  enrolmentId:         Type.String(),
  personId:            Type.String(),
  programmeId:         Type.Union([Type.String(), Type.Null()]),
  statusCode:          Type.String(),
  modeOfStudyCode:     Type.String(),
  attendanceTypeCode:  Type.Union([Type.String(), Type.Null()]),
  academicYearOfEntry: Type.String(),
  startDate:           Type.Union([Type.String(), Type.Null()]),
  expectedEndDate:     Type.Union([Type.String(), Type.Null()]),
  actualEndDate:       Type.Union([Type.String(), Type.Null()]),
  feeBandCode:         Type.Union([Type.String(), Type.Null()]),
  fundingSourceCode:   Type.Union([Type.String(), Type.Null()]),
  slcReference:        Type.Union([Type.String(), Type.Null()]),
  ucasPersonalId:      Type.Union([Type.String(), Type.Null()]),
  validFrom:           Type.String(),
  recordedAt:          Type.String(),
});

const EnrolmentHistorySchema = Type.Intersect([
  EnrolmentSchema,
  Type.Object({
    validTo:       Type.Union([Type.String(), Type.Null()]),
    recordedUntil: Type.Union([Type.String(), Type.Null()]),
  }),
]);

const EnrolmentTransitionSchema = Type.Object({
  transitionId:   Type.String(),
  enrolmentId:    Type.String(),
  fromStatusCode: Type.String(),
  toStatusCode:   Type.String(),
  reasonCode:     Type.Union([Type.String(), Type.Null()]),
  reasonText:     Type.Union([Type.String(), Type.Null()]),
  effectiveAt:    Type.String(),
  actorId:        Type.String(),
  createdAt:      Type.String(),
});

const FeeLiabilitySchema = Type.Object({
  feeLiabilityId:   Type.String(),
  enrolmentId:      Type.String(),
  personId:         Type.String(),
  academicYear:     Type.String(),
  feeBandCode:      Type.Union([Type.String(), Type.Null()]),
  fundingSourceCode: Type.Union([Type.String(), Type.Null()]),
  statusCode:       Type.String(),
  generatedAt:      Type.String(),
});

const DownstreamTriggerSchema = Type.Object({
  triggerId:       Type.String(),
  enrolmentId:     Type.String(),
  triggerTypeCode: Type.String(),
  statusCode:      Type.String(),
  payloadSummary:  Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  correlationId:   Type.Union([Type.String(), Type.Null()]),
  createdAt:       Type.String(),
  sentAt:          Type.Union([Type.String(), Type.Null()]),
});

const ErrorSchema = Type.Object({
  type:   Type.String(),
  title:  Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const StatusTransitionBody = Type.Object({
  validFrom:   Type.Optional(Type.String({ format: 'date-time' })),
  reasonCode:  Type.Optional(Type.String()),
  reasonText:  Type.Optional(Type.String()),
});

/**
 * Enrolment lifecycle REST endpoints.
 *
 * GET  /enrolments                   - list enrolments
 * POST /enrolments                   - create enrolment
 * GET  /enrolments/:id               - get enrolment
 * GET  /enrolments/:id/history       - bitemporal row history
 * GET  /enrolments/:id/transitions   - status transition command ledger
 * GET  /enrolments/:id/fee-liabilities - fee liability ledger
 * GET  /enrolments/:id/downstream-triggers - UCAS/SLC/UKVI trigger ledger
 * POST /enrolments/:id/intermit      - transition to intermitting
 * POST /enrolments/:id/withdraw      - transition to withdrawn
 * POST /enrolments/:id/graduate      - transition to graduated
 * POST /enrolments/:id/reinstate     - transition back to enrolled
 */
export function enrolmentRoutes(fastify: FastifyInstance): void {

  // ── List enrolments ─────────────────────────────────────────────────────────
  fastify.get(
    '/enrolments',
    {
      schema: {
        querystring: Type.Object({
          statusCode: Type.Optional(Type.String()),
          limit:      Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
          offset:     Type.Optional(Type.Integer({ minimum: 0 })),
        }),
        response: { 200: Type.Array(EnrolmentSchema) },
      },
      preHandler: [requirePermission('enrolment:read:all')],
    },
    async (request, reply) => {
      const q = request.query as { statusCode?: string; limit?: number; offset?: number };
      const opts: { statusCode?: string; limit?: number; offset?: number } = {};
      if (q.statusCode !== undefined) opts.statusCode = q.statusCode;
      if (q.limit     !== undefined) opts.limit      = q.limit;
      if (q.offset    !== undefined) opts.offset     = q.offset;
      const results = await fastify.enrolmentService.listEnrolments(request.tenantId, opts);
      await reply.send(results.map(enrolmentToWire));
    },
  );

  // ── Create enrolment ────────────────────────────────────────────────────────
  fastify.post(
    '/enrolments',
    {
      schema: {
        body: Type.Object({
          personId:            Type.String({ minLength: 36, maxLength: 36 }),
          programmeId:         Type.Optional(Type.String()),
          modeOfStudyCode:     Type.String({ minLength: 1 }),
          attendanceTypeCode:  Type.Optional(Type.String()),
          academicYearOfEntry: Type.String({ minLength: 1 }),
          startDate:           Type.String(),
          expectedEndDate:     Type.Optional(Type.String()),
          feeBandCode:         Type.Optional(Type.String()),
          fundingSourceCode:   Type.Optional(Type.String()),
          slcReference:        Type.Optional(Type.String()),
          ucasPersonalId:      Type.Optional(Type.String()),
          ukviCasRequired:     Type.Optional(Type.Boolean()),
        }),
        response: {
          201: Type.Object({ enrolmentId: Type.String() }),
          404: ErrorSchema,
          422: ErrorSchema,
        },
      },
      preHandler: [requirePermission('enrolment:write')],
    },
    async (request, reply) => {
      const body = request.body as CreateEnrolmentInput;
      const enrolmentId = await fastify.enrolmentService.createEnrolment(
        request.tenantId,
        body,
        request.user.sub,
      );

      await fastify.audit.record({
        tenantId:        request.tenantId,
        entityType:      'enrolment',
        entityId:        enrolmentId,
        actionType:      'create',
        actorType:       'user',
        actorId:         request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:   request.id,
      });

      await reply.code(201).send({ enrolmentId });
    },
  );

  fastify.get(
    '/enrolments/:enrolmentId/history',
    {
      schema: {
        params: Type.Object({ enrolmentId: Type.String() }),
        response: { 200: Type.Array(EnrolmentHistorySchema), 404: ErrorSchema },
      },
      preHandler: [requirePermission('enrolment:read:all')],
    },
    async (request, reply) => {
      const { enrolmentId } = request.params as { enrolmentId: string };
      if (!await fastify.enrolmentService.getEnrolment(enrolmentId, request.tenantId)) {
        return reply.code(404).send(notFound('Enrolment', enrolmentId));
      }
      const history = await fastify.enrolmentService.getEnrolmentHistory(enrolmentId, request.tenantId);
      await reply.send(history.map(enrolmentHistoryToWire));
    },
  );

  fastify.get(
    '/enrolments/:enrolmentId/transitions',
    {
      schema: {
        params: Type.Object({ enrolmentId: Type.String() }),
        response: { 200: Type.Array(EnrolmentTransitionSchema), 404: ErrorSchema },
      },
      preHandler: [requirePermission('enrolment:read:all')],
    },
    async (request, reply) => {
      const { enrolmentId } = request.params as { enrolmentId: string };
      if (!await fastify.enrolmentService.getEnrolment(enrolmentId, request.tenantId)) {
        return reply.code(404).send(notFound('Enrolment', enrolmentId));
      }
      const transitions = await fastify.enrolmentService.listStatusTransitions(enrolmentId, request.tenantId);
      await reply.send(transitions.map(enrolmentTransitionToWire));
    },
  );

  fastify.get(
    '/enrolments/:enrolmentId/fee-liabilities',
    {
      schema: {
        params: Type.Object({ enrolmentId: Type.String() }),
        response: { 200: Type.Array(FeeLiabilitySchema), 404: ErrorSchema },
      },
      preHandler: [requirePermission('enrolment:read:all')],
    },
    async (request, reply) => {
      const { enrolmentId } = request.params as { enrolmentId: string };
      if (!await fastify.enrolmentService.getEnrolment(enrolmentId, request.tenantId)) {
        return reply.code(404).send(notFound('Enrolment', enrolmentId));
      }
      const fees = await fastify.enrolmentService.listFeeLiabilities(enrolmentId, request.tenantId);
      await reply.send(fees.map(feeLiabilityToWire));
    },
  );

  fastify.get(
    '/enrolments/:enrolmentId/downstream-triggers',
    {
      schema: {
        params: Type.Object({ enrolmentId: Type.String() }),
        response: { 200: Type.Array(DownstreamTriggerSchema), 404: ErrorSchema },
      },
      preHandler: [requirePermission('enrolment:read:all')],
    },
    async (request, reply) => {
      const { enrolmentId } = request.params as { enrolmentId: string };
      if (!await fastify.enrolmentService.getEnrolment(enrolmentId, request.tenantId)) {
        return reply.code(404).send(notFound('Enrolment', enrolmentId));
      }
      const triggers = await fastify.enrolmentService.listDownstreamTriggers(enrolmentId, request.tenantId);
      await reply.send(triggers.map(downstreamTriggerToWire));
    },
  );

  // ── Get enrolment ────────────────────────────────────────────────────────────
  fastify.get(
    '/enrolments/:enrolmentId',
    {
      schema: {
        params: Type.Object({ enrolmentId: Type.String() }),
        response: { 200: EnrolmentSchema, 404: ErrorSchema },
      },
      preHandler: [requirePermission('enrolment:read:all')],
    },
    async (request, reply) => {
      const { enrolmentId } = request.params as { enrolmentId: string };
      const enrolment = await fastify.enrolmentService.getEnrolment(
        enrolmentId,
        request.tenantId,
      );

      if (!enrolment) {
        return reply.code(404).send({
          type:   'https://srs.example.com/errors/not-found',
          title:  'Not Found',
          status: 404,
          detail: `Enrolment '${enrolmentId}' not found`,
        });
      }

      await reply.send(enrolmentToWire(enrolment));
    },
  );

  // ── Status transition helper ─────────────────────────────────────────────────
  function makeTransitionRoute(newStatus: EnrolmentStatusCode): void {
    const pathByStatus: Record<EnrolmentStatusCode, string> = {
      enrolled:     'reinstate',
      intermitting: 'intermit',
      withdrawn:    'withdraw',
      suspended:    'suspend',
      graduated:    'graduate',
    };
    const path = pathByStatus[newStatus];
    fastify.post(
      `/enrolments/:enrolmentId/${path}`,
      {
        schema: {
          params: Type.Object({ enrolmentId: Type.String() }),
          body:   StatusTransitionBody,
          response: { 204: Type.Null(), 404: ErrorSchema, 422: ErrorSchema },
        },
        preHandler: [requirePermission('enrolment:write')],
      },
      async (request, reply) => {
        const { enrolmentId } = request.params as { enrolmentId: string };
        const body = request.body as { validFrom?: string; reasonCode?: string; reasonText?: string };
        const transitionOptions: { reasonCode?: string; reasonText?: string } = {};
        if (body.reasonCode !== undefined) transitionOptions.reasonCode = body.reasonCode;
        if (body.reasonText !== undefined) transitionOptions.reasonText = body.reasonText;

        const transitionDecision = await fastify.enrolmentService.transitionStatus(
          enrolmentId,
          request.tenantId,
          newStatus,
          body.validFrom ? new Date(body.validFrom) : clockNow(),
          request.user.sub,
          transitionOptions,
        );

        await fastify.audit.record({
          tenantId:         request.tenantId,
          entityType:       'enrolment',
          entityId:         enrolmentId,
          fieldName:        'status_code',
          afterValue:       transitionAuditValue(transitionDecision, {
            reasonCode: body.reasonCode,
            reasonText: body.reasonText,
          }),
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

  makeTransitionRoute('intermitting');
  makeTransitionRoute('suspended');
  makeTransitionRoute('withdrawn');
  makeTransitionRoute('graduated');
  makeTransitionRoute('enrolled');  // reinstate
}

function enrolmentToWire(e: EnrolmentDto) {
  return {
    ...e,
    validFrom:  e.validFrom.toISOString(),
    recordedAt: e.recordedAt.toISOString(),
  };
}

function enrolmentHistoryToWire(e: EnrolmentHistoryDto) {
  return {
    ...enrolmentToWire(e),
    validTo:       e.validTo?.toISOString() ?? null,
    recordedUntil: e.recordedUntil?.toISOString() ?? null,
  };
}

function enrolmentTransitionToWire(t: EnrolmentTransitionDto) {
  return {
    ...t,
    effectiveAt: t.effectiveAt.toISOString(),
    createdAt:   t.createdAt.toISOString(),
  };
}

function feeLiabilityToWire(f: FeeLiabilityDto) {
  return {
    ...f,
    generatedAt: f.generatedAt.toISOString(),
  };
}

function downstreamTriggerToWire(t: DownstreamTriggerDto) {
  return {
    ...t,
    createdAt: t.createdAt.toISOString(),
    sentAt:    t.sentAt?.toISOString() ?? null,
  };
}

function notFound(entity: string, id: string) {
  return {
    type:   'https://srs.example.com/errors/not-found',
    title:  'Not Found',
    status: 404,
    detail: `${entity} '${id}' not found`,
  };
}
