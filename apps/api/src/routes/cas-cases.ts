import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { CasCaseDetailDto, RecordEligibilityCheckInput, RecordSponsorReportVersionInput } from '../platform/regulatory/cas-case-service.js';

const ErrorSchema = Type.Object({ type: Type.String(), title: Type.String(), status: Type.Number(), detail: Type.Optional(Type.String()) });
const Json = Type.Record(Type.String(), Type.Unknown());
const CaseId = Type.Object({ casCaseId: Type.String() });

/** One CAS record (BPR-D03; Phase 3 D-16). */
export function casCasesRoutes(fastify: FastifyInstance): void {
  const svc = () => fastify.casCaseService;

  fastify.get('/regulatory/cas-cases', {
    schema: {
      querystring: Type.Object({
        statusCode: Type.Optional(Type.String()), open: Type.Optional(Type.Boolean()),
        applicationId: Type.Optional(Type.String()), enrolmentId: Type.Optional(Type.String()), personId: Type.Optional(Type.String()),
      }),
      response: { 200: Type.Array(Json) },
    },
    preHandler: [requirePermission('cas:read')],
  }, async (request, reply) => {
    const q = request.query as Record<string, string | boolean | undefined>;
    const filters = Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== false));
    await reply.send((await svc().listCases(request.tenantId, filters)).map(wire));
  });

  fastify.get('/regulatory/cas-cases/:casCaseId', {
    schema: { params: CaseId, response: { 200: Json, 404: ErrorSchema } },
    preHandler: [requirePermission('cas:read')],
  }, async (request, reply) => {
    await reply.send(wire(await svc().getCase(request.tenantId, (request.params as { casCaseId: string }).casCaseId)));
  });

  fastify.post('/applications/:applicationId/cas-cases', {
    schema: { params: Type.Object({ applicationId: Type.String() }), response: { 201: Json, 404: ErrorSchema, 409: ErrorSchema } },
    preHandler: [requirePermission('cas:prepare')],
  }, async (request, reply) => {
    const { applicationId } = request.params as { applicationId: string };
    const created = await svc().openForApplication(request.tenantId, applicationId, request.user.sub);
    await audit(fastify, request, created.casCaseId, 'create', `CAS case opened for application ${applicationId}`);
    await reply.code(201).send(wire(created));
  });

  fastify.post('/enrolments/:enrolmentId/regulatory/cas-cases', {
    schema: { params: Type.Object({ enrolmentId: Type.String() }), response: { 201: Json, 404: ErrorSchema, 409: ErrorSchema } },
    preHandler: [requirePermission('cas:prepare')],
  }, async (request, reply) => {
    const { enrolmentId } = request.params as { enrolmentId: string };
    const created = await svc().openForEnrolment(request.tenantId, enrolmentId, request.user.sub);
    await audit(fastify, request, created.casCaseId, 'create', `CAS case opened for enrolment ${enrolmentId}`);
    await reply.code(201).send(wire(created));
  });

  fastify.get('/enrolments/:enrolmentId/regulatory/cas-cases', {
    schema: { params: Type.Object({ enrolmentId: Type.String() }), response: { 200: Type.Array(Json) } },
    preHandler: [requirePermission('cas:read')],
  }, async (request, reply) => {
    const { enrolmentId } = request.params as { enrolmentId: string };
    await reply.send((await svc().listCasesForEnrolment(enrolmentId, request.tenantId)).map(wire));
  });

  fastify.post('/regulatory/cas-cases/:casCaseId/eligibility-checks', {
    schema: {
      params: CaseId,
      body: Type.Object({ guidanceVersion: Type.String({ minLength: 1 }), checkTypeCode: Type.String(), resultCode: Type.String(), evidenceRef: Type.Optional(Type.String()) }),
      response: { 201: Type.Object({ checkId: Type.String() }), 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('cas:prepare')],
  }, async (request, reply) => {
    const { casCaseId } = request.params as { casCaseId: string };
    const body = request.body as RecordEligibilityCheckInput;
    await validateCode(fastify, request, 'cas_eligibility_check', 'check_type_code', body.checkTypeCode);
    await validateCode(fastify, request, 'cas_eligibility_check', 'result_code', body.resultCode);
    const checkId = await svc().recordEligibilityCheck(casCaseId, request.tenantId, body, request.user.sub);
    await audit(fastify, request, casCaseId, 'update', `Eligibility check ${body.checkTypeCode}: ${body.resultCode}`);
    await reply.code(201).send({ checkId });
  });

  const step = (path: string, permission: 'cas:prepare' | 'cas:approve', reason: string,
    run: (tenantId: string, id: string, actorId: string, body: Record<string, unknown>) => Promise<CasCaseDetailDto>, body?: ReturnType<typeof Type.Object>) => {
    fastify.post(`/regulatory/cas-cases/:casCaseId/${path}`, {
      schema: { params: CaseId, ...(body ? { body } : {}), response: { 200: Json, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema } },
      preHandler: [requirePermission(permission)],
    }, async (request, reply) => {
      const { casCaseId } = request.params as { casCaseId: string };
      const result = await run(request.tenantId, casCaseId, request.user.sub, (request.body ?? {}) as Record<string, unknown>);
      await audit(fastify, request, casCaseId, 'update', reason);
      await reply.send(wire(result));
    });
  };
  step('preparation', 'cas:prepare', 'CAS data prepared for approval', (t, id, a) => svc().prepare(t, id, a));
  step('approval', 'cas:approve', 'CAS data approved for SMS', (t, id, a) => svc().approve(t, id, a));
  step('cas-number', 'cas:prepare', 'CAS number recorded from SMS',
    (t, id, a, b) => svc().recordCasNumber(t, id, { casNumber: b['casNumber'] as string, ...(typeof b['smsReceiptRef'] === 'string' ? { smsReceiptRef: b['smsReceiptRef'] } : {}) }, a),
    Type.Object({ casNumber: Type.String({ minLength: 1 }), smsReceiptRef: Type.Optional(Type.String()) }));
  step('correction', 'cas:prepare', 'CAS reopened for a correction', (t, id, a) => svc().reopenForCorrection(t, id, a));
  step('withdrawal', 'cas:prepare', 'CAS case withdrawn', (t, id, a) => svc().withdraw(t, id, a));

  fastify.post('/regulatory/cas-cases/sms-export', {
    schema: { response: { 200: Json } },
    preHandler: [requirePermission('cas:prepare')],
  }, async (request, reply) => {
    const file = await svc().exportForSms(request.tenantId, request.user.sub);
    await fastify.audit.record({
      tenantId: request.tenantId, entityType: 'cas_case', entityId: request.tenantId, actionType: 'update', actorType: 'user', actorId: request.user.sub,
      actorDisplayName: request.user.displayName, correlationId: request.id, reasonText: `CAS SMS export: ${file.processedCount} assignment version(s)`,
    });
    await reply.send(file);
  });

  fastify.get('/regulatory/cas-cases/:casCaseId/sponsor-report-versions', {
    schema: {
      params: CaseId,
      response: {
        200: Type.Array(Type.Object({
          reportId: Type.String(), reportPayloadRef: Type.String(), distributionItemId: Type.Union([Type.String(), Type.Null()]), generatedAt: Type.String(), generatedBy: Type.String(),
        })),
        404: ErrorSchema,
      },
    },
    preHandler: [requirePermission('cas:read')],
  }, async (request, reply) => {
    const { casCaseId } = request.params as { casCaseId: string };
    const rows = await svc().listSponsorReportVersions(casCaseId, request.tenantId);
    await reply.send(rows.map((r) => ({ ...r, generatedAt: r.generatedAt.toISOString() })));
  });

  fastify.post('/regulatory/cas-cases/:casCaseId/sponsor-report-versions', {
    schema: {
      params: CaseId,
      body: Type.Object({ reportPayloadRef: Type.String(), distributionItemId: Type.Optional(Type.String()) }),
      response: { 201: Type.Object({ reportId: Type.String() }), 404: ErrorSchema },
    },
    preHandler: [requirePermission('cas:prepare')],
  }, async (request, reply) => {
    const { casCaseId } = request.params as { casCaseId: string };
    const reportId = await svc().recordSponsorReportVersion(casCaseId, request.tenantId, request.body as RecordSponsorReportVersionInput, request.user.sub);
    await audit(fastify, request, casCaseId, 'update', 'Sponsor report version recorded');
    await reply.code(201).send({ reportId });
  });
}

async function validateCode(fastify: FastifyInstance, request: FastifyRequest, entity: string, field: string, code: string) {
  const ok = await fastify.valueSetService.validateFieldValue(entity, field, code, request.tenantId);
  if (ok === false) {
    const { ValidationError } = await import('@revelation-srs/domain');
    throw new ValidationError(`Invalid ${field.replace(/_/g, ' ')} '${code}'`);
  }
}

async function audit(fastify: FastifyInstance, request: FastifyRequest, entityId: string, actionType: 'create' | 'update', reasonText: string) {
  await fastify.audit.record({
    tenantId: request.tenantId, entityType: 'cas_case', entityId, actionType, actorType: 'user', actorId: request.user.sub,
    actorDisplayName: request.user.displayName, correlationId: request.id, reasonText,
  });
}

function wire(c: CasCaseDetailDto) {
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
  return {
    ...c, openedAt: iso(c.openedAt), validFrom: iso(c.validFrom), validTo: iso(c.validTo), recordedAt: iso(c.recordedAt), recordedUntil: iso(c.recordedUntil),
    eligibilityChecks: c.eligibilityChecks.map((k) => ({ ...k, checkedAt: iso(k.checkedAt) })),
    assignmentVersions: c.assignmentVersions.map((v) => ({ ...v, approvedAt: iso(v.approvedAt), smsRequestSentAt: iso(v.smsRequestSentAt) })),
  };
}
