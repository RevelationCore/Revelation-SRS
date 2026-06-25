import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

import type {
  ApplyAmendmentInput,
  CorrectionCaseDto,
  OpenCaseInput,
  CaseStatusCode,
} from '../platform/governance/correction-service.js';
import { transitionAuditValue } from '../platform/workflow/transition-service.js';

const ErrorSchema = Type.Object({
  type:    Type.String(),
  title:   Type.String(),
  status:  Type.Number(),
  detail:  Type.Optional(Type.String()),
});

const CorrectionCaseSchema = Type.Object({
  caseId:       Type.String(),
  enrolmentId:  Type.String(),
  caseTypeCode: Type.String(),
  statusCode:   Type.String(),
  reference:    Type.Union([Type.String(), Type.Null()]),
  actorId:      Type.String(),
  validFrom:    Type.String(),
  validTo:      Type.Union([Type.String(), Type.Null()]),
  recordedAt:   Type.String(),
  recordedUntil: Type.Union([Type.String(), Type.Null()]),
});

const OpenCaseBody = Type.Object({
  caseTypeCode: Type.Union([Type.Literal('appeal'), Type.Literal('administrative-correction')]),
  reference:    Type.Optional(Type.String()),
});

const AdvanceStatusBody = Type.Object({
  statusCode: Type.Union([
    Type.Literal('under-review'),
    Type.Literal('upheld'),
    Type.Literal('not-upheld'),
    Type.Literal('withdrawn'),
  ]),
});

const ApplyAmendmentBody = Type.Object({
  entityType: Type.Union([
    Type.Literal('mark'),
    Type.Literal('module_result'),
    Type.Literal('progression_decision'),
  ]),
  entityId:   Type.String(),
  afterValue: Type.Record(Type.String(), Type.Unknown()),
});

export function correctionCasesRoutes(fastify: FastifyInstance): void {
  // ── Open a case ──────────────────────────────────────────────────────────────

  fastify.post(
    '/enrolments/:enrolmentId/correction-cases',
    {
      schema: {
        params:   Type.Object({ enrolmentId: Type.String() }),
        body:     OpenCaseBody,
        response: { 201: Type.Object({ caseId: Type.String() }), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('exam-board:ratify')],
    },
    async (request, reply) => {
      const { enrolmentId } = request.params as { enrolmentId: string };
      const body = request.body as OpenCaseInput;
      const openInput: OpenCaseInput = { enrolmentId, caseTypeCode: body.caseTypeCode };
      if (body.reference) openInput.reference = body.reference;
      const caseId = await fastify.correctionService.openCase(request.tenantId, openInput, request.user.sub);

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'post_ratification_case',
        entityId:         caseId,
        actionType:       'create',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(201).send({ caseId });
    },
  );

  // ── Advance case status ───────────────────────────────────────────────────────

  fastify.patch(
    '/correction-cases/:caseId/status',
    {
      schema: {
        params:   Type.Object({ caseId: Type.String() }),
        body:     AdvanceStatusBody,
        response: { 204: Type.Null(), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('exam-board:ratify')],
    },
    async (request, reply) => {
      const { caseId } = request.params as { caseId: string };
      const { statusCode } = request.body as { statusCode: CaseStatusCode };
      const transitionDecision = await fastify.correctionService.advanceCaseStatus(
        caseId,
        request.tenantId,
        statusCode,
        request.user.sub,
      );

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'post_ratification_case',
        entityId:         caseId,
        fieldName:        'status_code',
        afterValue:       transitionAuditValue(transitionDecision),
        actionType:       'update',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(204).send();
    },
  );

  // ── Apply amendment ───────────────────────────────────────────────────────────

  fastify.post(
    '/correction-cases/:caseId/amendments',
    {
      schema: {
        params:   Type.Object({ caseId: Type.String() }),
        body:     ApplyAmendmentBody,
        response: { 201: Type.Object({ amendmentId: Type.String() }), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('exam-board:ratify')],
    },
    async (request, reply) => {
      const { caseId } = request.params as { caseId: string };
      const body = request.body as ApplyAmendmentInput;
      const amendmentId = await fastify.correctionService.applyAmendment(
        caseId,
        request.tenantId,
        body,
        request.user.sub,
      );

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'post_ratification_amendment',
        entityId:         amendmentId,
        actionType:       'create',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(201).send({ amendmentId });
    },
  );

  // ── List cases ────────────────────────────────────────────────────────────────

  fastify.get(
    '/enrolments/:enrolmentId/correction-cases',
    {
      schema: {
        params:   Type.Object({ enrolmentId: Type.String() }),
        response: { 200: Type.Array(CorrectionCaseSchema), 404: ErrorSchema },
      },
      preHandler: [requirePermission('exam-board:read')],
    },
    async (request, reply) => {
      const { enrolmentId } = request.params as { enrolmentId: string };
      const cases = await fastify.correctionService.listCases(enrolmentId, request.tenantId);
      await reply.send(cases.map(caseToWire));
    },
  );
}

function caseToWire(dto: CorrectionCaseDto) {
  return {
    ...dto,
    validFrom:     dto.validFrom.toISOString(),
    validTo:       dto.validTo?.toISOString() ?? null,
    recordedAt:    dto.recordedAt.toISOString(),
    recordedUntil: dto.recordedUntil?.toISOString() ?? null,
  };
}
