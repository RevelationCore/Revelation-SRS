import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

const ErrorSchema = Type.Object({
  type:   Type.String(),
  title:  Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const OpenReviewCaseBody = Type.Object({
  ownerId: Type.String(),
});

const AddFindingBody = Type.Object({
  auditRecordId:   Type.String(),
  findingTypeCode: Type.Union([
    Type.Literal('no-concern'), Type.Literal('policy-breach'),
    Type.Literal('tamper-suspected'), Type.Literal('investigation-required'),
  ]),
  description: Type.Optional(Type.String()),
});

const SealPartitionBody = Type.Object({
  rangeStart: Type.String(),
  rangeEnd:   Type.String(),
});

const AuditReviewCaseSchema = Type.Object({
  auditReviewCaseId: Type.String(),
  statusCode:        Type.String(),
  ownerId:           Type.String(),
  createdAt:         Type.String(),
});

export function auditReviewRoutes(fastify: FastifyInstance): void {
  fastify.get(
    '/audit-review/cases',
    {
      schema: {
        querystring: Type.Object({ statusCode: Type.Optional(Type.String()) }),
        response: { 200: Type.Array(AuditReviewCaseSchema) },
      },
      preHandler: [requirePermission('audit-log:read')],
    },
    async (request, reply) => {
      const { statusCode } = request.query as { statusCode?: string };
      const cases = await fastify.auditReviewService.listCases(request.tenantId, statusCode);
      await reply.send(cases.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })));
    },
  );

  fastify.post(
    '/audit-review/cases',
    {
      schema: { body: OpenReviewCaseBody, response: { 201: Type.Object({ auditReviewCaseId: Type.String() }) } },
      preHandler: [requirePermission('audit-log:read')],
    },
    async (request, reply) => {
      const { ownerId } = request.body as { ownerId: string };
      const auditReviewCaseId = await fastify.auditReviewService.openCase(request.tenantId, ownerId, request.user.sub);
      await reply.code(201).send({ auditReviewCaseId });
    },
  );

  fastify.post(
    '/audit-review/cases/:caseId/findings',
    {
      schema: {
        params: Type.Object({ caseId: Type.String() }),
        body: AddFindingBody,
        response: { 201: Type.Object({ findingId: Type.String() }), 404: ErrorSchema },
      },
      preHandler: [requirePermission('audit-log:read')],
    },
    async (request, reply) => {
      const { caseId } = request.params as { caseId: string };
      const body = request.body as { auditRecordId: string; findingTypeCode: string; description?: string };
      const findingId = await fastify.auditReviewService.addFinding(request.tenantId, caseId, body);
      await reply.code(201).send({ findingId });
    },
  );

  fastify.post(
    '/audit-review/seal',
    {
      schema: { body: SealPartitionBody, response: { 201: Type.Object({ sealId: Type.String() }) } },
      preHandler: [requirePermission('retention:enforce')],
    },
    async (request, reply) => {
      const { rangeStart, rangeEnd } = request.body as { rangeStart: string; rangeEnd: string };
      const sealId = await fastify.audit.sealPartition(request.tenantId, new Date(rangeStart), new Date(rangeEnd), request.user.sub);
      await reply.code(201).send({ sealId });
    },
  );
}
