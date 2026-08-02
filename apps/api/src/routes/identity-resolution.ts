import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

const ErrorSchema = Type.Object({
  type:   Type.String(),
  title:  Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const OpenCaseBody = Type.Object({
  subjectPersonId: Type.String(),
  ownerId:         Type.String(),
});

const AddCandidateBody = Type.Object({
  candidatePersonId: Type.String(),
  matchScore:        Type.Number({ minimum: 0, maximum: 1 }),
  matchReasonCode:   Type.String(),
});

const DecideBody = Type.Object({
  decisionTypeCode: Type.Union([Type.Literal('merge'), Type.Literal('reject'), Type.Literal('link')]),
  survivorPersonId: Type.Optional(Type.String()),
});

const LinkPersonsBody = Type.Object({
  sourcePersonId: Type.String(),
  targetPersonId: Type.String(),
  linkTypeCode:   Type.String(),
});

const OpenCorrectionCaseBody = Type.Object({
  personId:            Type.String(),
  correctedEntityType: Type.String(),
  correctedFieldName:  Type.String(),
  ownerId:             Type.String(),
});

const IdentityResolutionCaseSchema = Type.Object({
  identityResolutionCaseId: Type.String(),
  subjectPersonId: Type.String(),
  statusCode:      Type.String(),
  ownerId:         Type.String(),
  createdAt:       Type.String(),
});

const DataCorrectionCaseSchema = Type.Object({
  dataCorrectionCaseId: Type.String(),
  personId:             Type.String(),
  correctedEntityType:  Type.String(),
  correctedFieldName:   Type.String(),
  statusCode:           Type.String(),
  ownerId:              Type.String(),
  createdAt:            Type.String(),
});

export function identityResolutionRoutes(fastify: FastifyInstance): void {
  fastify.get(
    '/identity-resolution/cases',
    {
      schema: {
        querystring: Type.Object({ statusCode: Type.Optional(Type.String()) }),
        response: { 200: Type.Array(IdentityResolutionCaseSchema) },
      },
      preHandler: [requirePermission('identity:manage')],
    },
    async (request, reply) => {
      const { statusCode } = request.query as { statusCode?: string };
      const cases = await fastify.identityResolutionService.listCases(request.tenantId, statusCode);
      await reply.send(cases.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })));
    },
  );

  fastify.get(
    '/identity-resolution/correction-cases',
    {
      schema: {
        querystring: Type.Object({ statusCode: Type.Optional(Type.String()) }),
        response: { 200: Type.Array(DataCorrectionCaseSchema) },
      },
      preHandler: [requirePermission('identity:manage')],
    },
    async (request, reply) => {
      const { statusCode } = request.query as { statusCode?: string };
      const cases = await fastify.identityResolutionService.listCorrectionCases(request.tenantId, statusCode);
      await reply.send(cases.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })));
    },
  );

  fastify.post(
    '/identity-resolution/cases',
    {
      schema: {
        body:     OpenCaseBody,
        response: { 201: Type.Object({ identityResolutionCaseId: Type.String() }) },
      },
      preHandler: [requirePermission('identity:manage')],
    },
    async (request, reply) => {
      const body = request.body as { subjectPersonId: string; ownerId: string };
      const identityResolutionCaseId = await fastify.identityResolutionService.openCase(request.tenantId, body, request.user.sub);
      await reply.code(201).send({ identityResolutionCaseId });
    },
  );

  fastify.post(
    '/identity-resolution/cases/:caseId/candidates',
    {
      schema: {
        params:   Type.Object({ caseId: Type.String() }),
        body:     AddCandidateBody,
        response: { 201: Type.Object({ candidateId: Type.String() }), 404: ErrorSchema },
      },
      preHandler: [requirePermission('identity:manage')],
    },
    async (request, reply) => {
      const { caseId } = request.params as { caseId: string };
      const body = request.body as { candidatePersonId: string; matchScore: number; matchReasonCode: string };
      const candidateId = await fastify.identityResolutionService.addCandidate(request.tenantId, caseId, body);
      await reply.code(201).send({ candidateId });
    },
  );

  fastify.post(
    '/identity-resolution/cases/:caseId/decision',
    {
      schema: {
        params:   Type.Object({ caseId: Type.String() }),
        body:     DecideBody,
        response: { 201: Type.Object({ decisionId: Type.String() }), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('identity:manage')],
    },
    async (request, reply) => {
      const { caseId } = request.params as { caseId: string };
      const body = request.body as { decisionTypeCode: 'merge' | 'reject' | 'link'; survivorPersonId?: string };
      const decisionId = await fastify.identityResolutionService.decide(request.tenantId, caseId, body, request.user.sub);

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'identity_resolution_decision',
        entityId:         decisionId,
        actionType:       'create',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(201).send({ decisionId });
    },
  );

  fastify.post(
    '/identity-resolution/links',
    {
      schema: {
        body:     LinkPersonsBody,
        response: { 201: Type.Object({ linkId: Type.String() }) },
      },
      preHandler: [requirePermission('identity:manage')],
    },
    async (request, reply) => {
      const body = request.body as { sourcePersonId: string; targetPersonId: string; linkTypeCode: string };
      const linkId = await fastify.identityResolutionService.linkPersons(request.tenantId, body.sourcePersonId, body.targetPersonId, body.linkTypeCode);

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'person_identity_link',
        entityId:         linkId,
        actionType:       'create',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(201).send({ linkId });
    },
  );

  fastify.post(
    '/identity-resolution/correction-cases',
    {
      schema: {
        body:     OpenCorrectionCaseBody,
        response: { 201: Type.Object({ dataCorrectionCaseId: Type.String() }) },
      },
      preHandler: [requirePermission('identity:manage')],
    },
    async (request, reply) => {
      const body = request.body as { personId: string; correctedEntityType: string; correctedFieldName: string; ownerId: string };
      const dataCorrectionCaseId = await fastify.identityResolutionService.openCorrectionCase(
        request.tenantId, body.personId, body.correctedEntityType, body.correctedFieldName, body.ownerId, request.user.sub,
      );
      await reply.code(201).send({ dataCorrectionCaseId });
    },
  );
}
