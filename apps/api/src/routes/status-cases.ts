import { Type } from '@sinclair/typebox';
import { requireAnyPermission, requirePermission } from '@revelation-srs/auth';
import { ForbiddenError, hasPermission, NotFoundError } from '@revelation-srs/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import {
  STUDENT_REQUESTABLE,
  type OpenStatusCaseInput,
  type StatusCaseConditionDto,
  type StatusCaseDto,
} from '../platform/status-cases/status-case-service.js';

const ErrorSchema = Type.Object({ type: Type.String(), title: Type.String(), status: Type.Number(), detail: Type.Optional(Type.String()) });
const Nullable = <T extends ReturnType<typeof Type.String>>(t: T) => Type.Union([t, Type.Null()]);
const DateString = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' });

const ConditionSchema = Type.Object({
  conditionId: Type.String(), statusCaseId: Type.String(), conditionTypeCode: Type.String(), description: Type.String(),
  dueDate: Nullable(Type.String()), statusCode: Type.String(), evidenceRef: Nullable(Type.String()),
  resolvedBy: Nullable(Type.String()), resolvedAt: Nullable(Type.String()), resolutionNote: Nullable(Type.String()),
});
const CaseSchema = Type.Object({
  statusCaseId: Type.String(), businessCaseId: Type.String(), enrolmentId: Type.String(), personId: Type.String(),
  caseTypeCode: Type.String(), initiatedByCode: Type.String(), reasonCategoryCode: Nullable(Type.String()),
  requestedEffectiveDate: Type.String(), expectedReturnDate: Nullable(Type.String()),
  destinationProgrammeId: Nullable(Type.String()), destinationModeOfStudyCode: Nullable(Type.String()),
  relatedCaseId: Nullable(Type.String()), institutionalOutcomeRef: Nullable(Type.String()), statusCode: Type.String(),
  decidedBy: Nullable(Type.String()), decidedAt: Nullable(Type.String()), decisionReason: Nullable(Type.String()),
  approvedEffectiveDate: Nullable(Type.String()), approvedReturnDate: Nullable(Type.String()),
  enrolmentStatusTransitionId: Nullable(Type.String()), createdBy: Type.String(), createdAt: Type.String(),
  assessments: Type.Array(Type.Object({
    assessmentId: Type.String(), assessorRoleCode: Type.String(), outcomeCode: Type.String(),
    note: Nullable(Type.String()), assessedBy: Type.String(), assessedAt: Type.String(),
  })),
  conditions: Type.Array(ConditionSchema),
  outstandingReturnConditions: Type.Array(ConditionSchema),
  /** The student, for readers without student-record access (ADR-017). */
  subject: Type.Optional(Type.Object({
    personId: Type.String(), studentNumber: Type.String(), studentName: Type.String(),
    programmeCode: Nullable(Type.String()), programmeTitle: Nullable(Type.String()),
  })),
});

/**
 * Student status cases (BPR-D04): interruption, suspension, return,
 * withdrawal, transfer and leaver closure. A student may request their own
 * interruption, return, withdrawal or transfer; the registry decides.
 */
export function statusCaseRoutes(fastify: FastifyInstance): void {
  fastify.get('/status-cases', {
    schema: { response: { 200: Type.Array(CaseSchema) } },
    preHandler: [requirePermission('status-case:read')],
  }, async (request, reply) => {
    const cases = await fastify.statusCaseService.listOpen(request.tenantId);
    const subjects = await fastify.statusCaseService.subjects(request.tenantId, cases.map((c) => c.enrolmentId));
    await reply.send(cases.map((c) => ({ ...caseToWire(c), subject: subjects.get(c.enrolmentId) })));
  });

  fastify.get('/enrolments/:enrolmentId/status-cases', {
    schema: { params: Type.Object({ enrolmentId: Type.String() }), response: { 200: Type.Array(CaseSchema), 403: ErrorSchema, 404: ErrorSchema } },
    preHandler: [requireAnyPermission('status-case:read', 'status-case:request:own')],
  }, async (request, reply) => {
    const { enrolmentId } = request.params as { enrolmentId: string };
    await assertEnrolmentAccess(fastify, request, enrolmentId, 'status-case:read');
    await reply.send((await fastify.statusCaseService.listForEnrolment(request.tenantId, enrolmentId)).map(caseToWire));
  });

  fastify.get('/enrolments/:enrolmentId/status-case-options', {
    schema: {
      params: Type.Object({ enrolmentId: Type.String() }),
      response: { 200: Type.Object({
        enrolmentStatusCode: Type.String(),
        requestableTypes: Type.Array(Type.String()),
        openCaseId: Nullable(Type.String()),
        returnFrom: Type.Union([Type.Object({
          statusCaseId: Type.String(), caseTypeCode: Type.String(),
          approvedEffectiveDate: Nullable(Type.String()), approvedReturnDate: Nullable(Type.String()),
          outstandingConditions: Type.Array(ConditionSchema),
        }), Type.Null()]),
        sponsored: Type.Boolean(),
      }), 403: ErrorSchema, 404: ErrorSchema },
    },
    preHandler: [requireAnyPermission('status-case:read', 'status-case:request:own')],
  }, async (request, reply) => {
    const { enrolmentId } = request.params as { enrolmentId: string };
    await assertEnrolmentAccess(fastify, request, enrolmentId, 'status-case:read');
    const forStudent = !hasPermission(request.user.roles, 'status-case:write');
    const options = await fastify.statusCaseService.requestOptions(request.tenantId, enrolmentId, forStudent);
    await reply.send({ ...options, returnFrom: options.returnFrom ? { ...options.returnFrom, outstandingConditions: options.returnFrom.outstandingConditions.map(conditionToWire) } : null });
  });

  fastify.post('/enrolments/:enrolmentId/status-cases', {
    schema: {
      params: Type.Object({ enrolmentId: Type.String() }),
      body: Type.Object({
        caseTypeCode: Type.Union(['interruption', 'suspension', 'return', 'withdrawal', 'transfer', 'leaver-closure'].map((c) => Type.Literal(c))),
        initiatedByCode: Type.Optional(Type.Union([Type.Literal('student'), Type.Literal('institution')])),
        reasonCategoryCode: Type.Optional(Type.String()),
        requestedEffectiveDate: DateString,
        expectedReturnDate: Type.Optional(DateString),
        destinationProgrammeId: Type.Optional(Type.String()),
        destinationModeOfStudyCode: Type.Optional(Type.String()),
        relatedCaseId: Type.Optional(Type.String()),
        institutionalOutcomeRef: Type.Optional(Type.String({ maxLength: 200 })),
      }),
      response: { 201: CaseSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requireAnyPermission('status-case:write', 'status-case:request:own')],
  }, async (request, reply) => {
    const { enrolmentId } = request.params as { enrolmentId: string };
    const body = request.body as Omit<OpenStatusCaseInput, 'initiatedByCode'> & { initiatedByCode?: 'student' | 'institution' };
    const staff = hasPermission(request.user.roles, 'status-case:write');
    await assertEnrolmentAccess(fastify, request, enrolmentId, 'status-case:write');
    if (!staff && !STUDENT_REQUESTABLE.includes(body.caseTypeCode)) {
      throw new ForbiddenError(`A student cannot open a ${body.caseTypeCode} case`);
    }
    const input: OpenStatusCaseInput = { ...body, initiatedByCode: staff ? (body.initiatedByCode ?? 'institution') : 'student' };
    const created = await fastify.statusCaseService.openCase(request.tenantId, enrolmentId, input, request.user.sub);
    await audit(fastify, request, created.statusCaseId, 'create', `Opened ${created.caseTypeCode} case`);
    await reply.code(201).send(caseToWire(created));
  });

  fastify.get('/status-cases/:statusCaseId', {
    schema: { params: Type.Object({ statusCaseId: Type.String() }), response: { 200: CaseSchema, 403: ErrorSchema, 404: ErrorSchema } },
    preHandler: [requireAnyPermission('status-case:read', 'status-case:request:own')],
  }, async (request, reply) => {
    const { statusCaseId } = request.params as { statusCaseId: string };
    const found = await fastify.statusCaseService.getCase(request.tenantId, statusCaseId);
    await assertEnrolmentAccess(fastify, request, found.enrolmentId, 'status-case:read');
    const subjects = await fastify.statusCaseService.subjects(request.tenantId, [found.enrolmentId]);
    await reply.send({ ...caseToWire(found), subject: subjects.get(found.enrolmentId) });
  });

  fastify.post('/status-cases/:statusCaseId/assessments', {
    schema: {
      params: Type.Object({ statusCaseId: Type.String() }),
      body: Type.Object({ assessorRoleCode: Type.String(), outcomeCode: Type.String(), note: Type.Optional(Type.String({ maxLength: 2000 })) }),
      response: { 200: CaseSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('status-case:assess')],
  }, async (request, reply) => {
    const { statusCaseId } = request.params as { statusCaseId: string };
    const updated = await fastify.statusCaseService.addAssessment(request.tenantId, statusCaseId, request.body as never, request.user.sub);
    await audit(fastify, request, statusCaseId, 'update', 'Recorded assessment');
    await reply.send(caseToWire(updated));
  });

  fastify.post('/status-cases/:statusCaseId/conditions', {
    schema: {
      params: Type.Object({ statusCaseId: Type.String() }),
      body: Type.Object({ conditionTypeCode: Type.String(), description: Type.String({ minLength: 1, maxLength: 1000 }), dueDate: Type.Optional(DateString) }),
      response: { 200: CaseSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requireAnyPermission('status-case:write', 'status-case:decide')],
  }, async (request, reply) => {
    const { statusCaseId } = request.params as { statusCaseId: string };
    const updated = await fastify.statusCaseService.addCondition(request.tenantId, statusCaseId, request.body as never, request.user.sub);
    await audit(fastify, request, statusCaseId, 'update', 'Added condition');
    await reply.send(caseToWire(updated));
  });

  fastify.post('/status-case-conditions/:conditionId/resolution', {
    schema: {
      params: Type.Object({ conditionId: Type.String() }),
      body: Type.Object({
        statusCode: Type.Union([Type.Literal('met'), Type.Literal('waived')]),
        note: Type.Optional(Type.String({ maxLength: 1000 })), evidenceRef: Type.Optional(Type.String({ maxLength: 200 })),
      }),
      response: { 200: ConditionSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requireAnyPermission('status-case:write', 'status-case:decide')],
  }, async (request, reply) => {
    const { conditionId } = request.params as { conditionId: string };
    const resolved = await fastify.statusCaseService.resolveCondition(request.tenantId, conditionId, request.body as never, request.user.sub);
    await audit(fastify, request, resolved.statusCaseId, 'update', `Condition ${resolved.statusCode}`);
    await reply.send(conditionToWire(resolved));
  });

  fastify.post('/status-cases/:statusCaseId/decision', {
    schema: {
      params: Type.Object({ statusCaseId: Type.String() }),
      body: Type.Object({
        decisionCode: Type.Union([Type.Literal('approved'), Type.Literal('rejected')]),
        reason: Type.String({ minLength: 1, maxLength: 2000 }),
        effectiveDate: Type.Optional(DateString), returnDate: Type.Optional(DateString),
      }),
      response: { 200: CaseSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('status-case:decide')],
  }, async (request, reply) => {
    const { statusCaseId } = request.params as { statusCaseId: string };
    const decided = await fastify.statusCaseService.decide(request.tenantId, statusCaseId, request.body as never, request.user.sub);
    await audit(fastify, request, statusCaseId, 'update', `Case ${decided.statusCode}`);
    await reply.send(caseToWire(decided));
  });

  fastify.post('/status-cases/:statusCaseId/withdrawal', {
    schema: { params: Type.Object({ statusCaseId: Type.String() }), response: { 200: CaseSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema } },
    preHandler: [requireAnyPermission('status-case:write', 'status-case:request:own')],
  }, async (request, reply) => {
    const { statusCaseId } = request.params as { statusCaseId: string };
    const found = await fastify.statusCaseService.getCase(request.tenantId, statusCaseId);
    await assertEnrolmentAccess(fastify, request, found.enrolmentId, 'status-case:write');
    if (!hasPermission(request.user.roles, 'status-case:write') && found.createdBy !== request.user.sub) {
      throw new ForbiddenError('Only the requester can withdraw this case');
    }
    const withdrawn = await fastify.statusCaseService.withdrawCase(request.tenantId, statusCaseId, request.user.sub);
    await audit(fastify, request, statusCaseId, 'update', 'Case withdrawn');
    await reply.send(caseToWire(withdrawn));
  });
}

/** Staff with the staff permission see any enrolment; a student only their own. */
async function assertEnrolmentAccess(fastify: FastifyInstance, request: FastifyRequest, enrolmentId: string, staffPermission: string) {
  if (hasPermission(request.user.roles, staffPermission as never)) return;
  const enrolment = await fastify.enrolmentService.getEnrolment(enrolmentId, request.tenantId);
  if (!enrolment) throw new NotFoundError('Enrolment', enrolmentId);
  if (!request.user.srsPersonId || enrolment.personId !== request.user.srsPersonId) {
    throw new ForbiddenError('You can only see or request status changes for your own enrolment');
  }
}

async function audit(fastify: FastifyInstance, request: FastifyRequest, entityId: string, actionType: 'create' | 'update', reasonText: string) {
  await fastify.audit.record({
    tenantId: request.tenantId, entityType: 'student_status_case', entityId, actionType, actorType: 'user',
    actorId: request.user.sub, actorDisplayName: request.user.displayName, correlationId: request.id, reasonText,
  });
}

function conditionToWire(c: StatusCaseConditionDto) {
  return { ...c, resolvedAt: c.resolvedAt?.toISOString() ?? null };
}

function caseToWire(c: StatusCaseDto) {
  return {
    ...c,
    decidedAt: c.decidedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    assessments: c.assessments.map((a) => ({ ...a, assessedAt: a.assessedAt.toISOString() })),
    conditions: c.conditions.map(conditionToWire),
    outstandingReturnConditions: c.outstandingReturnConditions.map(conditionToWire),
  };
}
