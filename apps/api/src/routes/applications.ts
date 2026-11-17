import { Type } from '@sinclair/typebox';
import { requireAnyPermission, requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { ApplicationDto } from '../platform/admissions/application-service.js';

const ErrorSchema = Type.Object({ type: Type.String(), title: Type.String(), status: Type.Number(), detail: Type.Optional(Type.String()) });
const DateString = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' });
// Responses carry the stored records as returned; dates are ISO strings.
const ApplicationSchema = Type.Record(Type.String(), Type.Unknown());
const RecordSchema = Type.Record(Type.String(), Type.Unknown());
const Channel = Type.Union(['ucas', 'direct', 'agent', 'international-direct', 'international-agent', 'clearing'].map((c) => Type.Literal(c)));
const Conditions = Type.Array(Type.Object({
  conditionTypeCode: Type.String(), description: Type.String({ minLength: 1, maxLength: 1000 }), requiredValue: Type.Optional(Type.String({ maxLength: 200 })),
  // Structured criteria a UCAS result can be matched to (D-15).
  matchCriteria: Type.Optional(Type.Object({
    qualificationTypeCode: Type.String(), subject: Type.Optional(Type.String({ maxLength: 100 })), minimumGrade: Type.String({ maxLength: 10 }), gradeScale: Type.String({ maxLength: 60 }),
  }, { additionalProperties: false })),
}), { maxItems: 30 });

/** Applications and offers (BPR-D01, BPR-D02; BP-01-001 to BP-01-004). */
export function applicationRoutes(fastify: FastifyInstance): void {
  fastify.post('/applications', {
    schema: {
      body: Type.Object({
        channelCode: Channel, sourceReference: Type.String({ minLength: 1, maxLength: 100 }), cycle: Type.String({ minLength: 1, maxLength: 20 }),
        programmeId: Type.String(), intakeCode: Type.String({ minLength: 1, maxLength: 20 }), modeOfStudyCode: Type.String(),
        applicant: Type.Object({
          personId: Type.Optional(Type.String()), studentNumber: Type.Optional(Type.String()),
          legalFirstName: Type.String({ minLength: 1, maxLength: 100 }), legalFamilyName: Type.String({ minLength: 1, maxLength: 100 }),
          dateOfBirth: Type.Optional(DateString), emailPersonal: Type.Optional(Type.String({ maxLength: 200 })),
        }),
        payload: Type.Record(Type.String(), Type.Unknown()),
      }),
      response: { 200: ApplicationSchema, 201: ApplicationSchema, 404: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('application:receive')],
  }, async (request, reply) => {
    const { application, created } = await fastify.applicationService.receive(request.tenantId, request.body as never, request.user.sub);
    if (created) await audit(fastify, request, 'student_application', application.id, 'create', `Received ${application.channelCode} application ${application.sourceReference}`);
    await reply.code(created ? 201 : 200).send(wire(application));
  });

  fastify.get('/applications', {
    schema: { response: { 200: Type.Array(RecordSchema) } },
    preHandler: [requirePermission('application:read')],
  }, async (request, reply) => {
    await reply.send((await fastify.applicationService.worklist(request.tenantId)).map(wire));
  });

  fastify.get('/applications/:applicationId', {
    schema: { params: Type.Object({ applicationId: Type.String() }), response: { 200: ApplicationSchema, 404: ErrorSchema } },
    preHandler: [requirePermission('application:read')],
  }, async (request, reply) => {
    const { applicationId } = request.params as { applicationId: string };
    await reply.send(wire(await fastify.applicationService.get(request.tenantId, applicationId)));
  });

  const action = (
    path: string, permission: string, body: ReturnType<typeof Type.Object>,
    run: (request: FastifyRequest, id: string) => Promise<unknown>, describe: (id: string) => [string, string],
  ) => {
    fastify.post(path, {
      schema: { params: Type.Object({ id: Type.String() }), body, response: { 200: RecordSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema } },
      preHandler: [requirePermission(permission as never)],
    }, async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await run(request, id);
      const [entityType, reason] = describe(id);
      await audit(fastify, request, entityType, id, 'update', reason);
      await reply.send(wire(result));
    });
  };

  action('/applications/:id/identity', 'application:write', Type.Object({ personId: Type.String() }),
    (r, id) => fastify.applicationService.resolveIdentity(r.tenantId, id, (r.body as { personId: string }).personId),
    () => ['student_application', 'Applicant identity confirmed']);
  action('/applications/:id/routing', 'application:write',
    Type.Object({ reasonCode: Type.Union([Type.Literal('incomplete'), Type.Literal('duplicate'), Type.Literal('restricted'), Type.Null()]) }),
    (r, id) => fastify.applicationService.route(r.tenantId, id, (r.body as { reasonCode: 'incomplete' | 'duplicate' | 'restricted' | null }).reasonCode),
    () => ['student_application', 'Routed']);
  action('/applications/:id/assessments', 'application:assess', Type.Object({
    assessmentTypeCode: Type.String(), outcomeCode: Type.String(), evidenceRef: Type.Optional(Type.String({ maxLength: 200 })),
    evidenceVersion: Type.Optional(Type.String({ maxLength: 50 })), note: Type.Optional(Type.String({ maxLength: 2000 })),
  }), (r, id) => fastify.applicationService.assess(r.tenantId, id, r.body as never, r.user.sub), () => ['student_application', 'Assessment recorded']);
  action('/applications/:id/recommendation', 'application:write', Type.Object({
    recommendationCode: Type.Union([Type.Literal('offer'), Type.Literal('reject')]), reason: Type.String({ minLength: 1, maxLength: 2000 }),
  }), (r, id) => fastify.applicationService.recommend(r.tenantId, id, r.body as never, r.user.sub), () => ['student_application', 'Recommendation recorded']);
  action('/applications/:id/decision', 'offer:decide', Type.Object({
    decisionCode: Type.Union([Type.Literal('offer'), Type.Literal('reject')]), reason: Type.Optional(Type.String({ maxLength: 2000 })),
    offer: Type.Optional(Type.Object({
      offerTypeCode: Type.Union([Type.Literal('conditional'), Type.Literal('unconditional')]), feeStatusBasisCode: Type.Optional(Type.String()),
      expiresOn: Type.Optional(DateString), conditions: Type.Optional(Conditions),
    })),
  }), (r, id) => fastify.applicationService.decide(r.tenantId, id, r.body as never, r.user.sub), () => ['student_application', 'Decision recorded']);

  action('/admissions-offers/:id/response', 'application:receive', Type.Object({
    responseCode: Type.Union([Type.Literal('accept'), Type.Literal('decline')]), sourceTimestamp: Type.String({ format: 'date-time' }),
  }), (r, id) => fastify.applicationService.respond(r.tenantId, id, r.body as never), () => ['admissions_offer', 'Applicant response']);
  action('/admissions-offers/:id/change', 'offer:decide', Type.Object({
    reason: Type.String({ minLength: 1, maxLength: 2000 }), programmeId: Type.Optional(Type.String()), modeOfStudyCode: Type.Optional(Type.String()),
    offerTypeCode: Type.Optional(Type.Union([Type.Literal('conditional'), Type.Literal('unconditional')])),
    expiresOn: Type.Optional(DateString), conditions: Type.Optional(Conditions),
  }), (r, id) => fastify.applicationService.changeOffer(r.tenantId, id, r.body as never, r.user.sub), () => ['admissions_offer', 'Offer changed (new version)']);
  action('/admissions-offers/:id/withdrawal', 'offer:decide', Type.Object({}),
    (r, id) => fastify.applicationService.withdrawOffer(r.tenantId, id), () => ['admissions_offer', 'Offer withdrawn']);
  action('/admissions-offers/:id/confirmation', 'offer:decide', Type.Object({
    decisionCode: Type.Union([Type.Literal('confirmed'), Type.Literal('confirmed-alternative'), Type.Literal('unsuccessful')]),
    alternativeProgrammeId: Type.Optional(Type.String()), reason: Type.Optional(Type.String({ maxLength: 2000 })),
  }), (r, id) => fastify.applicationService.confirm(r.tenantId, id, r.body as never, r.user.sub), () => ['admissions_offer', 'Confirmation decision']);

  action('/offer-conditions/:id/evidence', 'application:receive', Type.Object({
    provenanceCode: Type.String(), evidenceRef: Type.String({ minLength: 1, maxLength: 200 }),
    reportedValue: Type.Optional(Type.String({ maxLength: 200 })), verified: Type.Optional(Type.Boolean()),
  }), (r, id) => fastify.applicationService.recordEvidence(r.tenantId, id, r.body as never, r.user.sub), () => ['offer_condition', 'Evidence recorded']);
  action('/offer-conditions/:id/decision', 'offer:decide', Type.Object({
    statusCode: Type.Union([Type.Literal('met'), Type.Literal('waived'), Type.Literal('unmet')]), note: Type.Optional(Type.String({ maxLength: 2000 })),
  }), (r, id) => fastify.applicationService.decideCondition(r.tenantId, id, r.body as never, r.user.sub), () => ['offer_condition', 'Condition decided']);

  // Applicant conversion (BP-01-007, BP-02-001; D-10): completing the hand-off creates the enrolment.
  const Conversion = Type.Record(Type.String(), Type.Unknown());
  fastify.get('/applications/:applicationId/enrolment-conversion', {
    schema: { params: Type.Object({ applicationId: Type.String() }), response: { 200: Conversion, 404: ErrorSchema } },
    preHandler: [requirePermission('enrolment:write')],
  }, async (request, reply) => {
    const { applicationId } = request.params as { applicationId: string };
    await reply.send(await fastify.applicantConversionService.preview(request.tenantId, applicationId));
  });

  fastify.post('/applications/:applicationId/enrolment-conversion', {
    schema: {
      params: Type.Object({ applicationId: Type.String() }),
      body: Type.Object({ startDate: Type.Optional(Type.String({ format: 'date' })) }),
      response: { 200: Conversion, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('enrolment:write')],
  }, async (request, reply) => {
    const { applicationId } = request.params as { applicationId: string };
    const result = await fastify.applicantConversionService.convert(request.tenantId, applicationId, request.body as { startDate?: string }, request.user.sub);
    await audit(fastify, request, 'enrolment', result.enrolmentId!, 'create', `Enrolment created in pre-registration from the confirmed offer on application ${applicationId}`);
    await reply.send(result);
  });

  // Clearing (BP-01-006; D-13).
  const ClearingJson = Type.Record(Type.String(), Type.Unknown());
  fastify.get('/clearing/status', {
    schema: { response: { 200: ClearingJson } },
    preHandler: [requireAnyPermission('clearing:decide', 'clearing:review')],
  }, async (request, reply) => {
    await reply.send(await fastify.clearingService.status(request.tenantId));
  });

  fastify.post('/clearing/calls', {
    schema: {
      body: Type.Object({
        callReference: Type.String({ minLength: 1, maxLength: 100 }), reason: Type.String({ minLength: 1, maxLength: 2000 }),
        cycle: Type.String({ minLength: 4, maxLength: 10 }), ucasPersonalId: Type.Optional(Type.String({ pattern: '^\\d{10}$' })),
        applicant: Type.Object({
          legalFirstName: Type.String({ minLength: 1 }), legalFamilyName: Type.String({ minLength: 1 }),
          dateOfBirth: Type.Optional(Type.String({ format: 'date' })), emailPersonal: Type.Optional(Type.String()),
          personId: Type.Optional(Type.String()), studentNumber: Type.Optional(Type.String()),
        }),
        programmeId: Type.String(), intakeCode: Type.String({ pattern: '^\\d{4}-\\d{2}$' }), modeOfStudyCode: Type.String(),
        declarations: Type.Object({
          safeguardingConcern: Type.Boolean(), convictionDeclared: Type.Boolean(), fitnessToPractiseRequired: Type.Boolean(), studentVisaRequired: Type.Boolean(),
        }),
        offer: Type.Object({
          offerTypeCode: Type.Union([Type.Literal('clearing-verbal'), Type.Literal('conditional'), Type.Literal('unconditional')]),
          feeStatusBasisCode: Type.Optional(Type.String()),
          conditions: Type.Optional(Type.Array(Type.Object({ conditionTypeCode: Type.String(), description: Type.String(), requiredValue: Type.Optional(Type.String()) }), { maxItems: 30 })),
        }),
      }),
      response: { 201: ClearingJson, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('clearing:decide')],
  }, async (request, reply) => {
    const result = await fastify.clearingService.takeCall(request.tenantId, request.body as never, request.user.sub);
    await audit(fastify, request, 'student_application', result.application.id, 'update', `Clearing decision on call ${(request.body as { callReference: string }).callReference}: assessed, recommended and offered in one step`);
    await reply.code(201).send({ application: wire(result.application), reviewCaseId: result.reviewCaseId });
  });

  fastify.get('/clearing/reviews', {
    schema: { querystring: Type.Object({ pending: Type.Optional(Type.Boolean()) }), response: { 200: Type.Array(ClearingJson) } },
    preHandler: [requireAnyPermission('clearing:decide', 'clearing:review')],
  }, async (request, reply) => {
    const { pending } = request.query as { pending?: boolean };
    await reply.send(await fastify.clearingService.listReviews(request.tenantId, pending ? { pending: true } : {}));
  });

  fastify.post('/clearing/reviews/:caseId', {
    schema: {
      params: Type.Object({ caseId: Type.String() }),
      body: Type.Object({ outcomeCode: Type.Union([Type.Literal('upheld'), Type.Literal('correction-needed')]), note: Type.Optional(Type.String({ maxLength: 2000 })) }),
      response: { 200: ClearingJson, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('clearing:review')],
  }, async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const reviewed = await fastify.clearingService.review(request.tenantId, caseId, request.body as never, request.user.sub);
    await audit(fastify, request, 'business_case', caseId, 'update', `Clearing decision reviewed: ${reviewed.review?.outcomeCode ?? ''}`);
    await reply.send(reviewed);
  });
}

async function audit(fastify: FastifyInstance, request: FastifyRequest, entityType: string, entityId: string, actionType: 'create' | 'update', reasonText: string) {
  await fastify.audit.record({
    tenantId: request.tenantId, entityType, entityId, actionType, actorType: 'user', actorId: request.user.sub,
    actorDisplayName: request.user.displayName, correlationId: request.id, reasonText,
  });
}

/** JSON-safe copy: Dates as ISO strings, tenant IDs dropped. */
function wire(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value, (key, v: unknown) => (key === 'tenantId' ? undefined : v))) as Record<string, unknown>;
}

export type { ApplicationDto };
