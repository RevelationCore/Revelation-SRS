import { Type } from '@sinclair/typebox';
import { requireSelfOrPermission } from '@revelation-srs/auth';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { ApplicantApplicationView } from '../platform/admissions/applicant-portal-service.js';

const ErrorSchema = Type.Object({ type: Type.String(), title: Type.String(), status: Type.Number(), detail: Type.Optional(Type.String()) });
const Nullable = <T extends ReturnType<typeof Type.String>>(t: T) => Type.Union([t, Type.Null()]);

/** The fixed list of fields an applicant sees (D-39); the schema strips anything else. */
const ApplicantApplicationSchema = Type.Object({
  applicationId: Type.String(),
  channelCode: Type.String(),
  cycle: Type.String(),
  programme: Type.Object({ programmeId: Nullable(Type.String()), code: Nullable(Type.String()), title: Nullable(Type.String()) }),
  intakeCode: Nullable(Type.String()),
  modeOfStudyCode: Nullable(Type.String()),
  status: Type.String({ description: 'received | under-consideration | offer-made | offer-accepted | offer-declined | conditions-met | unsuccessful | withdrawn | confirmed | confirmed-alternative' }),
  respondElsewhere: Type.Boolean({ description: 'True when the applicant replies through UCAS Hub, not this portal' }),
  offer: Type.Union([Type.Object({
    offerId: Type.String(), version: Type.Number(), offerTypeCode: Type.String(), statusCode: Type.String(),
    expiresOn: Nullable(Type.String()), responseCode: Nullable(Type.String()), respondedAt: Nullable(Type.String()),
    conditions: Type.Array(Type.Object({
      conditionId: Type.String(), description: Type.String(), requiredValue: Nullable(Type.String()), statusCode: Type.String(),
      evidence: Type.Array(Type.Object({ evidenceId: Type.String(), receivedAt: Type.String(), verified: Type.Boolean() })),
    })),
  }), Type.Null()]),
  confirmation: Type.Union([Type.Object({ outcomeCode: Type.String(), decidedAt: Type.String() }), Type.Null()]),
  cas: Type.Union([Type.Object({ statusCode: Type.String(), casNumber: Nullable(Type.String()) }), Type.Null()]),
  withdrawnAt: Nullable(Type.String()),
}, { additionalProperties: false });

/**
 * Applicant self-service (Phase 5 D-39, ADR-025). An applicant reaches
 * only their own person's applications (the srs_person_id claim); staff who
 * can read applications may preview any applicant's view.
 */
export function applicantPortalRoutes(fastify: FastifyInstance): void {
  fastify.get('/applicants/:personId/applications', {
    schema: { params: Type.Object({ personId: Type.String() }), response: { 200: Type.Array(ApplicantApplicationSchema) } },
    preHandler: [requireSelfOrPermission('application:read:own', 'application:read')],
  }, async (request, reply) => {
    const { personId } = request.params as { personId: string };
    const list = await fastify.applicantPortalService.list(request.tenantId, personId);
    await audit(fastify, request, 'person', personId, 'read', 'Applicant applications viewed');
    await reply.send(list.map(toWire));
  });

  fastify.get('/applicants/:personId/applications/:applicationId', {
    schema: { params: Type.Object({ personId: Type.String(), applicationId: Type.String() }), response: { 200: ApplicantApplicationSchema, 404: ErrorSchema } },
    preHandler: [requireSelfOrPermission('application:read:own', 'application:read')],
  }, async (request, reply) => {
    const { personId, applicationId } = request.params as { personId: string; applicationId: string };
    const view = await fastify.applicantPortalService.get(request.tenantId, personId, applicationId);
    await audit(fastify, request, 'student_application', applicationId, 'read', 'Applicant application viewed');
    await reply.send(toWire(view));
  });

  fastify.post('/applicants/:personId/offers/:offerId/response', {
    schema: {
      params: Type.Object({ personId: Type.String(), offerId: Type.String() }),
      body: Type.Object({ responseCode: Type.Union([Type.Literal('accept'), Type.Literal('decline')]) }),
      response: { 200: ApplicantApplicationSchema, 404: ErrorSchema, 409: ErrorSchema },
    },
    preHandler: [requireSelfOrPermission('offer:respond:own', 'application:receive')],
  }, async (request, reply) => {
    const { personId, offerId } = request.params as { personId: string; offerId: string };
    const { responseCode } = request.body as { responseCode: 'accept' | 'decline' };
    const view = await fastify.applicantPortalService.respond(request.tenantId, personId, offerId, responseCode, request.user.sub);
    await audit(fastify, request, 'admissions_offer', offerId, 'update', `Applicant ${responseCode === 'accept' ? 'accepted' : 'declined'} the offer in the portal`);
    await reply.send(toWire(view));
  });

  fastify.post('/applicants/:personId/conditions/:conditionId/evidence', {
    schema: {
      params: Type.Object({ personId: Type.String(), conditionId: Type.String() }),
      response: { 201: Type.Object({ evidenceId: Type.String() }), 400: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requireSelfOrPermission('condition-evidence:submit:own', 'application:write')],
  }, async (request, reply) => {
    const { personId, conditionId } = request.params as { personId: string; conditionId: string };
    const file = await request.file();
    if (!file) return reply.code(400).send({ type: 'about:blank', title: 'Bad Request', status: 400, detail: 'A multipart file field is required' });
    const result = await fastify.applicantPortalService.uploadEvidence(request.tenantId, personId, conditionId,
      { filename: file.filename, mimeType: file.mimetype, content: await file.toBuffer() }, request.user.sub);
    await audit(fastify, request, 'condition_evidence', result.evidenceId, 'create', 'Applicant uploaded condition evidence');
    return reply.code(201).send(result);
  });

  fastify.post('/applicants/:personId/applications/:applicationId/withdrawal', {
    schema: {
      params: Type.Object({ personId: Type.String(), applicationId: Type.String() }),
      body: Type.Object({ reasonCode: Type.Optional(Type.String({ maxLength: 60 })) }),
      response: { 200: ApplicantApplicationSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requireSelfOrPermission('application:withdraw:own', 'application:write')],
  }, async (request, reply) => {
    const { personId, applicationId } = request.params as { personId: string; applicationId: string };
    const { reasonCode } = request.body as { reasonCode?: string };
    const view = await fastify.applicantPortalService.withdraw(request.tenantId, personId, applicationId, reasonCode, request.user.sub);
    await audit(fastify, request, 'student_application', applicationId, 'update', 'Applicant withdrew the application');
    await reply.send(toWire(view));
  });
}

function toWire(v: ApplicantApplicationView) {
  return {
    ...v,
    offer: v.offer ? {
      ...v.offer,
      respondedAt: v.offer.respondedAt?.toISOString() ?? null,
      conditions: v.offer.conditions.map((c) => ({ ...c, evidence: c.evidence.map((e) => ({ ...e, receivedAt: e.receivedAt.toISOString() })) })),
    } : null,
    confirmation: v.confirmation ? { ...v.confirmation, decidedAt: v.confirmation.decidedAt.toISOString() } : null,
    withdrawnAt: v.withdrawnAt?.toISOString() ?? null,
  };
}

async function audit(fastify: FastifyInstance, request: FastifyRequest, entityType: string, entityId: string, actionType: 'read' | 'create' | 'update', reasonText: string): Promise<void> {
  await fastify.audit.record({
    tenantId: request.tenantId, entityType, entityId, actionType, actorType: 'user',
    actorId: request.user.sub, actorDisplayName: request.user.displayName, correlationId: request.id, reasonText,
  });
}
