import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

const ErrorSchema = Type.Object({
  type:   Type.String(),
  title:  Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const DeclareConflictBody = Type.Object({
  enrolmentId:      Type.Optional(Type.String()),
  conflictTypeCode: Type.String(),
});

const QuorumDecisionBody = Type.Object({
  requiredCount:  Type.Integer({ minimum: 0 }),
  attendingCount: Type.Integer({ minimum: 0 }),
});

const BoardDecisionBody = Type.Object({
  dataPackId:       Type.String(),
  decisionTypeCode: Type.Union([
    Type.Literal('ratify'),
    Type.Literal('defer'),
    Type.Literal('refer-back'),
  ]),
  rationale: Type.Optional(Type.String()),
});

export function boardAuthorityRoutes(fastify: FastifyInstance): void {
  fastify.post(
    '/exam-boards/:examBoardId/conflicts',
    {
      schema: {
        params:   Type.Object({ examBoardId: Type.String() }),
        body:     DeclareConflictBody,
        response: { 201: Type.Object({ conflictId: Type.String() }) },
      },
      preHandler: [requirePermission('exam-board:ratify')],
    },
    async (request, reply) => {
      const { examBoardId } = request.params as { examBoardId: string };
      const body = request.body as { enrolmentId?: string; conflictTypeCode: string };
      const conflictId = await fastify.boardAuthorityService.declareConflict(request.tenantId, examBoardId, body, request.user.sub);
      await reply.code(201).send({ conflictId });
    },
  );

  fastify.patch(
    '/board-conflicts/:conflictId/recuse',
    {
      schema: {
        params:   Type.Object({ conflictId: Type.String() }),
        response: { 204: Type.Null(), 404: ErrorSchema },
      },
      preHandler: [requirePermission('exam-board:ratify')],
    },
    async (request, reply) => {
      const { conflictId } = request.params as { conflictId: string };
      await fastify.boardAuthorityService.recuseMember(request.tenantId, conflictId);
      await reply.code(204).send();
    },
  );

  fastify.post(
    '/exam-boards/:examBoardId/quorum-decision',
    {
      schema: {
        params:   Type.Object({ examBoardId: Type.String() }),
        body:     QuorumDecisionBody,
        response: { 201: Type.Object({ quorumDecisionId: Type.String(), quorumMet: Type.Boolean() }) },
      },
      preHandler: [requirePermission('exam-board:ratify')],
    },
    async (request, reply) => {
      const { examBoardId } = request.params as { examBoardId: string };
      const body = request.body as { requiredCount: number; attendingCount: number };
      const quorumDecisionId = await fastify.boardAuthorityService.recordQuorumDecision(request.tenantId, examBoardId, body, request.user.sub);
      await reply.code(201).send({ quorumDecisionId, quorumMet: body.attendingCount >= body.requiredCount });
    },
  );

  fastify.post(
    '/exam-boards/:examBoardId/decisions',
    {
      schema: {
        params:   Type.Object({ examBoardId: Type.String() }),
        body:     BoardDecisionBody,
        response: { 201: Type.Object({ decisionId: Type.String() }), 404: ErrorSchema },
      },
      preHandler: [requirePermission('exam-board:ratify')],
    },
    async (request, reply) => {
      const { examBoardId } = request.params as { examBoardId: string };
      const body = request.body as { dataPackId: string; decisionTypeCode: string; rationale?: string };
      const decisionId = await fastify.boardAuthorityService.recordBoardDecision(request.tenantId, examBoardId, body, request.user.sub);

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'exam_board_decision',
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
    '/board-decisions/:decisionId/ratification',
    {
      schema: {
        params:   Type.Object({ decisionId: Type.String() }),
        response: { 201: Type.Object({ ratificationRecordId: Type.String() }), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('exam-board:ratify')],
    },
    async (request, reply) => {
      const { decisionId } = request.params as { decisionId: string };
      const ratificationRecordId = await fastify.boardAuthorityService.createRatificationRecord(request.tenantId, decisionId, request.user.sub);

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'ratification_record',
        entityId:         ratificationRecordId,
        actionType:       'create',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(201).send({ ratificationRecordId });
    },
  );

  fastify.patch(
    '/ratification-records/:ratificationRecordId/publish',
    {
      schema: {
        params:   Type.Object({ ratificationRecordId: Type.String() }),
        response: { 204: Type.Null(), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('exam-board:ratify')],
    },
    async (request, reply) => {
      const { ratificationRecordId } = request.params as { ratificationRecordId: string };
      await fastify.boardAuthorityService.publishResults(request.tenantId, ratificationRecordId, request.user.sub);

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'result_publication',
        entityId:         ratificationRecordId,
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
