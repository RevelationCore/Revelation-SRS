import { Type } from '@sinclair/typebox';
import { requirePermission, requireAnyPermission } from '@revelation-srs/auth';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { clockNow } from '../platform/clock.js';
import type {
  ChangeRequestDto,
  CreateModuleRegistrationInput,
  ModuleRegistrationDto,
  TimetableRegistrationDto,
} from '../platform/registration/service.js';

const ModuleRegistrationSchema = Type.Object({
  moduleRegistrationId: Type.String(),
  enrolmentId:          Type.String(),
  moduleOfferingId:     Type.String(),
  moduleId:             Type.String(),
  moduleCode:           Type.String(),
  moduleTitle:          Type.String(),
  academicPeriodId:     Type.String(),
  periodCode:           Type.String(),
  creditValue:          Type.Union([Type.Number(), Type.Null()]),
  statusCode:           Type.String(),
  registrationDate:     Type.String(),
  validFrom:            Type.String(),
  validTo:              Type.Union([Type.String(), Type.Null()]),
  recordedAt:           Type.String(),
  recordedUntil:        Type.Union([Type.String(), Type.Null()]),
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
      preHandler: [requireAnyPermission('module-registration:read:own', 'module-registration:read:all')],
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
      preHandler: [requireAnyPermission('module-registration:read:own', 'module-registration:read:all')],
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
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
          422: ErrorSchema,
        },
      },
      preHandler: [requireAnyPermission('module-registration:write:own', 'module-registration:write')],
    },
    async (request, reply) => {
      const body = request.body as {
        enrolmentId: string;
        moduleOfferingId: string;
        registrationDate?: string;
        validFrom?: string;
      };

      // Students may only register within their own enrolment
      if (request.user.srsPersonId && !request.user.roles.includes('registry-administrator')) {
        const enrolment = await fastify.enrolmentService.getEnrolment(body.enrolmentId, request.tenantId);
        if (!enrolment || enrolment.personId !== request.user.srsPersonId) {
          return reply.code(403).send({
            type:   'https://srs.example.com/errors/forbidden',
            title:  'Forbidden',
            status: 403,
            detail: 'You may only register for modules within your own enrolment',
            instance: request.url,
          });
        }
      }

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
        response: { 204: Type.Null(), 403: ErrorSchema, 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requireAnyPermission('module-registration:write:own', 'module-registration:write')],
    },
    async (request, reply) => {
      const { moduleRegistrationId } = request.params as { moduleRegistrationId: string };
      const body = request.body as { validFrom?: string };

      // Students may only withdraw their own registrations
      if (request.user.srsPersonId && !request.user.roles.includes('registry-administrator')) {
        const reg = await fastify.moduleRegistrationService.getRegistration(moduleRegistrationId, request.tenantId);
        if (!reg) {
          return reply.code(404).send({
            type: 'https://srs.example.com/errors/not-found', title: 'Not Found', status: 404,
            detail: `ModuleRegistration ${moduleRegistrationId} not found`, instance: request.url,
          });
        }
        const enrolment = await fastify.enrolmentService.getEnrolment(reg.enrolmentId, request.tenantId);
        if (!enrolment || enrolment.personId !== request.user.srsPersonId) {
          return reply.code(403).send({
            type: 'https://srs.example.com/errors/forbidden', title: 'Forbidden', status: 403,
            detail: 'You may only withdraw your own module registrations', instance: request.url,
          });
        }
      }

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

  // ── Registration/withdrawal change requests (workflow-gated) ────────────────
  const ChangeRequestSchema = Type.Object({
    workflowInstanceId: Type.String(),
    workflowTaskId:      Type.String(),
    statusCode:          Type.String(),
    context:             Type.Record(Type.String(), Type.Unknown()),
    startedAt:           Type.String(),
  });

  const DecisionBody = Type.Object({
    decisionCode: Type.Union([Type.Literal('approved'), Type.Literal('rejected')]),
    reason:       Type.Optional(Type.String()),
  });

  fastify.post(
    '/module-registrations/requests',
    {
      schema: {
        body: Type.Object({
          enrolmentId:      Type.String(),
          moduleOfferingId: Type.String(),
          registrationDate: Type.Optional(Type.String()),
          reason:           Type.Optional(Type.String()),
        }),
        response: {
          202: ChangeRequestSchema,
          403: ErrorSchema, 404: ErrorSchema, 422: ErrorSchema,
        },
      },
      preHandler: [requireAnyPermission('module-registration:write:own', 'module-registration:write')],
    },
    async (request, reply) => {
      const body = request.body as {
        enrolmentId: string; moduleOfferingId: string; registrationDate?: string; reason?: string;
      };

      if (request.user.srsPersonId && !request.user.roles.includes('registry-administrator')) {
        const enrolment = await fastify.enrolmentService.getEnrolment(body.enrolmentId, request.tenantId);
        if (!enrolment || enrolment.personId !== request.user.srsPersonId) {
          return reply.code(403).send({
            type: 'https://srs.example.com/errors/forbidden', title: 'Forbidden', status: 403,
            detail: 'You may only request registration within your own enrolment', instance: request.url,
          });
        }
      }

      const input: CreateModuleRegistrationInput = {
        enrolmentId: body.enrolmentId,
        moduleOfferingId: body.moduleOfferingId,
        ...(body.registrationDate ? { registrationDate: body.registrationDate } : {}),
      };
      const changeRequest = await fastify.moduleRegistrationService.requestRegistration(
        request.tenantId, input, request.user.sub, body.reason,
      );

      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'module_registration_change_request',
        entityId: changeRequest.workflowInstanceId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });

      await reply.code(202).send(changeRequestToWire(changeRequest));
    },
  );

  fastify.post(
    '/module-registrations/:moduleRegistrationId/withdrawal-requests',
    {
      schema: {
        params: Type.Object({ moduleRegistrationId: Type.String() }),
        body:   Type.Object({ reason: Type.Optional(Type.String()) }),
        response: {
          202: ChangeRequestSchema,
          403: ErrorSchema, 404: ErrorSchema, 422: ErrorSchema,
        },
      },
      preHandler: [requireAnyPermission('module-registration:write:own', 'module-registration:write')],
    },
    async (request, reply) => {
      const { moduleRegistrationId } = request.params as { moduleRegistrationId: string };
      const { reason } = request.body as { reason?: string };

      if (request.user.srsPersonId && !request.user.roles.includes('registry-administrator')) {
        const reg = await fastify.moduleRegistrationService.getRegistration(moduleRegistrationId, request.tenantId);
        if (!reg) {
          return reply.code(404).send({
            type: 'https://srs.example.com/errors/not-found', title: 'Not Found', status: 404,
            detail: `ModuleRegistration ${moduleRegistrationId} not found`, instance: request.url,
          });
        }
        const enrolment = await fastify.enrolmentService.getEnrolment(reg.enrolmentId, request.tenantId);
        if (!enrolment || enrolment.personId !== request.user.srsPersonId) {
          return reply.code(403).send({
            type: 'https://srs.example.com/errors/forbidden', title: 'Forbidden', status: 403,
            detail: 'You may only request withdrawal of your own module registrations', instance: request.url,
          });
        }
      }

      const changeRequest = await fastify.moduleRegistrationService.requestWithdrawal(
        request.tenantId, moduleRegistrationId, request.user.sub, reason,
      );

      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'module_registration_change_request',
        entityId: changeRequest.workflowInstanceId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });

      await reply.code(202).send(changeRequestToWire(changeRequest));
    },
  );

  fastify.get(
    '/module-registration-requests',
    {
      schema: { response: { 200: Type.Array(ChangeRequestSchema) } },
      preHandler: [requirePermission('module-registration:decide')],
    },
    async (request, reply) => {
      const requests = await fastify.moduleRegistrationService.listPendingChangeRequests(request.tenantId);
      await reply.send(requests.map(changeRequestToWire));
    },
  );

  fastify.post(
    '/module-registration-requests/:workflowInstanceId/decision',
    {
      schema: {
        params:   Type.Object({ workflowInstanceId: Type.String() }),
        body:     DecisionBody,
        response: {
          200: Type.Object({ moduleRegistrationId: Type.Union([Type.String(), Type.Null()]) }),
          404: ErrorSchema, 422: ErrorSchema,
        },
      },
      preHandler: [requirePermission('module-registration:decide')],
    },
    async (request, reply) => {
      const { workflowInstanceId } = request.params as { workflowInstanceId: string };
      const { decisionCode, reason } = request.body as { decisionCode: 'approved' | 'rejected'; reason?: string };

      const result = await fastify.moduleRegistrationService.decideChangeRequest(
        request.tenantId, workflowInstanceId, decisionCode, request.user.sub, reason,
      );

      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'module_registration_change_request',
        entityId: workflowInstanceId,
        actionType: 'update',
        fieldName: 'decision_code',
        afterValue: { decisionCode },
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });

      await reply.send(result);
    },
  );
}

function changeRequestToWire(changeRequest: ChangeRequestDto) {
  return {
    ...changeRequest,
    startedAt: changeRequest.startedAt.toISOString(),
  };
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
