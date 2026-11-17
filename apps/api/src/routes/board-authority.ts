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
  packHash:         Type.String({ pattern: '^sha256:[0-9a-f]{64}$', description: 'The hash of the pack the board was shown (D-36)' }),
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
        response: { 201: Type.Object({ decisionId: Type.String() }), 404: ErrorSchema, 409: ErrorSchema },
      },
      preHandler: [requirePermission('exam-board:ratify')],
    },
    async (request, reply) => {
      const { examBoardId } = request.params as { examBoardId: string };
      const body = request.body as { dataPackId: string; packHash: string; decisionTypeCode: string; rationale?: string };
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
        response: { 201: Type.Object({ ratificationRecordId: Type.String() }), 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
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

  // ── Pack evidence (D-36) ──────────────────────────────────────────────────

  fastify.get(
    '/exam-boards/:examBoardId/data-packs/:dataPackId/verification',
    {
      schema: {
        params: Type.Object({ examBoardId: Type.String(), dataPackId: Type.String() }),
        response: {
          200: Type.Object({
            dataPackId: Type.String(),
            storedHash: Type.Union([Type.String(), Type.Null()]),
            recomputedHash: Type.Union([Type.String(), Type.Null()]),
            status: Type.Union([Type.Literal('verified'), Type.Literal('mismatch'), Type.Literal('unhashed')]),
            superseded: Type.Boolean(),
            supersededById: Type.Union([Type.String(), Type.Null()]),
            ruleManifestRef: Type.Union([Type.String(), Type.Null()]),
            manifestHashMatches: Type.Union([Type.Boolean(), Type.Null()]),
            drift: Type.Array(Type.Object({ versionId: Type.String(), ruleTypeCode: Type.String() })),
            decisions: Type.Array(Type.Object({
              decisionId: Type.String(), decisionTypeCode: Type.String(), packHash: Type.Union([Type.String(), Type.Null()]), matches: Type.Boolean(), decidedAt: Type.String(),
            })),
            ratifiedAgainst: Type.Union([Type.Object({ dataPackId: Type.Union([Type.String(), Type.Null()]), packHash: Type.Union([Type.String(), Type.Null()]) }), Type.Null()]),
          }),
          404: ErrorSchema,
        },
      },
      preHandler: [requirePermission('exam-board:read')],
    },
    async (request, reply) => {
      const { examBoardId, dataPackId } = request.params as { examBoardId: string; dataPackId: string };
      const result = await fastify.boardAuthorityService.verifyDataPack(request.tenantId, examBoardId, dataPackId);
      await fastify.audit.record({
        tenantId: request.tenantId, entityType: 'exam_board_data_pack', entityId: dataPackId, actionType: 'read',
        actorType: 'user', actorId: request.user.sub, actorDisplayName: request.user.displayName, correlationId: request.id,
        reasonText: `Pack verification: ${result.status}`,
      });
      await reply.send({ ...result, decisions: result.decisions.map((d) => ({ ...d, decidedAt: d.decidedAt.toISOString() })) });
    },
  );

  fastify.get(
    '/exam-boards/:examBoardId/data-packs/:dataPackId/rule-manifest',
    {
      schema: {
        params: Type.Object({ examBoardId: Type.String(), dataPackId: Type.String() }),
        response: { 200: Type.Object({ manifestHash: Type.String(), content: Type.Record(Type.String(), Type.Unknown()) }), 404: ErrorSchema },
      },
      preHandler: [requirePermission('exam-board:read')],
    },
    async (request, reply) => {
      const { examBoardId, dataPackId } = request.params as { examBoardId: string; dataPackId: string };
      const manifest = await fastify.boardAuthorityService.getRuleManifest(request.tenantId, examBoardId, dataPackId);
      await reply.send({ manifestHash: manifest.manifestHash, content: manifest.content as unknown as Record<string, unknown> });
    },
  );
}
