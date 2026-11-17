import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import { hasPermission } from '@revelation-srs/domain';
import type { RecognisedCredit, RuleException } from '@revelation-srs/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { PublicationDto } from '../platform/curriculum/publication-service.js';

const ErrorSchema = Type.Object({ type: Type.String(), title: Type.String(), status: Type.Number(), detail: Type.Optional(Type.String()) });
const Nullable = <T extends ReturnType<typeof Type.String>>(t: T) => Type.Union([t, Type.Null()]);
const NullableInt = Type.Union([Type.Integer(), Type.Null()]);
const DateString = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' });

const PublicationSchema = Type.Object({
  publicationId: Type.String(), sourceSystemCode: Type.String(), sourcePublicationRef: Type.String(),
  publicationVersion: Type.String(), approvalRef: Nullable(Type.String()), effectiveFrom: Type.String(), statusCode: Type.String(),
  counts: Type.Object({ added: Type.Integer(), changed: Type.Integer(), closed: Type.Integer(), unchanged: Type.Integer(), rejected: Type.Integer() }),
  affectsStudents: Type.Integer(),
  receivedBy: Type.String(), receivedAt: Type.String(), appliedBy: Nullable(Type.String()), appliedAt: Nullable(Type.String()),
  items: Type.Array(Type.Object({
    itemId: Type.String(), objectTypeCode: Type.String(), objectCode: Type.String(), sourceReference: Nullable(Type.String()),
    changeTypeCode: Type.String(), issue: Nullable(Type.String()), appliedEntityId: Nullable(Type.String()), affectsStudents: Type.Integer(),
  })),
});

const ProgrammeItem = Type.Object({
  code: Type.String({ maxLength: 50 }), sourceReference: Type.Optional(Type.String()), closed: Type.Optional(Type.Boolean()),
  title: Type.Optional(Type.String({ maxLength: 300 })), qualificationTypeCode: Type.Optional(Type.String()),
  owningSchool: Type.Optional(Type.String()), creditFrameworkCode: Type.Optional(Type.String()),
  fheqLevel: Type.Optional(Type.Integer()), creditTotal: Type.Optional(Type.Integer()),
  durationYears: Type.Optional(Type.Integer()), modeOfStudyCode: Type.Optional(Type.String()),
}, { additionalProperties: false });
// Phase 3 D-22: routes, rule sets (with groups and members), learning outcomes and offerings.
const Opt = <T extends Parameters<typeof Type.Optional>[0]>(t: T) => Type.Optional(t);
const RouteItem = Type.Object({
  programmeCode: Type.String({ maxLength: 50 }), routeCode: Type.String({ maxLength: 50 }), sourceReference: Opt(Type.String()), closed: Opt(Type.Boolean()),
  title: Opt(Type.String({ maxLength: 300 })),
}, { additionalProperties: false });
const MemberItem = Type.Object({ moduleCode: Type.String({ maxLength: 50 }), closed: Opt(Type.Boolean()), isDefault: Opt(Type.Boolean()), isNonCondonable: Opt(Type.Boolean()) }, { additionalProperties: false });
const GroupItem = Type.Object({
  groupCode: Type.String({ maxLength: 50 }), closed: Opt(Type.Boolean()), title: Opt(Type.String({ maxLength: 300 })),
  groupTypeCode: Opt(Type.Union([Type.Literal('compulsory'), Type.Literal('optional-pool'), Type.Literal('elective-pool')])), fheqLevel: Opt(Type.Integer()),
  minModules: Opt(Type.Integer()), maxModules: Opt(Type.Integer()), minCredits: Opt(Type.Integer()), maxCredits: Opt(Type.Integer()),
  minFheqLevel: Opt(Type.Integer()), maxFheqLevel: Opt(Type.Integer()), members: Opt(Type.Array(MemberItem, { maxItems: 200 })),
}, { additionalProperties: false });
const RuleSetItem = Type.Object({
  programmeCode: Type.String({ maxLength: 50 }), ruleSetCode: Type.String({ maxLength: 50 }), routeCode: Opt(Type.String()), entryAcademicYear: Opt(Type.String()),
  description: Opt(Type.String({ maxLength: 2000 })), sourceReference: Opt(Type.String()), closed: Opt(Type.Boolean()), groups: Opt(Type.Array(GroupItem, { maxItems: 100 })),
}, { additionalProperties: false });
const OutcomeItem = Type.Object({
  ownerType: Type.Union([Type.Literal('programme'), Type.Literal('module')]), ownerCode: Type.String({ maxLength: 50 }), outcomeCode: Type.String({ maxLength: 50 }),
  description: Opt(Type.String({ maxLength: 2000 })), sourceReference: Opt(Type.String()), closed: Opt(Type.Boolean()),
}, { additionalProperties: false });
const OfferingItem = Type.Object({
  moduleCode: Type.String({ maxLength: 50 }), academicYear: Type.String({ pattern: '^\\d{4}-\\d{2}$' }), periodCode: Type.String({ maxLength: 50 }),
  deliveryModeCode: Opt(Type.String()), capacity: Opt(Type.Integer()), sourceReference: Opt(Type.String()), closed: Opt(Type.Boolean()),
}, { additionalProperties: false });
const ModuleItem = Type.Object({
  code: Type.String({ maxLength: 50 }), sourceReference: Type.Optional(Type.String()), closed: Type.Optional(Type.Boolean()),
  title: Type.Optional(Type.String({ maxLength: 300 })), creditValue: Type.Optional(Type.Integer()), fheqLevel: Type.Optional(Type.Integer()),
}, { additionalProperties: false });

const CreditSchema = Type.Object({
  recognisedCreditId: Type.String(), enrolmentId: Type.String(), recognitionTypeCode: Type.String(), sourceDescription: Type.String(),
  creditValue: Type.Integer(), fheqLevel: NullableInt, moduleId: Nullable(Type.String()), statusCaseId: Nullable(Type.String()),
  evidenceRef: Nullable(Type.String()), academicYear: Nullable(Type.String()), statusCode: Type.String(), createdBy: Type.String(), createdAt: Type.String(),
  decidedBy: Nullable(Type.String()), decidedAt: Nullable(Type.String()), decisionReason: Nullable(Type.String()),
});
const ExceptionSchema = Type.Object({
  ruleExceptionId: Type.String(), enrolmentId: Type.String(), programmeRuleSetId: Nullable(Type.String()), ruleCode: Type.String(),
  exceptionTypeCode: Type.String(), description: Type.String(), validFrom: Type.String(), validTo: Nullable(Type.String()),
  authorityRef: Nullable(Type.String()), variationValue: Type.Union([Type.Record(Type.String(), Type.Union([Type.Number(), Type.Null()])), Type.Null()]),
  statusCode: Type.String(), createdBy: Type.String(), createdAt: Type.String(),
  decidedBy: Nullable(Type.String()), decidedAt: Nullable(Type.String()), decisionReason: Nullable(Type.String()),
});
const SubjectSchema = Type.Object({
  personId: Type.String(), studentNumber: Type.String(), studentName: Type.String(),
  programmeCode: Nullable(Type.String()), programmeTitle: Nullable(Type.String()),
});
const DecisionBody = Type.Object({
  decisionCode: Type.Union([Type.Literal('approved'), Type.Literal('rejected')]), reason: Type.String({ minLength: 1, maxLength: 2000 }),
});

/**
 * Curriculum publications (F-CM-SIS-01, BP-03-001), recognised credit and
 * rule exceptions (BPR-D05).
 */
export function curriculumPublicationRoutes(fastify: FastifyInstance): void {
  fastify.post('/curriculum-publications', {
    schema: {
      body: Type.Object({
        sourceSystemCode: Type.String({ minLength: 1, maxLength: 50 }),
        sourcePublicationRef: Type.String({ minLength: 1, maxLength: 200 }),
        publicationVersion: Type.String({ minLength: 1, maxLength: 50 }),
        approvalRef: Type.Optional(Type.String({ maxLength: 200 })),
        effectiveFrom: DateString,
        correctionRationale: Type.Optional(Type.String({ maxLength: 2000 })),
        programmes: Type.Optional(Type.Array(ProgrammeItem, { maxItems: 2000 })),
        modules: Type.Optional(Type.Array(ModuleItem, { maxItems: 5000 })),
        routes: Type.Optional(Type.Array(RouteItem, { maxItems: 2000 })),
        ruleSets: Type.Optional(Type.Array(RuleSetItem, { maxItems: 2000 })),
        learningOutcomes: Type.Optional(Type.Array(OutcomeItem, { maxItems: 10000 })),
        offerings: Type.Optional(Type.Array(OfferingItem, { maxItems: 10000 })),
      }),
      response: { 200: PublicationSchema, 201: PublicationSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('curriculum-publication:receive')],
  }, async (request, reply) => {
    const { publication, created } = await fastify.curriculumPublicationService.receive(request.tenantId, request.body as never, request.user.sub);
    if (created) await audit(fastify, request, 'curriculum_publication', publication.publicationId, 'create', `Received publication ${publication.sourcePublicationRef} (${publication.statusCode})`);
    await reply.code(created ? 201 : 200).send(publicationToWire(publication));
  });

  fastify.get('/curriculum-publications', {
    schema: { response: { 200: Type.Array(PublicationSchema) } },
    preHandler: [requirePermission('curriculum-publication:read')],
  }, async (request, reply) => {
    await reply.send((await fastify.curriculumPublicationService.list(request.tenantId)).map(publicationToWire));
  });

  fastify.get('/curriculum-publications/:publicationId', {
    schema: { params: Type.Object({ publicationId: Type.String() }), response: { 200: PublicationSchema, 404: ErrorSchema } },
    preHandler: [requirePermission('curriculum-publication:read')],
  }, async (request, reply) => {
    const { publicationId } = request.params as { publicationId: string };
    await reply.send(publicationToWire(await fastify.curriculumPublicationService.get(request.tenantId, publicationId)));
  });

  fastify.post('/curriculum-publications/:publicationId/application', {
    schema: { params: Type.Object({ publicationId: Type.String() }), response: { 200: PublicationSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema } },
    preHandler: [requirePermission('curriculum-publication:apply')],
  }, async (request, reply) => {
    const { publicationId } = request.params as { publicationId: string };
    // A publication that changes what students are bound to needs a binding approver (D-22, D-11).
    const applied = await fastify.curriculumPublicationService.apply(request.tenantId, publicationId, request.user.sub, {
      canApproveBindingChanges: hasPermission(request.user.roles, 'curriculum-binding:approve'),
    });
    await audit(fastify, request, 'curriculum_publication', publicationId, 'update', 'Applied curriculum publication');
    await reply.send(publicationToWire(applied));
  });

  // ── Approver worklist ────────────────────────────────────────────────────

  fastify.get('/academic-exceptions/pending', {
    schema: {
      response: { 200: Type.Object({
        credits: Type.Array(Type.Composite([CreditSchema, Type.Object({ subject: SubjectSchema })])),
        exceptions: Type.Array(Type.Composite([ExceptionSchema, Type.Object({ subject: SubjectSchema })])),
      }) },
    },
    preHandler: [requirePermission('academic-exception:approve')],
  }, async (request, reply) => {
    const { credits, exceptions } = await fastify.academicExceptionService.pendingApprovals(request.tenantId);
    await reply.send({
      credits: credits.map(({ subject, ...c }) => ({ ...creditToWire(c), subject })),
      exceptions: exceptions.map(({ subject, ...x }) => ({ ...exceptionToWire(x), subject })),
    });
  });

  // ── Recognised credit ────────────────────────────────────────────────────

  fastify.get('/enrolments/:enrolmentId/recognised-credits', {
    schema: { params: Type.Object({ enrolmentId: Type.String() }), response: { 200: Type.Object({ credits: Type.Array(CreditSchema), approvedCreditTotal: Type.Integer() }) } },
    preHandler: [requirePermission('academic-exception:read')],
  }, async (request, reply) => {
    const { enrolmentId } = request.params as { enrolmentId: string };
    const { credits, approvedCreditTotal } = await fastify.academicExceptionService.listCredits(request.tenantId, enrolmentId);
    await reply.send({ credits: credits.map(creditToWire), approvedCreditTotal });
  });

  fastify.post('/enrolments/:enrolmentId/recognised-credits', {
    schema: {
      params: Type.Object({ enrolmentId: Type.String() }),
      body: Type.Object({
        recognitionTypeCode: Type.String(), sourceDescription: Type.String({ minLength: 1, maxLength: 500 }),
        creditValue: Type.Integer({ minimum: 1, maximum: 720 }), fheqLevel: Type.Optional(Type.Integer({ minimum: 3, maximum: 8 })),
        moduleId: Type.Optional(Type.String()), statusCaseId: Type.Optional(Type.String()), evidenceRef: Type.Optional(Type.String({ maxLength: 200 })),
        academicYear: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}$' })),
      }),
      response: { 201: CreditSchema, 404: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('academic-exception:propose')],
  }, async (request, reply) => {
    const { enrolmentId } = request.params as { enrolmentId: string };
    const credit = await fastify.academicExceptionService.proposeCredit(request.tenantId, enrolmentId, request.body as never, request.user.sub);
    await audit(fastify, request, 'recognised_credit', credit.id, 'create', 'Proposed recognised credit');
    await reply.code(201).send(creditToWire(credit));
  });

  fastify.post('/recognised-credits/:recognisedCreditId/decision', {
    schema: { params: Type.Object({ recognisedCreditId: Type.String() }), body: DecisionBody, response: { 200: CreditSchema, 404: ErrorSchema, 409: ErrorSchema } },
    preHandler: [requirePermission('academic-exception:approve')],
  }, async (request, reply) => {
    const { recognisedCreditId } = request.params as { recognisedCreditId: string };
    const credit = await fastify.academicExceptionService.decideCredit(request.tenantId, recognisedCreditId, request.body as never, request.user.sub);
    await audit(fastify, request, 'recognised_credit', credit.id, 'update', `Recognised credit ${credit.statusCode}`);
    await reply.send(creditToWire(credit));
  });

  // ── Rule exceptions ──────────────────────────────────────────────────────

  fastify.get('/enrolments/:enrolmentId/rule-exceptions', {
    schema: { params: Type.Object({ enrolmentId: Type.String() }), response: { 200: Type.Array(ExceptionSchema) } },
    preHandler: [requirePermission('academic-exception:read')],
  }, async (request, reply) => {
    const { enrolmentId } = request.params as { enrolmentId: string };
    await reply.send((await fastify.academicExceptionService.listExceptions(request.tenantId, enrolmentId)).map(exceptionToWire));
  });

  fastify.post('/enrolments/:enrolmentId/rule-exceptions', {
    schema: {
      params: Type.Object({ enrolmentId: Type.String() }),
      body: Type.Object({
        ruleCode: Type.String({ minLength: 1, maxLength: 100 }), exceptionTypeCode: Type.String(),
        description: Type.String({ minLength: 1, maxLength: 2000 }), validFrom: DateString, validTo: Type.Optional(DateString),
        programmeRuleSetId: Type.Optional(Type.String()), authorityRef: Type.Optional(Type.String({ maxLength: 200 })),
        variationValue: Type.Optional(Type.Record(Type.String(), Type.Union([Type.Number(), Type.Null()]))),
      }),
      response: { 201: ExceptionSchema, 404: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('academic-exception:propose')],
  }, async (request, reply) => {
    const { enrolmentId } = request.params as { enrolmentId: string };
    const exception = await fastify.academicExceptionService.proposeException(request.tenantId, enrolmentId, request.body as never, request.user.sub);
    await audit(fastify, request, 'rule_exception', exception.id, 'create', 'Proposed rule exception');
    await reply.code(201).send(exceptionToWire(exception));
  });

  fastify.post('/rule-exceptions/:ruleExceptionId/decision', {
    schema: { params: Type.Object({ ruleExceptionId: Type.String() }), body: DecisionBody, response: { 200: ExceptionSchema, 404: ErrorSchema, 409: ErrorSchema } },
    preHandler: [requirePermission('academic-exception:approve')],
  }, async (request, reply) => {
    const { ruleExceptionId } = request.params as { ruleExceptionId: string };
    const exception = await fastify.academicExceptionService.decideException(request.tenantId, ruleExceptionId, request.body as never, request.user.sub);
    await audit(fastify, request, 'rule_exception', exception.id, 'update', `Rule exception ${exception.statusCode}`);
    await reply.send(exceptionToWire(exception));
  });

  fastify.post('/rule-exceptions/:ruleExceptionId/revocation', {
    schema: {
      params: Type.Object({ ruleExceptionId: Type.String() }), body: Type.Object({ reason: Type.String({ minLength: 1, maxLength: 2000 }) }),
      response: { 200: ExceptionSchema, 404: ErrorSchema, 409: ErrorSchema },
    },
    preHandler: [requirePermission('academic-exception:approve')],
  }, async (request, reply) => {
    const { ruleExceptionId } = request.params as { ruleExceptionId: string };
    const { reason } = request.body as { reason: string };
    const exception = await fastify.academicExceptionService.revokeException(request.tenantId, ruleExceptionId, reason, request.user.sub);
    await audit(fastify, request, 'rule_exception', exception.id, 'update', 'Rule exception revoked');
    await reply.send(exceptionToWire(exception));
  });
}

async function audit(fastify: FastifyInstance, request: FastifyRequest, entityType: string, entityId: string, actionType: 'create' | 'update', reasonText: string) {
  await fastify.audit.record({
    tenantId: request.tenantId, entityType, entityId, actionType, actorType: 'user', actorId: request.user.sub,
    actorDisplayName: request.user.displayName, correlationId: request.id, reasonText,
  });
}

function publicationToWire(p: PublicationDto) {
  return { ...p, receivedAt: p.receivedAt.toISOString(), appliedAt: p.appliedAt?.toISOString() ?? null };
}

function creditToWire(c: RecognisedCredit) {
  const { id, tenantId: _t, ...rest } = c;
  return { recognisedCreditId: id, ...rest, createdAt: c.createdAt.toISOString(), decidedAt: c.decidedAt?.toISOString() ?? null };
}

function exceptionToWire(e: RuleException) {
  const { id, tenantId: _t, ...rest } = e;
  return { ruleExceptionId: id, ...rest, createdAt: e.createdAt.toISOString(), decidedAt: e.decidedAt?.toISOString() ?? null };
}
