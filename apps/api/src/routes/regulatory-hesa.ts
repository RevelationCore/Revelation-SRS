import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

import type { HesaReturnDto, HesaValidationReportPayload } from '../platform/regulatory/hesa-service.js';

const ErrorSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const HesaReturnSchema = Type.Object({
  returnId: Type.String(),
  academicYear: Type.String(),
  statusCode: Type.String(),
  submittedAt: Type.Union([Type.String(), Type.Null()]),
  validatedAt: Type.Union([Type.String(), Type.Null()]),
  submissionReference: Type.Union([Type.String(), Type.Null()]),
  amendmentOfId: Type.Union([Type.String(), Type.Null()]),
  generatedBy: Type.String(),
  generatedAt: Type.String(),
  recordCount: Type.Number(),
  validationSummary: Type.Object({
    blockingErrorCount: Type.Number(),
    warningCount: Type.Number(),
  }),
});

const ValidationResultSchema = Type.Object({
  isValid: Type.Boolean(),
  errors: Type.Array(Type.Object({
    field: Type.String(),
    enrolmentId: Type.Union([Type.String(), Type.Null()]),
    message: Type.String(),
  })),
  warnings: Type.Array(Type.Object({
    field: Type.String(),
    enrolmentId: Type.Union([Type.String(), Type.Null()]),
    message: Type.String(),
  })),
});

export function regulatoryHesaRoutes(fastify: FastifyInstance): void {
  fastify.post(
    '/regulatory/hesa/returns',
    {
      schema: {
        body: Type.Object({ academicYear: Type.String({ minLength: 1 }) }),
        response: { 201: Type.Object({ returnId: Type.String() }) },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const { academicYear } = request.body as { academicYear: string };
      const returnId = await fastify.hesaService.generateStudentReturn(request.tenantId, academicYear, request.user.sub);
      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'hesa_student_return',
        entityId: returnId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });
      await reply.code(201).send({ returnId });
    },
  );

  fastify.get(
    '/regulatory/hesa/returns',
    {
      schema: {
        querystring: Type.Object({ academicYear: Type.Optional(Type.String()) }),
        response: { 200: Type.Array(HesaReturnSchema) },
      },
      preHandler: [requirePermission('regulatory:read')],
    },
    async (request, reply) => {
      const query = request.query as { academicYear?: string };
      const returns = await fastify.hesaService.listReturns(request.tenantId, query.academicYear);
      await reply.send(returns.map(hesaReturnToWire));
    },
  );

  fastify.get(
    '/regulatory/hesa/returns/:returnId',
    {
      schema: {
        params: Type.Object({ returnId: Type.String() }),
        response: { 200: HesaReturnSchema, 404: ErrorSchema },
      },
      preHandler: [requirePermission('regulatory:read')],
    },
    async (request, reply) => {
      const { returnId } = request.params as { returnId: string };
      const hesaReturn = await fastify.hesaService.getReturn(returnId, request.tenantId);
      await reply.send(hesaReturnToWire(hesaReturn));
    },
  );

  fastify.post(
    '/regulatory/hesa/returns/:returnId/validate',
    {
      schema: {
        params: Type.Object({ returnId: Type.String() }),
        response: { 200: ValidationResultSchema, 404: ErrorSchema },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const { returnId } = request.params as { returnId: string };
      const result = await fastify.hesaService.validateReturn(returnId, request.tenantId, request.user.sub);
      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'hesa_student_return',
        entityId: returnId,
        actionType: 'update',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });
      await reply.send(result);
    },
  );

  fastify.get(
    '/regulatory/hesa/returns/:returnId/file',
    {
      schema: {
        params: Type.Object({ returnId: Type.String() }),
        response: { 200: Type.String(), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('regulatory:read')],
    },
    async (request, reply) => {
      const { returnId } = request.params as { returnId: string };
      const file = await fastify.hesaService.generateSubmissionFile(returnId, request.tenantId, request.user.sub);
      await reply.header('content-type', 'application/xml').send(file);
    },
  );

  fastify.post(
    '/regulatory/hesa/returns/:returnId/validation-reports',
    {
      schema: {
        params: Type.Object({ returnId: Type.String() }),
        body: Type.Object({ reportPayload: Type.Record(Type.String(), Type.Unknown()) }),
        response: {
          201: Type.Object({
            reportId: Type.String(),
            assignmentsProcessed: Type.Number(),
            blockingErrorCount: Type.Number(),
            warningCount: Type.Number(),
          }),
          404: ErrorSchema,
        },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const { returnId } = request.params as { returnId: string };
      const { reportPayload } = request.body as { reportPayload: HesaValidationReportPayload };
      const result = await fastify.hesaService.processValidationReport(returnId, request.tenantId, reportPayload, request.user.sub);
      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'hesa_validation_report',
        entityId: result.reportId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });
      await reply.code(201).send(result);
    },
  );

  fastify.post(
    '/regulatory/hesa/returns/:returnId/submit',
    {
      schema: {
        params: Type.Object({ returnId: Type.String() }),
        body: Type.Object({ submissionReference: Type.Optional(Type.String()) }),
        response: { 204: Type.Null(), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const { returnId } = request.params as { returnId: string };
      const { submissionReference } = request.body as { submissionReference?: string };
      await fastify.hesaService.markSubmitted(returnId, request.tenantId, submissionReference ?? null, request.user.sub);
      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'hesa_student_return',
        entityId: returnId,
        actionType: 'update',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });
      await reply.code(204).send();
    },
  );

  fastify.post(
    '/regulatory/hesa/returns/:returnId/amendments',
    {
      schema: {
        params: Type.Object({ returnId: Type.String() }),
        response: { 201: Type.Object({ returnId: Type.String() }), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const { returnId } = request.params as { returnId: string };
      const amendmentId = await fastify.hesaService.generateAmendment(returnId, request.tenantId, request.user.sub);
      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'hesa_student_return',
        entityId: amendmentId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });
      await reply.code(201).send({ returnId: amendmentId });
    },
  );
}

function hesaReturnToWire(hesaReturn: HesaReturnDto) {
  return {
    returnId: hesaReturn.returnId,
    academicYear: hesaReturn.academicYear,
    statusCode: hesaReturn.statusCode,
    submittedAt: hesaReturn.submittedAt?.toISOString() ?? null,
    validatedAt: hesaReturn.validatedAt?.toISOString() ?? null,
    submissionReference: hesaReturn.submissionReference,
    amendmentOfId: hesaReturn.amendmentOfId,
    generatedBy: hesaReturn.generatedBy,
    generatedAt: hesaReturn.generatedAt.toISOString(),
    recordCount: hesaReturn.recordCount,
    validationSummary: hesaReturn.validationSummary,
  };
}
