import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { clockNow } from '../platform/clock.js';
import type {
  CreateModuleRegistrationInput,
  ModuleRegistrationDto,
  TimetableRegistrationDto,
} from '../platform/registration/service.js';

const ModuleRegistrationSchema = Type.Object({
  moduleRegistrationId: Type.String(),
  enrolmentId: Type.String(),
  moduleOfferingId: Type.String(),
  moduleId: Type.String(),
  academicPeriodId: Type.String(),
  statusCode: Type.String(),
  registrationDate: Type.String(),
  validFrom: Type.String(),
  validTo: Type.Union([Type.String(), Type.Null()]),
  recordedAt: Type.String(),
  recordedUntil: Type.Union([Type.String(), Type.Null()]),
});

const TimetableRegistrationSchema = Type.Object({
  moduleRegistrationId: Type.String(),
  enrolmentId: Type.String(),
  moduleOfferingId: Type.String(),
  moduleId: Type.String(),
  moduleCode: Type.String(),
  moduleTitle: Type.String(),
  academicPeriodId: Type.String(),
  academicYear: Type.String(),
  periodCode: Type.String(),
  periodTypeCode: Type.String(),
  startDate: Type.String(),
  endDate: Type.String(),
  deliveryModeCode: Type.Union([Type.String(), Type.Null()]),
});

const ErrorSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const TransitionBody = Type.Object({
  validFrom: Type.Optional(Type.String({ format: 'date-time' })),
});

export function moduleRegistrationsRoutes(fastify: FastifyInstance): void {
  fastify.get(
    '/module-registrations',
    {
      schema: {
        querystring: Type.Object({
          enrolmentId: Type.Optional(Type.String()),
          moduleOfferingId: Type.Optional(Type.String()),
          statusCode: Type.Optional(Type.String()),
        }),
        response: { 200: Type.Array(ModuleRegistrationSchema) },
      },
      preHandler: [requirePermission('module-registration:read:all')],
    },
    async (request, reply) => {
      const query = request.query as { enrolmentId?: string; moduleOfferingId?: string; statusCode?: string };
      const opts: { enrolmentId?: string; moduleOfferingId?: string; statusCode?: string } = {};
      if (query.enrolmentId !== undefined) opts.enrolmentId = query.enrolmentId;
      if (query.moduleOfferingId !== undefined) opts.moduleOfferingId = query.moduleOfferingId;
      if (query.statusCode !== undefined) opts.statusCode = query.statusCode;

      const registrations = await fastify.moduleRegistrationService.listRegistrations(request.tenantId, opts);
      await reply.send(registrations.map(moduleRegistrationToWire));
    },
  );

  fastify.get(
    '/module-registrations/timetable',
    {
      schema: {
        querystring: Type.Object({ enrolmentId: Type.String() }),
        response: { 200: Type.Array(TimetableRegistrationSchema) },
      },
      preHandler: [requirePermission('module-registration:read:all')],
    },
    async (request, reply) => {
      const { enrolmentId } = request.query as { enrolmentId: string };
      const registrations = await fastify.moduleRegistrationService.listTimetableRegistrations(
        request.tenantId,
        enrolmentId,
      );
      await reply.send(registrations.map(timetableRegistrationToWire));
    },
  );

  fastify.post(
    '/module-registrations',
    {
      schema: {
        body: Type.Object({
          enrolmentId: Type.String(),
          moduleOfferingId: Type.String(),
          registrationDate: Type.Optional(Type.String()),
          validFrom: Type.Optional(Type.String({ format: 'date-time' })),
        }),
        response: {
          201: Type.Object({ moduleRegistrationId: Type.String() }),
          404: ErrorSchema,
          409: ErrorSchema,
          422: ErrorSchema,
        },
      },
      preHandler: [requirePermission('module-registration:write')],
    },
    async (request, reply) => {
      const body = request.body as {
        enrolmentId: string;
        moduleOfferingId: string;
        registrationDate?: string;
        validFrom?: string;
      };
      const input: CreateModuleRegistrationInput = {
        enrolmentId: body.enrolmentId,
        moduleOfferingId: body.moduleOfferingId,
        ...(body.validFrom ? { validFrom: new Date(body.validFrom) } : {}),
        ...(body.registrationDate ? { registrationDate: body.registrationDate } : {}),
      };
      const moduleRegistrationId = await fastify.moduleRegistrationService.createRegistration(
        request.tenantId,
        input,
        request.user.sub,
      );

      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'module_registration',
        entityId: moduleRegistrationId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });

      await reply.code(201).send({ moduleRegistrationId });
    },
  );

  fastify.get(
    '/module-registrations/:moduleRegistrationId/history',
    {
      schema: {
        params: Type.Object({ moduleRegistrationId: Type.String() }),
        response: { 200: Type.Array(ModuleRegistrationSchema) },
      },
      preHandler: [requirePermission('module-registration:read:all')],
    },
    async (request, reply) => {
      const { moduleRegistrationId } = request.params as { moduleRegistrationId: string };
      const history = await fastify.moduleRegistrationService.getRegistrationHistory(
        moduleRegistrationId,
        request.tenantId,
      );
      await reply.send(history.map(moduleRegistrationToWire));
    },
  );

  fastify.get(
    '/module-registrations/:moduleRegistrationId',
    {
      schema: {
        params: Type.Object({ moduleRegistrationId: Type.String() }),
        response: { 200: ModuleRegistrationSchema, 404: ErrorSchema },
      },
      preHandler: [requirePermission('module-registration:read:all')],
    },
    async (request, reply) => {
      const { moduleRegistrationId } = request.params as { moduleRegistrationId: string };
      const registration = await fastify.moduleRegistrationService.getRegistration(
        moduleRegistrationId,
        request.tenantId,
      );

      if (!registration) {
        return reply.code(404).send({
          type: 'https://srs.example.com/errors/not-found',
          title: 'Not Found',
          status: 404,
          detail: `ModuleRegistration '${moduleRegistrationId}' not found`,
        });
      }

      await reply.send(moduleRegistrationToWire(registration));
    },
  );

  fastify.post(
    '/module-registrations/:moduleRegistrationId/withdrawal',
    {
      schema: {
        params: Type.Object({ moduleRegistrationId: Type.String() }),
        body: TransitionBody,
        response: { 204: Type.Null(), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('module-registration:write')],
    },
    async (request, reply) => {
      const { moduleRegistrationId } = request.params as { moduleRegistrationId: string };
      const body = request.body as { validFrom?: string };
      await fastify.moduleRegistrationService.withdrawRegistration(
        moduleRegistrationId,
        request.tenantId,
        request.user.sub,
        body.validFrom ? new Date(body.validFrom) : clockNow(),
      );

      await recordRegistrationStatusAudit(fastify, request, moduleRegistrationId, 'withdrawn');
      await reply.code(204).send();
    },
  );

  fastify.post(
    '/module-registrations/:moduleRegistrationId/completion',
    {
      schema: {
        params: Type.Object({ moduleRegistrationId: Type.String() }),
        body: TransitionBody,
        response: { 204: Type.Null(), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('module-registration:write')],
    },
    async (request, reply) => {
      const { moduleRegistrationId } = request.params as { moduleRegistrationId: string };
      const body = request.body as { validFrom?: string };
      await fastify.moduleRegistrationService.completeRegistration(
        moduleRegistrationId,
        request.tenantId,
        request.user.sub,
        body.validFrom ? new Date(body.validFrom) : clockNow(),
      );

      await recordRegistrationStatusAudit(fastify, request, moduleRegistrationId, 'completed');
      await reply.code(204).send();
    },
  );
}

async function recordRegistrationStatusAudit(
  fastify: FastifyInstance,
  request: FastifyRequest,
  moduleRegistrationId: string,
  statusCode: string,
): Promise<void> {
  await fastify.audit.record({
    tenantId: request.tenantId,
    entityType: 'module_registration',
    entityId: moduleRegistrationId,
    fieldName: 'status_code',
    afterValue: { statusCode },
    actionType: 'update',
    actorType: 'user',
    actorId: request.user.sub,
    actorDisplayName: request.user.displayName,
    correlationId: request.id,
  });
}

function moduleRegistrationToWire(registration: ModuleRegistrationDto) {
  return {
    ...registration,
    validFrom: registration.validFrom.toISOString(),
    validTo: registration.validTo?.toISOString() ?? null,
    recordedAt: registration.recordedAt.toISOString(),
    recordedUntil: registration.recordedUntil?.toISOString() ?? null,
  };
}

function timetableRegistrationToWire(registration: TimetableRegistrationDto) {
  return registration;
}
