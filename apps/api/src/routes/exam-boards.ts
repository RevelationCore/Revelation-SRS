import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

import type {
  CandidateProfileDto,
  CreateExamBoardInput,
  DataPackDto,
  ExamBoardDto,
} from '../platform/governance/board-service.js';

const ErrorSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const ExamBoardSchema = Type.Object({
  examBoardId: Type.String(),
  boardTypeCode: Type.String(),
  academicYear: Type.String(),
  academicPeriodId: Type.Union([Type.String(), Type.Null()]),
  meetingDate: Type.Union([Type.String(), Type.Null()]),
  ratifiedAt: Type.Union([Type.String(), Type.Null()]),
  actorId: Type.String(),
  createdAt: Type.String(),
});

const DataPackSchema = Type.Object({
  dataPackId: Type.String(),
  examBoardId: Type.String(),
  packVersion: Type.Number(),
  supersededById: Type.Union([Type.String(), Type.Null()]),
  sourceTransactionTime: Type.String(),
  candidateCount: Type.Number(),
  generatedAt: Type.String(),
  generatedBy: Type.String(),
});

const CandidateProfileSchema = Type.Object({
  candidateProfileId: Type.String(),
  dataPackId: Type.String(),
  enrolmentId: Type.String(),
  personId: Type.String(),
  profileData: Type.Record(Type.String(), Type.Unknown()),
  createdAt: Type.String(),
});

const CreateExamBoardBody = Type.Object({
  boardTypeCode: Type.String({ minLength: 1 }),
  academicYear: Type.String({ minLength: 1 }),
  academicPeriodId: Type.Optional(Type.String()),
  meetingDate: Type.Optional(Type.String({ format: 'date' })),
});

const AttendanceBody = Type.Object({
  roleCode: Type.String({ minLength: 1 }),
});

const SignoffBody = Type.Object({
  commentary: Type.Optional(Type.String()),
});

export function examBoardRoutes(fastify: FastifyInstance): void {
  fastify.post(
    '/exam-boards',
    {
      schema: {
        body: CreateExamBoardBody,
        response: { 201: Type.Object({ examBoardId: Type.String() }), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('exam-board:write')],
    },
    async (request, reply) => {
      const body = request.body as CreateExamBoardInput;
      const examBoardId = await fastify.boardService.createExamBoard(request.tenantId, body, request.user.sub);
      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'exam_board',
        entityId: examBoardId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });
      await reply.code(201).send({ examBoardId });
    },
  );

  fastify.get(
    '/exam-boards/:boardId',
    {
      schema: {
        params: Type.Object({ boardId: Type.String() }),
        response: { 200: ExamBoardSchema, 404: ErrorSchema },
      },
      preHandler: [requirePermission('exam-board:read')],
    },
    async (request, reply) => {
      const { boardId } = request.params as { boardId: string };
      const board = await fastify.boardService.getExamBoard(boardId, request.tenantId);
      await reply.send(boardToWire(board));
    },
  );

  fastify.post(
    '/exam-boards/:boardId/data-pack',
    {
      schema: {
        params: Type.Object({ boardId: Type.String() }),
        response: { 201: Type.Object({ dataPackId: Type.String() }), 404: ErrorSchema },
      },
      preHandler: [requirePermission('exam-board:write')],
    },
    async (request, reply) => {
      const { boardId } = request.params as { boardId: string };
      const dataPackId = await fastify.boardService.generateDataPack(boardId, request.tenantId, request.user.sub);
      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'exam_board_data_pack',
        entityId: dataPackId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });
      await reply.code(201).send({ dataPackId });
    },
  );

  fastify.get(
    '/exam-boards/:boardId/data-pack',
    {
      schema: {
        params: Type.Object({ boardId: Type.String() }),
        response: { 200: DataPackSchema, 404: ErrorSchema },
      },
      preHandler: [requirePermission('exam-board:read')],
    },
    async (request, reply) => {
      const { boardId } = request.params as { boardId: string };
      const pack = await fastify.boardService.getDataPack(boardId, request.tenantId);
      await reply.send(dataPackToWire(pack));
    },
  );

  fastify.get(
    '/exam-boards/:boardId/candidates/:enrolmentId',
    {
      schema: {
        params: Type.Object({ boardId: Type.String(), enrolmentId: Type.String() }),
        response: { 200: CandidateProfileSchema, 404: ErrorSchema },
      },
      preHandler: [requirePermission('exam-board:read')],
    },
    async (request, reply) => {
      const { boardId, enrolmentId } = request.params as { boardId: string; enrolmentId: string };
      const profile = await fastify.boardService.getCandidateProfile(boardId, enrolmentId, request.tenantId);
      await reply.send(candidateProfileToWire(profile));
    },
  );

  fastify.post(
    '/exam-boards/:boardId/attendance',
    {
      schema: {
        params: Type.Object({ boardId: Type.String() }),
        body: AttendanceBody,
        response: { 201: Type.Object({ attendanceId: Type.String() }), 404: ErrorSchema },
      },
      preHandler: [requirePermission('exam-board:write')],
    },
    async (request, reply) => {
      const { boardId } = request.params as { boardId: string };
      const body = request.body as { roleCode: string };
      const attendanceId = await fastify.boardService.recordMemberAttendance(boardId, request.tenantId, request.user.sub, body.roleCode);

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'exam_board_member_attendance',
        entityId:         attendanceId,
        actionType:       'create',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(201).send({ attendanceId });
    },
  );

  fastify.post(
    '/exam-boards/:boardId/external-examiner-signoff',
    {
      schema: {
        params: Type.Object({ boardId: Type.String() }),
        body: SignoffBody,
        response: { 201: Type.Object({ signoffId: Type.String() }), 404: ErrorSchema },
      },
      preHandler: [requirePermission('exam-board:ratify')],
    },
    async (request, reply) => {
      const { boardId } = request.params as { boardId: string };
      const body = request.body as { commentary?: string };
      const signoffId = await fastify.boardService.recordExternalExaminerSignoff(boardId, request.tenantId, request.user.sub, body.commentary);

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'external_examiner_signoff',
        entityId:         signoffId,
        actionType:       'create',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(201).send({ signoffId });
    },
  );

  fastify.post(
    '/exam-boards/:boardId/ratification',
    {
      schema: {
        params: Type.Object({ boardId: Type.String() }),
        response: { 204: Type.Null(), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('exam-board:ratify')],
    },
    async (request, reply) => {
      const { boardId } = request.params as { boardId: string };
      await fastify.boardService.ratifyBoard(boardId, request.tenantId, request.user.sub);
      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'exam_board',
        entityId: boardId,
        actionType: 'update',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
        reasonText: 'Exam board ratified',
      });
      await reply.code(204).send();
    },
  );
}

function boardToWire(board: ExamBoardDto) {
  return {
    ...board,
    ratifiedAt: board.ratifiedAt?.toISOString() ?? null,
    createdAt: board.createdAt.toISOString(),
  };
}

function dataPackToWire(pack: DataPackDto) {
  return {
    ...pack,
    sourceTransactionTime: pack.sourceTransactionTime.toISOString(),
    generatedAt: pack.generatedAt.toISOString(),
  };
}

function candidateProfileToWire(profile: CandidateProfileDto) {
  return {
    ...profile,
    createdAt: profile.createdAt.toISOString(),
  };
}
