import { Type } from '@sinclair/typebox';
import { requireSelfOrPermission } from '@revelation-srs/auth';
import { ForbiddenError, hasPermission, type Permission } from '@revelation-srs/domain';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';

const ErrorSchema = Type.Object({ type: Type.String(), title: Type.String(), status: Type.Number(), detail: Type.Optional(Type.String()) });
const Json = Type.Record(Type.String(), Type.Unknown());
const PersonParams = Type.Object({ personId: Type.String() });

/**
 * Only the person themselves, holding `permission`: staff may preview the
 * read views, but a supervisor's or examiner's own submission is theirs
 * alone (staff enter reports for examiners through the staff route, with a
 * reason).
 */
function requireSelf(permission: Permission): preHandlerHookHandler {
  return (request: FastifyRequest, _reply: FastifyReply, done) => {
    const personId = (request.params as Record<string, string>)['personId'];
    if (hasPermission(request.user.roles, permission) && personId && personId === request.user.srsPersonId) { done(); return; }
    done(new ForbiddenError(`Only the person themselves, holding '${permission}', can do this`));
  };
}

/** Supervisor, review panel and examiner self-service (Phase 5 D-40, ADR-025). */
export function researchStaffRoutes(fastify: FastifyInstance): void {
  const read = requireSelfOrPermission('pgr-case:read:assigned', 'pgr-case:read');
  const svc = () => fastify.researchStaffService;

  fastify.get('/research-staff/:personId/pgr/assignments', {
    schema: { params: PersonParams, response: { 200: Json } },
    preHandler: [read],
  }, async (request, reply) => {
    const { personId } = request.params as { personId: string };
    await reply.send(await svc().assignments(request.tenantId, personId));
  });

  fastify.get('/research-staff/:personId/pgr/supervisees/:enrolmentId', {
    schema: { params: Type.Object({ personId: Type.String(), enrolmentId: Type.String() }), response: { 200: Json, 404: ErrorSchema } },
    preHandler: [read],
  }, async (request, reply) => {
    const { personId, enrolmentId } = request.params as { personId: string; enrolmentId: string };
    const view = await svc().supervisee(request.tenantId, personId, enrolmentId);
    await audit(fastify, request, 'enrolment', enrolmentId, 'read', 'Supervisee record viewed by supervisor');
    await reply.send(view);
  });

  fastify.post('/research-staff/:personId/pgr/progress-reviews/:reviewId/supervisor-report', {
    schema: { params: Type.Object({ personId: Type.String(), reviewId: Type.String() }), response: { 201: Type.Object({ evidenceId: Type.String() }), 400: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema } },
    preHandler: [requireSelf('pgr-review:contribute:assigned')],
  }, async (request, reply) => {
    const { personId, reviewId } = request.params as { personId: string; reviewId: string };
    const file = await request.file();
    if (!file) return reply.code(400).send({ type: 'about:blank', title: 'Bad Request', status: 400, detail: 'A multipart file field is required' });
    const result = await svc().submitSupervisorReport(request.tenantId, personId, reviewId, { filename: file.filename, mimeType: file.mimetype, content: await file.toBuffer() }, request.user.sub);
    await audit(fastify, request, 'pgr_progress_review', reviewId, 'update', 'Supervisor report submitted');
    return reply.code(201).send(result);
  });

  fastify.get('/research-staff/:personId/pgr/progress-reviews/:reviewId', {
    schema: { params: Type.Object({ personId: Type.String(), reviewId: Type.String() }), response: { 200: Json, 404: ErrorSchema } },
    preHandler: [read],
  }, async (request, reply) => {
    const { personId, reviewId } = request.params as { personId: string; reviewId: string };
    await reply.send(await svc().panelReview(request.tenantId, personId, reviewId));
  });

  fastify.get('/research-staff/:personId/pgr/progress-reviews/:reviewId/evidence/:evidenceId/content', {
    schema: { params: Type.Object({ personId: Type.String(), reviewId: Type.String(), evidenceId: Type.String() }), response: { 404: ErrorSchema } },
    preHandler: [read],
  }, async (request, reply) => {
    const { personId, reviewId, evidenceId } = request.params as { personId: string; reviewId: string; evidenceId: string };
    const doc = await svc().downloadReviewEvidence(request.tenantId, personId, reviewId, evidenceId, request.user.sub);
    await audit(fastify, request, 'case_evidence_reference', evidenceId, 'read', 'Progress review evidence downloaded by panel member');
    await reply.header('content-type', doc.mimeType).header('content-disposition', `attachment; filename="${doc.filename}"`).send(doc.content);
  });

  fastify.post('/research-staff/:personId/pgr/review-members/:memberId/conflict', {
    schema: { params: Type.Object({ personId: Type.String(), memberId: Type.String() }), body: Type.Object({ conflictTypeCode: Type.String() }), response: { 204: Type.Null(), 404: ErrorSchema, 422: ErrorSchema } },
    preHandler: [requireSelf('pgr-case:read:assigned')],
  }, async (request, reply) => {
    const { personId, memberId } = request.params as { personId: string; memberId: string };
    await svc().declareReviewConflict(request.tenantId, personId, memberId, (request.body as { conflictTypeCode: string }).conflictTypeCode);
    await audit(fastify, request, 'pgr_review_member', memberId, 'update', 'Panel member declared a conflict');
    await reply.code(204).send();
  });

  fastify.get('/research-staff/:personId/pgr/examinations/:caseId', {
    schema: { params: Type.Object({ personId: Type.String(), caseId: Type.String() }), response: { 200: Json, 404: ErrorSchema } },
    preHandler: [read],
  }, async (request, reply) => {
    const { personId, caseId } = request.params as { personId: string; caseId: string };
    await reply.send(await svc().examination(request.tenantId, personId, caseId));
  });

  fastify.get('/research-staff/:personId/pgr/examinations/:caseId/thesis', {
    schema: { params: Type.Object({ personId: Type.String(), caseId: Type.String() }), response: { 404: ErrorSchema } },
    preHandler: [read],
  }, async (request, reply) => {
    const { personId, caseId } = request.params as { personId: string; caseId: string };
    const doc = await svc().downloadThesis(request.tenantId, personId, caseId, request.user.sub);
    await audit(fastify, request, 'pgr_examination_case', caseId, 'read', 'Thesis downloaded by examiner');
    await reply.header('content-type', doc.mimeType).header('content-disposition', `attachment; filename="${doc.filename}"`).send(doc.content);
  });

  fastify.post('/research-staff/:personId/pgr/examinations/:caseId/report', {
    schema: { params: Type.Object({ personId: Type.String(), caseId: Type.String() }), response: { 201: Type.Object({ reportId: Type.String() }), 400: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema } },
    preHandler: [requireSelf('pgr-report:submit:own')],
  }, async (request, reply) => {
    const { personId, caseId } = request.params as { personId: string; caseId: string };
    let recommendationCode: string | undefined;
    let file: { filename: string; mimeType: string; content: Buffer } | null = null;
    for await (const part of request.parts()) {
      if (part.type === 'file') file = { filename: part.filename, mimeType: part.mimetype, content: await part.toBuffer() };
      else if (part.fieldname === 'recommendationCode' && typeof part.value === 'string' && part.value) recommendationCode = part.value;
    }
    if (!file) return reply.code(400).send({ type: 'about:blank', title: 'Bad Request', status: 400, detail: 'A multipart file field is required' });
    const result = await svc().submitReport(request.tenantId, personId, caseId, { ...(recommendationCode ? { recommendationCode } : {}), file }, request.user.sub);
    await audit(fastify, request, 'examiner_report', result.reportId, 'create', 'Examiner submitted their preliminary report');
    return reply.code(201).send(result);
  });

  fastify.post('/research-staff/:personId/pgr/examinations/:caseId/appointments/:appointmentId/conflict', {
    schema: { params: Type.Object({ personId: Type.String(), caseId: Type.String(), appointmentId: Type.String() }), body: Type.Object({ conflictTypeCode: Type.String() }), response: { 204: Type.Null(), 404: ErrorSchema, 422: ErrorSchema } },
    preHandler: [requireSelf('pgr-case:read:assigned')],
  }, async (request, reply) => {
    const { personId, caseId, appointmentId } = request.params as { personId: string; caseId: string; appointmentId: string };
    await svc().declareExaminerConflict(request.tenantId, personId, caseId, appointmentId, (request.body as { conflictTypeCode: string }).conflictTypeCode);
    await audit(fastify, request, 'examiner_appointment', appointmentId, 'update', 'Examiner declared a conflict');
    await reply.code(204).send();
  });
}

async function audit(fastify: FastifyInstance, request: FastifyRequest, entityType: string, entityId: string, actionType: 'read' | 'create' | 'update', reasonText: string): Promise<void> {
  await fastify.audit.record({
    tenantId: request.tenantId, entityType, entityId, actionType, actorType: 'user',
    actorId: request.user.sub, actorDisplayName: request.user.displayName, correlationId: request.id, reasonText,
  });
}
