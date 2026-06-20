import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import { hasPermission } from '@revelation-srs/domain';
import type { FastifyInstance } from 'fastify';

import type { ExamEntryDto, ExamScheduleInput, ExamTimetableDto } from '../platform/assessment/exam-entry-service.js';
import type {
  CandidateProfileDto,
  CreateExamBoardInput,
  DataPackDto,
  DeferBoardInput,
  ExamBoardDto,
  RecordQuorumInput,
} from '../platform/governance/board-service.js';

const ErrorSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const ExamBoardSchema = Type.Object({
  examBoardId:      Type.String(),
  boardTypeCode:    Type.String(),
  academicYear:     Type.String(),
  academicPeriodId: Type.Union([Type.String(), Type.Null()]),
  periodCode:       Type.Union([Type.String(), Type.Null()]),
  meetingDate:      Type.Union([Type.String(), Type.Null()]),
  ratifiedAt:       Type.Union([Type.String(), Type.Null()]),
  deferredAt:       Type.Union([Type.String(), Type.Null()]),
  deferralReason:   Type.Union([Type.String(), Type.Null()]),
  quorumCount:      Type.Union([Type.Number(), Type.Null()]),
  quorumRecordedAt: Type.Union([Type.String(), Type.Null()]),
  actorId:          Type.String(),
  createdAt:        Type.String(),
});

const DeferBoardBody = Type.Object({
  reason: Type.Optional(Type.String()),
});

const QuorumBody = Type.Object({
  memberCount: Type.Integer({ minimum: 1 }),
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

const ExamEntrySchema = Type.Object({
  examEntryId: Type.String(),
  moduleRegistrationId: Type.String(),
  examBoardId: Type.String(),
  candidateNumber: Type.Union([Type.String(), Type.Null()]),
  scheduledDate: Type.Union([Type.String(), Type.Null()]),
  roomReference: Type.Union([Type.String(), Type.Null()]),
  statusCode: Type.String(),
  accommodations: Type.Record(Type.String(), Type.Unknown()),
  validFrom: Type.String(),
  recordedAt: Type.String(),
});

const ExamTimetableSchema = Type.Intersect([
  ExamEntrySchema,
  Type.Object({ personId: Type.String() }),
]);

const ExamScheduleBody = Type.Object({
  candidates: Type.Array(Type.Object({
    moduleRegistrationId: Type.String(),
    candidateNumber: Type.String(),
    scheduledDate: Type.String({ format: 'date' }),
    room: Type.String(),
  })),
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

  fastify.get(
    '/exam-boards/:boardId/data-packs/:dataPackId/candidates/:enrolmentId',
    {
      schema: {
        params: Type.Object({ boardId: Type.String(), dataPackId: Type.String(), enrolmentId: Type.String() }),
        response: { 200: CandidateProfileSchema, 404: ErrorSchema },
      },
      preHandler: [requirePermission('exam-board:read')],
    },
    async (request, reply) => {
      const { dataPackId, enrolmentId } = request.params as { boardId: string; dataPackId: string; enrolmentId: string };
      const profile = await fastify.boardService.getCandidateProfileByPack(dataPackId, enrolmentId, request.tenantId);
      await reply.send(candidateProfileToWire(profile));
    },
  );

  fastify.post(
    '/exam-boards/:boardId/exam-entries/generate',
    {
      schema: {
        params: Type.Object({ boardId: Type.String() }),
        response: {
          200: Type.Object({ entryCount: Type.Number(), entries: Type.Array(ExamEntrySchema) }),
          404: ErrorSchema,
          422: ErrorSchema,
        },
      },
      preHandler: [requirePermission('exam-board:write')],
    },
    async (request, reply) => {
      const { boardId } = request.params as { boardId: string };
      const result = await fastify.examEntryService.generateExamEntries(boardId, request.tenantId, request.user.sub);
      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'exam_entry',
        entityId: crypto.randomUUID(),
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });
      await reply.send({ entryCount: result.entryCount, entries: result.entries.map(examEntryToWire) });
    },
  );

  fastify.get(
    '/exam-boards/:boardId/exam-entries',
    {
      schema: {
        params: Type.Object({ boardId: Type.String() }),
        response: { 200: Type.Array(ExamEntrySchema), 404: ErrorSchema },
      },
      preHandler: [requirePermission('exam-board:read')],
    },
    async (request, reply) => {
      const { boardId } = request.params as { boardId: string };
      const entries = await fastify.examEntryService.listExamEntries(boardId, request.tenantId);
      await reply.send(entries.map(examEntryToWire));
    },
  );

  fastify.post(
    '/exam-boards/:boardId/exam-schedule',
    {
      schema: {
        params: Type.Object({ boardId: Type.String() }),
        body: ExamScheduleBody,
        response: {
          201: Type.Object({ receiptId: Type.String(), updatedCount: Type.Number() }),
          404: ErrorSchema,
        },
      },
      preHandler: [requirePermission('integration:manage')],
    },
    async (request, reply) => {
      const { boardId } = request.params as { boardId: string };
      const result = await fastify.examEntryService.processScheduleData(
        boardId,
        request.tenantId,
        request.body as ExamScheduleInput,
        request.user.sub,
      );
      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'exam_timetable_receipt',
        entityId: result.receiptId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });
      await reply.code(201).send(result);
    },
  );

  fastify.get(
    '/module-registrations/:moduleRegistrationId/exam-entry',
    {
      schema: {
        params: Type.Object({ moduleRegistrationId: Type.String() }),
        response: { 200: ExamEntrySchema, 404: ErrorSchema },
      },
      preHandler: [requirePermission('mark:read:all')],
    },
    async (request, reply) => {
      const { moduleRegistrationId } = request.params as { moduleRegistrationId: string };
      const entry = await fastify.examEntryService.getExamEntry(moduleRegistrationId, request.tenantId);
      await reply.send(examEntryToWire(entry));
    },
  );

  fastify.get(
    '/module-registrations/:moduleRegistrationId/exam-timetable',
    {
      schema: {
        params: Type.Object({ moduleRegistrationId: Type.String() }),
        response: { 200: ExamTimetableSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const { moduleRegistrationId } = request.params as { moduleRegistrationId: string };
      const roles = request.user.roles;
      const hasAll = hasPermission(roles, 'mark:read:all');
      const hasOwn = hasPermission(roles, 'student:read:own');
      if (!hasAll && !hasOwn) {
        return reply.code(403).send({
          type: 'https://srs.example.com/errors/forbidden',
          title: 'Forbidden',
          status: 403,
          detail: 'Requires mark:read:all or student:read:own',
        });
      }

      const timetable = await fastify.examEntryService.getExamTimetable(moduleRegistrationId, request.tenantId);
      if (!hasAll && hasOwn && timetable.personId !== request.user.srsPersonId) {
        return reply.code(403).send({
          type: 'https://srs.example.com/errors/forbidden',
          title: 'Forbidden',
          status: 403,
          detail: 'You may only access your own exam timetable',
        });
      }
      await reply.send(examTimetableToWire(timetable));
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

  // ── Deferral ──────────────────────────────────────────────────────────────

  fastify.post(
    '/exam-boards/:boardId/deferral',
    {
      schema: {
        params: Type.Object({ boardId: Type.String() }),
        body: DeferBoardBody,
        response: { 204: Type.Null(), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('exam-board:write')],
    },
    async (request, reply) => {
      const { boardId } = request.params as { boardId: string };
      const body = request.body as DeferBoardInput;
      await fastify.boardService.deferBoard(boardId, request.tenantId, request.user.sub, body);
      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'exam_board',
        entityId:         boardId,
        actionType:       'update',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
        reasonText:       'Exam board deferred',
      });
      await reply.code(204).send();
    },
  );

  fastify.delete(
    '/exam-boards/:boardId/deferral',
    {
      schema: {
        params: Type.Object({ boardId: Type.String() }),
        response: { 204: Type.Null(), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('exam-board:write')],
    },
    async (request, reply) => {
      const { boardId } = request.params as { boardId: string };
      await fastify.boardService.reopenBoard(boardId, request.tenantId, request.user.sub);
      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'exam_board',
        entityId:         boardId,
        actionType:       'update',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
        reasonText:       'Exam board deferral removed (board re-opened)',
      });
      await reply.code(204).send();
    },
  );

  // ── Quorum ────────────────────────────────────────────────────────────────

  fastify.post(
    '/exam-boards/:boardId/quorum',
    {
      schema: {
        params: Type.Object({ boardId: Type.String() }),
        body: QuorumBody,
        response: { 204: Type.Null(), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('exam-board:ratify')],
    },
    async (request, reply) => {
      const { boardId } = request.params as { boardId: string };
      const body = request.body as RecordQuorumInput;
      await fastify.boardService.recordQuorum(boardId, request.tenantId, body.memberCount, request.user.sub);
      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'exam_board',
        entityId:         boardId,
        actionType:       'update',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
        reasonText:       `Quorum recorded: ${body.memberCount} member(s)`,
      });
      await reply.code(204).send();
    },
  );
}

function boardToWire(board: ExamBoardDto) {
  return {
    ...board,
    ratifiedAt:       board.ratifiedAt?.toISOString() ?? null,
    deferredAt:       board.deferredAt?.toISOString() ?? null,
    quorumRecordedAt: board.quorumRecordedAt?.toISOString() ?? null,
    createdAt:        board.createdAt.toISOString(),
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

function examEntryToWire(entry: ExamEntryDto) {
  return {
    ...entry,
    validFrom: entry.validFrom.toISOString(),
    recordedAt: entry.recordedAt.toISOString(),
  };
}

function examTimetableToWire(timetable: ExamTimetableDto) {
  return examEntryToWire(timetable);
}
