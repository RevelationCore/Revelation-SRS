import { requirePermission } from '@revelation-srs/auth';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import type {
  CorrectObservationInput,
  CreateExpectedEventInput,
  EngagementEventDto,
  EngagementObservationDto,
  RecordObservationInput,
} from '../platform/engagement/engagement-service.js';

const ErrorSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
  correlationId: Type.Optional(Type.String()),
});

const IdempotencyHeaders = Type.Object({
  'idempotency-key': Type.String({ minLength: 1, maxLength: 200 }),
});

const EventSchema = Type.Object({
  expectedEventId: Type.String(),
  personId: Type.String(),
  enrolmentId: Type.String(),
  activityTypeCode: Type.String(),
  activityReference: Type.Union([Type.String(), Type.Null()]),
  eventModeCode: Type.String(),
  scheduledFrom: Type.String(),
  scheduledTo: Type.Union([Type.String(), Type.Null()]),
  locationReference: Type.Union([Type.String(), Type.Null()]),
  sourceSystemCode: Type.String(),
  sourceEventId: Type.String(),
  sourceVersion: Type.String(),
  statusCode: Type.String(),
  validFrom: Type.String(),
  validTo: Type.Union([Type.String(), Type.Null()]),
  recordedAt: Type.String(),
});

const ObservationSchema = Type.Object({
  observationId: Type.String(),
  observationVersionId: Type.String(),
  expectedEventId: Type.Union([Type.String(), Type.Null()]),
  personId: Type.String(),
  enrolmentId: Type.String(),
  sourceSystemCode: Type.String(),
  sourceEventId: Type.String(),
  sourceVersion: Type.String(),
  captureMethodCode: Type.String(),
  outcomeCode: Type.String(),
  dataQualityCode: Type.String(),
  eventTime: Type.String(),
  receivedAt: Type.String(),
  deviceReference: Type.Union([Type.String(), Type.Null()]),
  operationalReference: Type.Union([Type.String(), Type.Null()]),
  actorId: Type.String(),
  recordedAt: Type.String(),
});

export function engagementRoutes(fastify: FastifyInstance): void {
  fastify.post(
    '/engagement/events',
    {
      schema: {
        body: Type.Object({
          personId: Type.String({ format: 'uuid' }),
          enrolmentId: Type.String({ format: 'uuid' }),
          activityTypeCode: Type.String({ minLength: 1 }),
          activityReference: Type.Optional(Type.String({ minLength: 1 })),
          eventModeCode: Type.String({ minLength: 1 }),
          scheduledFrom: Type.String({ format: 'date-time' }),
          scheduledTo: Type.Optional(Type.String({ format: 'date-time' })),
          locationReference: Type.Optional(Type.String({ minLength: 1 })),
          sourceSystemCode: Type.String({ minLength: 1 }),
          sourceEventId: Type.String({ minLength: 1 }),
          sourceVersion: Type.String({ minLength: 1 }),
        }),
        response: {
          200: Type.Object({ expectedEventId: Type.String(), created: Type.Literal(false) }),
          201: Type.Object({ expectedEventId: Type.String(), created: Type.Literal(true) }),
          404: ErrorSchema,
          409: ErrorSchema,
          422: ErrorSchema,
        },
      },
      preHandler: [requirePermission('engagement:event:write')],
    },
    async (request, reply) => {
      const result = await fastify.engagementService.createExpectedEvent(
        request.tenantId,
        request.body as CreateExpectedEventInput,
        request.user.sub,
        request.id,
      );
      if (result.created) {
        await fastify.audit.record({
          tenantId: request.tenantId,
          entityType: 'expected_engagement_event',
          entityId: result.expectedEventId,
          actionType: 'create',
          actorType: 'user',
          actorId: request.user.sub,
          actorDisplayName: request.user.displayName,
          correlationId: request.id,
        });
      }
      await reply.code(result.created ? 201 : 200).send(result);
    },
  );

  fastify.get(
    '/engagement/events',
    {
      schema: {
        querystring: Type.Object({
          personId: Type.Optional(Type.String({ format: 'uuid' })),
          enrolmentId: Type.Optional(Type.String({ format: 'uuid' })),
          statusCode: Type.Optional(Type.String()),
          scheduledFrom: Type.Optional(Type.String({ format: 'date-time' })),
          scheduledTo: Type.Optional(Type.String({ format: 'date-time' })),
        }),
        response: { 200: Type.Array(EventSchema), 422: ErrorSchema },
      },
      preHandler: [requirePermission('engagement:event:read')],
    },
    async (request, reply) => {
      const rows = await fastify.engagementService.listExpectedEvents(
        request.tenantId,
        request.query as {
          personId?: string;
          enrolmentId?: string;
          statusCode?: string;
          scheduledFrom?: string;
          scheduledTo?: string;
        },
      );
      await reply.send(rows.map(eventToWire));
    },
  );

  fastify.post(
    '/engagement/events/:eventId/observations',
    {
      schema: {
        params: Type.Object({ eventId: Type.String({ format: 'uuid' }) }),
        headers: IdempotencyHeaders,
        body: Type.Object({
          sourceSystemCode: Type.String({ minLength: 1 }),
          sourceEventId: Type.String({ minLength: 1 }),
          sourceVersion: Type.String({ minLength: 1 }),
          captureMethodCode: Type.String({ minLength: 1 }),
          outcomeCode: Type.String({ minLength: 1 }),
          dataQualityCode: Type.Optional(Type.String({ minLength: 1 })),
          eventTime: Type.String({ format: 'date-time' }),
          receivedAt: Type.Optional(Type.String({ format: 'date-time' })),
          deviceReference: Type.Optional(Type.String({ minLength: 1 })),
          operationalReference: Type.Optional(Type.String({ minLength: 1 })),
        }),
        response: {
          200: Type.Object({ observationId: Type.String(), created: Type.Literal(false) }),
          201: Type.Object({ observationId: Type.String(), created: Type.Literal(true) }),
          404: ErrorSchema,
          409: ErrorSchema,
          422: ErrorSchema,
        },
      },
      preHandler: [requirePermission('engagement:observation:create')],
    },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const idempotencyKey = String(request.headers['idempotency-key'] ?? '');
      const result = await fastify.engagementService.recordObservation(
        eventId,
        request.tenantId,
        request.body as RecordObservationInput,
        idempotencyKey,
        request.user.sub,
        request.id,
      );
      if (result.created) {
        await fastify.audit.record({
          tenantId: request.tenantId,
          entityType: 'engagement_observation',
          entityId: result.observationId,
          actionType: 'create',
          actorType: 'user',
          actorId: request.user.sub,
          actorDisplayName: request.user.displayName,
          correlationId: request.id,
        });
      }
      await reply.code(result.created ? 201 : 200).send(result);
    },
  );

  fastify.post(
    '/engagement/observations/:observationId/corrections',
    {
      schema: {
        params: Type.Object({ observationId: Type.String({ format: 'uuid' }) }),
        headers: IdempotencyHeaders,
        body: Type.Object({
          sourceVersion: Type.String({ minLength: 1 }),
          outcomeCode: Type.String({ minLength: 1 }),
          dataQualityCode: Type.String({ minLength: 1 }),
          eventTime: Type.Optional(Type.String({ format: 'date-time' })),
          correctionReasonCode: Type.String({ minLength: 1 }),
          correctionReason: Type.Optional(Type.String({ maxLength: 500 })),
          disputed: Type.Optional(Type.Boolean()),
        }),
        response: {
          200: Type.Object({
            observationId: Type.String(),
            observationVersionId: Type.String(),
            created: Type.Literal(false),
          }),
          201: Type.Object({
            observationId: Type.String(),
            observationVersionId: Type.String(),
            created: Type.Literal(true),
          }),
          404: ErrorSchema,
          409: ErrorSchema,
          422: ErrorSchema,
        },
      },
      preHandler: [requirePermission('engagement:observation:correct')],
    },
    async (request, reply) => {
      const { observationId } = request.params as { observationId: string };
      const idempotencyKey = String(request.headers['idempotency-key'] ?? '');
      const body = request.body as CorrectObservationInput;
      const result = await fastify.engagementService.correctObservation(
        observationId,
        request.tenantId,
        body,
        idempotencyKey,
        request.user.sub,
        request.id,
      );
      if (result.created) {
        await fastify.audit.record({
          tenantId: request.tenantId,
          entityType: 'engagement_observation',
          entityId: observationId,
          actionType: 'update',
          actorType: 'user',
          actorId: request.user.sub,
          actorDisplayName: request.user.displayName,
          correlationId: request.id,
          reasonCode: body.correctionReasonCode,
          ...(body.correctionReason ? { reasonText: body.correctionReason } : {}),
        });
      }
      await reply.code(result.created ? 201 : 200).send(result);
    },
  );

  fastify.get(
    '/engagement/students/:personId/timeline',
    {
      schema: {
        params: Type.Object({ personId: Type.String({ format: 'uuid' }) }),
        querystring: Type.Object({
          from: Type.Optional(Type.String({ format: 'date-time' })),
          to: Type.Optional(Type.String({ format: 'date-time' })),
        }),
        response: {
          200: Type.Object({
            events: Type.Array(EventSchema),
            observations: Type.Array(ObservationSchema),
          }),
          404: ErrorSchema,
          422: ErrorSchema,
        },
      },
      preHandler: [requirePermission('engagement:timeline:read')],
    },
    async (request, reply) => {
      const { personId } = request.params as { personId: string };
      const timeline = await fastify.engagementService.getStudentTimeline(
        personId,
        request.tenantId,
        request.query as { from?: string; to?: string },
      );
      await reply.send({
        events: timeline.events.map(eventToWire),
        observations: timeline.observations.map(observationToWire),
      });
    },
  );
}

function eventToWire(event: EngagementEventDto) {
  return {
    ...event,
    scheduledFrom: event.scheduledFrom.toISOString(),
    scheduledTo: event.scheduledTo?.toISOString() ?? null,
    validFrom: event.validFrom.toISOString(),
    validTo: event.validTo?.toISOString() ?? null,
    recordedAt: event.recordedAt.toISOString(),
  };
}

function observationToWire(observation: EngagementObservationDto) {
  return {
    ...observation,
    eventTime: observation.eventTime.toISOString(),
    receivedAt: observation.receivedAt.toISOString(),
    recordedAt: observation.recordedAt.toISOString(),
  };
}
