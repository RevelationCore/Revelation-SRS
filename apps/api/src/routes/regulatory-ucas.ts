import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

import type {
  UcasApplicationDto,
  UcasApplicationPayload,
  UcasConfirmationPayload,
} from '../platform/regulatory/ucas-service.js';

const ErrorSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const UcasApplicationSchema = Type.Object({
  applicationId:     Type.String(),
  ucasPersonalId:    Type.String(),
  cycle:             Type.String(),
  statusCode:        Type.String(),
  linkedEnrolmentId: Type.Union([Type.String(), Type.Null()]),
  receivedAt:        Type.String(),
  validFrom:         Type.String(),
  recordedAt:        Type.String(),
});

const UcasConfirmationSchema = Type.Object({
  triggerId:        Type.String(),
  enrolmentId:      Type.String(),
  ucasPersonalId:   Type.String(),
  confirmationType: Type.Union([
    Type.Literal('enrolled'),
    Type.Literal('withdrawn'),
    Type.Literal('deferred'),
  ]),
  confirmedAt:      Type.String(),
});

const UcasConfirmationPayloadSchema = Type.Object({
  cycle: Type.String(),
  confirmations: Type.Array(UcasConfirmationSchema),
});

const UcasApplicationBody = Type.Object({
  ucasPersonalId: Type.String({ minLength: 1 }),
  cycle: Type.String({ minLength: 1 }),
  statusCode: Type.String({ minLength: 1 }),
  applicant: Type.Optional(Type.Object({
    givenNames: Type.Optional(Type.String()),
    familyName: Type.Optional(Type.String()),
    dateOfBirth: Type.Optional(Type.String()),
    email: Type.Optional(Type.String()),
  })),
  enrolment: Type.Optional(Type.Object({
    programmeId: Type.Optional(Type.String()),
    modeOfStudyCode: Type.Optional(Type.String()),
    attendanceTypeCode: Type.Optional(Type.String()),
    academicYearOfEntry: Type.Optional(Type.String()),
    startDate: Type.Optional(Type.String()),
    expectedEndDate: Type.Optional(Type.String()),
    feeBandCode: Type.Optional(Type.String()),
    fundingSourceCode: Type.Optional(Type.String()),
    slcReference: Type.Optional(Type.String()),
    ukviCasRequired: Type.Optional(Type.Boolean()),
  })),
  legalFirstName: Type.Optional(Type.String()),
  legalFamilyName: Type.Optional(Type.String()),
  dateOfBirth: Type.Optional(Type.String()),
  emailPersonal: Type.Optional(Type.String()),
  programmeId: Type.Optional(Type.String()),
  modeOfStudyCode: Type.Optional(Type.String()),
  attendanceTypeCode: Type.Optional(Type.String()),
  academicYearOfEntry: Type.Optional(Type.String()),
  startDate: Type.Optional(Type.String()),
  expectedEndDate: Type.Optional(Type.String()),
  feeBandCode: Type.Optional(Type.String()),
  fundingSourceCode: Type.Optional(Type.String()),
  slcReference: Type.Optional(Type.String()),
  ukviCasRequired: Type.Optional(Type.Boolean()),
}, { additionalProperties: true });

export function regulatoryUcasRoutes(fastify: FastifyInstance): void {
  fastify.post(
    '/regulatory/ucas/applications',
    {
      schema: {
        body: UcasApplicationBody,
        response: {
          201: Type.Object({
            applicationId: Type.String(),
            linkedEnrolmentId: Type.Union([Type.String(), Type.Null()]),
          }),
          422: ErrorSchema,
        },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const result = await fastify.ucasService.ingestApplication(
        request.tenantId,
        request.body as UcasApplicationPayload,
        request.user.sub,
      );

      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'ucas_application',
        entityId: result.applicationId,
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
    '/regulatory/ucas/applications',
    {
      schema: {
        querystring: Type.Object({
          cycle: Type.Optional(Type.String()),
          statusCode: Type.Optional(Type.String()),
        }),
        response: { 200: Type.Array(UcasApplicationSchema) },
      },
      preHandler: [requirePermission('regulatory:read')],
    },
    async (request, reply) => {
      const query = request.query as { cycle?: string; statusCode?: string };
      const applications = await fastify.ucasService.listApplications(request.tenantId, query);
      await reply.send(applications.map(applicationToWire));
    },
  );

  fastify.post(
    '/regulatory/ucas/applications/:applicationId/link',
    {
      schema: {
        params: Type.Object({ applicationId: Type.String() }),
        body: Type.Object({ enrolmentId: Type.String() }),
        response: { 204: Type.Null(), 404: ErrorSchema },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const { applicationId } = request.params as { applicationId: string };
      const { enrolmentId } = request.body as { enrolmentId: string };
      await fastify.ucasService.linkApplicationToEnrolment(applicationId, enrolmentId, request.tenantId);

      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'ucas_application',
        entityId: applicationId,
        actionType: 'update',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });

      await reply.code(204).send();
    },
  );

  fastify.post(
    '/regulatory/ucas/confirmations/generate',
    {
      schema: {
        body: Type.Object({ cycle: Type.String({ minLength: 1 }) }),
        response: {
          200: Type.Object({
            processedCount: Type.Number(),
            payload: UcasConfirmationPayloadSchema,
          }),
        },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const { cycle } = request.body as { cycle: string };
      const result = await fastify.ucasService.generateOutboundConfirmations(
        request.tenantId,
        cycle,
        request.user.sub,
      );

      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'integration_exchange',
        entityId: crypto.randomUUID(),
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });

      await reply.send(result);
    },
  );
}

function applicationToWire(application: UcasApplicationDto) {
  return {
    applicationId: application.applicationId,
    ucasPersonalId: application.ucasPersonalId,
    cycle: application.cycle,
    statusCode: application.statusCode,
    linkedEnrolmentId: application.linkedEnrolmentId,
    receivedAt: application.receivedAt.toISOString(),
    validFrom: application.validFrom.toISOString(),
    recordedAt: application.recordedAt.toISOString(),
  };
}

export type { UcasConfirmationPayload };
