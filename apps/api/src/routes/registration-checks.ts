import { Type } from '@sinclair/typebox';
import { requireAnyPermission, requirePermission } from '@revelation-srs/auth';
import { ForbiddenError, hasPermission } from '@revelation-srs/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { FeeStatusReassessmentDto, FinancialRegistrationDto } from '../platform/registration/financial-registration-service.js';
import type { RightToStudyDto } from '../platform/registration/right-to-study-service.js';

const ErrorSchema = Type.Object({ type: Type.String(), title: Type.String(), status: Type.Number(), detail: Type.Optional(Type.String()) });
const Json = Type.Record(Type.String(), Type.Unknown());
const DateString = Type.String({ format: 'date' });

/** Right to study (D-17) and financial registration (D-18): the checks before and alongside registration. */
export function registrationCheckRoutes(fastify: FastifyInstance): void {
  const rts = () => fastify.rightToStudyService;
  const fin = () => fastify.financialRegistrationService;

  // ── Right to study ─────────────────────────────────────────────────────────

  fastify.get('/students/:personId/right-to-study', {
    schema: { params: Type.Object({ personId: Type.String() }), response: { 200: Type.Array(Json), 403: ErrorSchema } },
    preHandler: [requireAnyPermission('right-to-study:read', 'right-to-study:submit:own')],
  }, async (request, reply) => {
    const { personId } = request.params as { personId: string };
    assertOwn(request, personId, 'right-to-study:read');
    await reply.send((await rts().listForPerson(request.tenantId, personId)).map(rtsWire));
  });

  fastify.post('/students/:personId/right-to-study', {
    schema: {
      params: Type.Object({ personId: Type.String() }),
      body: Type.Object({
        basisCode: Type.String({ minLength: 1 }), methodCode: Type.String({ minLength: 1 }),
        outcomeCode: Type.Union([Type.Literal('eligible'), Type.Literal('not-eligible')]),
        enrolmentId: Type.Optional(Type.String()), casCaseId: Type.Optional(Type.String()),
        permissionExpiresOn: Type.Optional(DateString), ukEntryDate: Type.Optional(DateString), restrictionCode: Type.Optional(Type.String()),
        evidenceRef: Type.Optional(Type.String()), identityVerificationCheckId: Type.Optional(Type.String()), recheckDueOn: Type.Optional(DateString),
        note: Type.Optional(Type.String({ maxLength: 2000 })),
      }),
      response: { 201: Json, 422: ErrorSchema },
    },
    preHandler: [requirePermission('right-to-study:record')],
  }, async (request, reply) => {
    const { personId } = request.params as { personId: string };
    const check = await rts().record(request.tenantId, personId, request.body as never, request.user.sub);
    await audit(fastify, request, 'right_to_study_check', check.checkId, `Right to study recorded: ${check.outcomeCode} (${check.basisCode ?? ''}, ${check.methodCode ?? ''})`);
    await reply.code(201).send(rtsWire(check));
  });

  fastify.post('/right-to-study/:checkId/decision', {
    schema: {
      params: Type.Object({ checkId: Type.String() }),
      body: Type.Object({ outcomeCode: Type.Union([Type.Literal('eligible'), Type.Literal('not-eligible')]), note: Type.String({ minLength: 1, maxLength: 2000 }) }),
      response: { 200: Json, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('right-to-study:decide')],
  }, async (request, reply) => {
    const { checkId } = request.params as { checkId: string };
    const check = await rts().decide(request.tenantId, checkId, request.body as never, request.user.sub);
    await audit(fastify, request, 'right_to_study_check', checkId, `Referred right to study decided: ${check.outcomeCode}`);
    await reply.send(rtsWire(check));
  });

  fastify.post('/students/:personId/right-to-study/share-code', {
    schema: { params: Type.Object({ personId: Type.String() }), body: Type.Object({ shareCode: Type.String({ minLength: 9, maxLength: 12 }) }), response: { 201: Json, 403: ErrorSchema, 422: ErrorSchema } },
    preHandler: [requirePermission('right-to-study:submit:own')],
  }, async (request, reply) => {
    const { personId } = request.params as { personId: string };
    assertOwn(request, personId, null);
    const check = await rts().submitShareCode(request.tenantId, personId, (request.body as { shareCode: string }).shareCode, request.user.sub);
    await audit(fastify, request, 'right_to_study_check', check.checkId, 'Student shared a View and Prove code');
    await reply.code(201).send(rtsWire(check));
  });

  fastify.get('/right-to-study/worklist', {
    schema: { response: { 200: Type.Array(Json) } },
    preHandler: [requirePermission('right-to-study:read')],
  }, async (request, reply) => {
    await reply.send((await rts().worklist(request.tenantId)).map((w) => ({ reason: w.reason, check: rtsWire(w.check) })));
  });

  // ── Financial registration ────────────────────────────────────────────────

  fastify.get('/enrolments/:enrolmentId/financial-registration', {
    schema: { params: Type.Object({ enrolmentId: Type.String() }), response: { 200: Type.Array(Json) } },
    preHandler: [requirePermission('financial-registration:read')],
  }, async (request, reply) => {
    const { enrolmentId } = request.params as { enrolmentId: string };
    await reply.send((await fin().listForEnrolment(request.tenantId, enrolmentId)).map(finWire));
  });

  fastify.get('/financial-registration', {
    schema: {
      querystring: Type.Object({
        financialStatusCode: Type.Optional(Type.Union(['pending', 'arranged', 'hold', 'not-required'].map((c) => Type.Literal(c)))),
        academicYear: Type.Optional(Type.String()),
      }),
      response: { 200: Type.Array(Json) },
    },
    preHandler: [requirePermission('financial-registration:read')],
  }, async (request, reply) => {
    const q = request.query as { financialStatusCode?: 'pending'; academicYear?: string };
    await reply.send((await fin().worklist(request.tenantId, { ...(q.financialStatusCode ? { financialStatusCode: q.financialStatusCode } : {}), ...(q.academicYear ? { academicYear: q.academicYear } : {}) })).map(finWire));
  });

  const StatusBody = Type.Object({
    financialStatusCode: Type.Union(['pending', 'arranged', 'hold', 'not-required'].map((c) => Type.Literal(c))),
    payerArrangementCode: Type.Optional(Type.String()), financeReference: Type.Optional(Type.String({ maxLength: 200 })), holdReasonCode: Type.Optional(Type.String()),
  });

  fastify.post('/fee-liabilities/:liabilityId/financial-status', {
    schema: { params: Type.Object({ liabilityId: Type.String() }), body: StatusBody, response: { 200: Json, 404: ErrorSchema, 422: ErrorSchema } },
    preHandler: [requirePermission('financial-registration:write')],
  }, async (request, reply) => {
    const { liabilityId } = request.params as { liabilityId: string };
    const result = await fin().updateStatus(request.tenantId, liabilityId, request.body as never, request.user.sub, 'manual');
    await audit(fastify, request, 'fee_liability', liabilityId, `Financial registration ${result.academicYear}: ${result.financialStatusCode}`);
    await reply.send(finWire(result));
  });

  // F-FIN-SIS-01: Finance's report of an arrangement or a hold.
  fastify.post('/financial-registration/finance-updates', {
    schema: {
      body: Type.Intersect([StatusBody, Type.Object({ enrolmentId: Type.String(), academicYear: Type.String({ pattern: '^\\d{4}-\\d{2}$' }) })]),
      response: { 200: Json, 404: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('financial-registration:write')],
  }, async (request, reply) => {
    const result = await fin().applyFinanceUpdate(request.tenantId, request.body as never, request.user.sub);
    await audit(fastify, request, 'fee_liability', result.liabilityId, `Finance update ${result.academicYear}: ${result.financialStatusCode}`);
    await reply.send(finWire(result));
  });

  fastify.get('/fee-status-reassessments', {
    schema: { querystring: Type.Object({ enrolmentId: Type.Optional(Type.String()), open: Type.Optional(Type.Boolean()) }), response: { 200: Type.Array(Json) } },
    preHandler: [requireAnyPermission('fee-status:propose', 'fee-status:decide')],
  }, async (request, reply) => {
    const q = request.query as { enrolmentId?: string; open?: boolean };
    await reply.send((await fin().listReassessments(request.tenantId, { ...(q.enrolmentId ? { enrolmentId: q.enrolmentId } : {}), ...(q.open ? { open: true } : {}) })).map(reWire));
  });

  fastify.post('/enrolments/:enrolmentId/fee-status-reassessments', {
    schema: {
      params: Type.Object({ enrolmentId: Type.String() }),
      body: Type.Object({ feeStatusCode: Type.String({ minLength: 1 }), reason: Type.String({ minLength: 1, maxLength: 2000 }) }),
      response: { 201: Json, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('fee-status:propose')],
  }, async (request, reply) => {
    const { enrolmentId } = request.params as { enrolmentId: string };
    const result = await fin().proposeFeeStatusChange(request.tenantId, enrolmentId, request.body as never, request.user.sub);
    await audit(fastify, request, 'business_case', result.caseId, `Fee-status reassessment proposed: ${result.proposedFeeStatusCode}`);
    await reply.code(201).send(reWire(result));
  });

  fastify.post('/fee-status-reassessments/:caseId/decision', {
    schema: {
      params: Type.Object({ caseId: Type.String() }),
      body: Type.Object({ outcome: Type.Union([Type.Literal('approved'), Type.Literal('rejected')]), note: Type.Optional(Type.String({ maxLength: 2000 })) }),
      response: { 200: Json, 404: ErrorSchema, 409: ErrorSchema },
    },
    preHandler: [requirePermission('fee-status:decide')],
  }, async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const result = await fin().decideFeeStatusChange(request.tenantId, caseId, request.body as never, request.user.sub);
    await audit(fastify, request, 'business_case', caseId, `Fee-status reassessment ${result.decision?.outcome ?? ''}`);
    await reply.send(reWire(result));
  });
}

function assertOwn(request: FastifyRequest, personId: string, staffPermission: string | null): void {
  if (staffPermission && hasPermission(request.user.roles, staffPermission as never)) return;
  if (!request.user.srsPersonId || request.user.srsPersonId !== personId) throw new ForbiddenError('You can only see or send your own right-to-study evidence');
}

async function audit(fastify: FastifyInstance, request: FastifyRequest, entityType: string, entityId: string, reasonText: string) {
  await fastify.audit.record({
    tenantId: request.tenantId, entityType, entityId, actionType: 'update', actorType: 'user', actorId: request.user.sub,
    actorDisplayName: request.user.displayName, correlationId: request.id, reasonText,
  });
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
function rtsWire(c: RightToStudyDto) { return { ...c, checkedAt: iso(c.checkedAt) }; }
function finWire(f: FinancialRegistrationDto) { return { ...f, statusUpdatedAt: iso(f.statusUpdatedAt), subject: f.subject ?? null }; }
function reWire(r: FeeStatusReassessmentDto) {
  return { ...r, proposedAt: iso(r.proposedAt), decision: r.decision ? { ...r.decision, decidedAt: iso(r.decision.decidedAt) } : null, subject: r.subject ?? null };
}
