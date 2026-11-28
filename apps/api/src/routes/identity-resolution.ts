import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import { ForbiddenError, NotFoundError } from '@revelation-srs/domain';
import type { FastifyInstance } from 'fastify';

import type { DecideInput, ProposalInput } from '../platform/identity/identity-resolution-service.js';

const ErrorSchema = Type.Object({
  type:   Type.String(),
  title:  Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
  // ADR-031: a refused merge says why (reasonCode).
  errors: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
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

// ADR-031: the survivor comes from the proposal, and the decider from the token.
const DecideBody = Type.Object({
  decisionTypeCode: Type.Union([Type.Literal('merge'), Type.Literal('reject'), Type.Literal('link')]),
  proposalVersion:  Type.Optional(Type.Integer({ minimum: 1 })),
  reason:           Type.String({ minLength: 1, maxLength: 2000 }),
}, { additionalProperties: false });

const Choice = Type.Union([Type.Literal('survivor'), Type.Literal('merged')]);
const ProposalBody = Type.Object({
  survivorPersonId:      Type.String({ format: 'uuid' }),
  mergedPersonId:        Type.String({ format: 'uuid' }),
  factChoices:           Type.Optional(Type.Record(Type.String(), Choice)),
  identifierResolutions: Type.Optional(Type.Record(Type.String(), Type.Object({ keep: Choice, reason: Type.String({ minLength: 1 }) }))),
  twoAccountsConfirmed:  Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

const ProposalSchema = Type.Object({
  proposalId: Type.String(), version: Type.Integer(), survivorPersonId: Type.String(), mergedPersonId: Type.String(),
  factChoices: Type.Record(Type.String(), Type.String()),
  identifierResolutions: Type.Record(Type.String(), Type.Object({ keep: Type.String(), reason: Type.String() })),
  twoAccountsConfirmed: Type.Boolean(), proposedBy: Type.String(), proposedAt: Type.String(),
  identifierConflicts: Type.Array(Type.Object({ identifierClass: Type.String(), survivorValues: Type.Array(Type.String()), mergedValues: Type.Array(Type.String()), resolved: Type.Boolean() })),
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
      preHandler: [requirePermission('identity-resolution:read')],
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
      preHandler: [requirePermission('identity-resolution:prepare')],
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
      preHandler: [requirePermission('identity-resolution:prepare')],
    },
    async (request, reply) => {
      const { caseId } = request.params as { caseId: string };
      const body = request.body as { candidatePersonId: string; matchScore: number; matchReasonCode: string };
      const candidateId = await fastify.identityResolutionService.addCandidate(request.tenantId, caseId, body, request.user.sub);
      await reply.code(201).send({ candidateId });
    },
  );

  fastify.put(
    '/identity-resolution/cases/:caseId/proposal',
    {
      schema: {
        params:   Type.Object({ caseId: Type.String() }),
        body:     ProposalBody,
        response: { 200: ProposalSchema, 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('identity-resolution:prepare')],
    },
    async (request, reply) => {
      const { caseId } = request.params as { caseId: string };
      const proposal = await fastify.identityResolutionService.putProposal(request.tenantId, caseId, request.body as ProposalInput, request.user.sub);
      await fastify.audit.record({
        tenantId: request.tenantId, entityType: 'identity_merge_proposal', entityId: proposal.proposalId, actionType: 'create',
        actorType: 'user', actorId: request.user.sub, actorDisplayName: request.user.displayName, correlationId: request.id,
        reasonText: `Merge proposal version ${proposal.version}`,
      });
      await reply.send(proposal);
    },
  );

  fastify.get(
    '/identity-resolution/cases/:caseId/proposal',
    {
      schema: { params: Type.Object({ caseId: Type.String() }), response: { 200: ProposalSchema, 404: ErrorSchema } },
      preHandler: [requirePermission('identity-resolution:read')],
    },
    async (request, reply) => {
      const { caseId } = request.params as { caseId: string };
      const proposal = await fastify.identityResolutionService.getProposal(request.tenantId, caseId);
      if (!proposal) throw new NotFoundError('IdentityMergeProposal', caseId);
      await reply.send(proposal);
    },
  );

  fastify.post(
    '/identity-resolution/cases/:caseId/decision',
    {
      schema: {
        params:   Type.Object({ caseId: Type.String() }),
        body:     DecideBody,
        response: { 201: Type.Object({ decisionId: Type.String() }), 400: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('identity-resolution:decide')],
      // The survivor comes from the proposal (ADR-031 item 3). Unknown body
      // fields are stripped before validation, so refuse this one explicitly.
      preValidation: async (request, reply) => {
        const raw = request.body as Record<string, unknown> | undefined;
        if (raw && ('survivorPersonId' in raw || 'decidedBy' in raw)) {
          await reply.code(400).type('application/problem+json').send({
            type: 'https://srs.example.com/errors/bad-request', title: 'Bad request', status: 400,
            detail: 'The survivor comes from the proposal and the decider from your sign-in; do not send survivorPersonId or decidedBy', instance: request.url,
          });
        }
      },
    },
    async (request, reply) => {
      const { caseId } = request.params as { caseId: string };
      const body = request.body as DecideInput;
      let decisionId: string;
      try {
        decisionId = await fastify.identityResolutionService.decide(request.tenantId, caseId, body, { sub: request.user.sub, srsPersonId: request.user.srsPersonId });
      } catch (err) {
        if (err instanceof ForbiddenError) {
          return reply.code(403).type('application/problem+json').send({
            type: 'https://srs.example.com/errors/separation-of-duties', title: 'Separation of duties', status: 403, detail: err.message, instance: request.url,
          });
        }
        throw err;
      }

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
        response: { 201: Type.Object({ linkId: Type.String() }), 400: ErrorSchema },
      },
      // ADR-031: related-record links only; merges are made by a decision.
      preHandler: [requirePermission('identity-resolution:prepare')],
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

  // ── Unmerge (ADR-031 item 10, BL-359) ─────────────────────────────────────

  const UnmergeCaseSchema = Type.Object({
    unmergeCaseId: Type.String(), mergeId: Type.String(), survivorPersonId: Type.String(), restoredPersonId: Type.String(),
    statusCode: Type.String(), proposalVersion: Type.Integer(),
    allocations: Type.Record(Type.String(), Type.Union([Type.Literal('survivor'), Type.Literal('restored')])),
    postMergeRecords: Type.Array(Type.Object({ key: Type.String(), table: Type.String(), column: Type.String(), rowKey: Type.String() })),
    openedBy: Type.String(), proposedBy: Type.Union([Type.String(), Type.Null()]), decidedBy: Type.Union([Type.String(), Type.Null()]),
  });
  const actorOf = (request: { user: { sub: string; srsPersonId?: string } }) => ({ sub: request.user.sub, srsPersonId: request.user.srsPersonId });

  fastify.post(
    '/identity-merges/:mergeId/unmerge-cases',
    {
      schema: { params: Type.Object({ mergeId: Type.String({ format: 'uuid' }) }), response: { 201: Type.Object({ unmergeCaseId: Type.String() }), 404: ErrorSchema, 409: ErrorSchema } },
      preHandler: [requirePermission('identity-resolution:prepare')],
    },
    async (request, reply) => {
      const { mergeId } = request.params as { mergeId: string };
      const unmergeCaseId = await fastify.identityUnmergeService.openCase(request.tenantId, mergeId, actorOf(request));
      await fastify.audit.record({
        tenantId: request.tenantId, entityType: 'identity_unmerge_case', entityId: unmergeCaseId, actionType: 'create', actorType: 'user',
        actorId: request.user.sub, actorDisplayName: request.user.displayName, correlationId: request.id, reasonText: `Unmerge of merge ${mergeId} opened`,
      });
      await reply.code(201).send({ unmergeCaseId });
    },
  );

  fastify.get(
    '/identity-unmerge-cases/:unmergeCaseId',
    {
      schema: { params: Type.Object({ unmergeCaseId: Type.String({ format: 'uuid' }) }), response: { 200: UnmergeCaseSchema, 404: ErrorSchema } },
      preHandler: [requirePermission('identity-resolution:read')],
    },
    async (request, reply) => {
      const { unmergeCaseId } = request.params as { unmergeCaseId: string };
      await reply.send(await fastify.identityUnmergeService.getCase(request.tenantId, unmergeCaseId));
    },
  );

  fastify.put(
    '/identity-unmerge-cases/:unmergeCaseId/proposal',
    {
      schema: {
        params: Type.Object({ unmergeCaseId: Type.String({ format: 'uuid' }) }),
        body: Type.Object({ allocations: Type.Record(Type.String(), Type.Union([Type.Literal('survivor'), Type.Literal('restored')])) }),
        response: { 200: UnmergeCaseSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('identity-resolution:prepare')],
    },
    async (request, reply) => {
      const { unmergeCaseId } = request.params as { unmergeCaseId: string };
      const { allocations } = request.body as { allocations: Record<string, 'survivor' | 'restored'> };
      const kase = await fastify.identityUnmergeService.propose(request.tenantId, unmergeCaseId, allocations, actorOf(request));
      await fastify.audit.record({
        tenantId: request.tenantId, entityType: 'identity_unmerge_case', entityId: unmergeCaseId, actionType: 'update', actorType: 'user',
        actorId: request.user.sub, actorDisplayName: request.user.displayName, correlationId: request.id, reasonText: `Unmerge proposal version ${kase.proposalVersion}`,
      });
      await reply.send(kase);
    },
  );

  fastify.post(
    '/identity-unmerge-cases/:unmergeCaseId/decision',
    {
      schema: {
        params: Type.Object({ unmergeCaseId: Type.String({ format: 'uuid' }) }),
        body: Type.Object({
          decisionTypeCode: Type.Union([Type.Literal('unmerge'), Type.Literal('reject')]),
          proposalVersion: Type.Optional(Type.Integer({ minimum: 1 })),
          reason: Type.String({ minLength: 1, maxLength: 2000 }),
        }),
        response: { 200: UnmergeCaseSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('identity-resolution:decide')],
    },
    async (request, reply) => {
      const { unmergeCaseId } = request.params as { unmergeCaseId: string };
      const body = request.body as { decisionTypeCode: 'unmerge' | 'reject'; proposalVersion?: number; reason: string };
      const kase = await fastify.identityUnmergeService.decide(request.tenantId, unmergeCaseId, body, actorOf(request));
      await fastify.audit.record({
        tenantId: request.tenantId, entityType: 'identity_unmerge_case', entityId: unmergeCaseId, actionType: 'update', actorType: 'user',
        actorId: request.user.sub, actorDisplayName: request.user.displayName, correlationId: request.id, reasonText: `Unmerge decision ${body.decisionTypeCode}`,
      });
      await reply.send(kase);
    },
  );
}
