import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

import type {
  SlcConfirmationRecord,
  SlcNotificationDto,
  SlcNotificationInput,
  SubmissionRequestDto,
} from '../platform/regulatory/slc-service.js';

const ErrorSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const SlcConfirmationRecordSchema = Type.Object({
  triggerId: Type.String(),
  enrolmentId: Type.String(),
  slcReference: Type.String(),
  programmeId: Type.Union([Type.String(), Type.Null()]),
  modeOfStudyCode: Type.String(),
  confirmationType: Type.Union([
    Type.Literal('enrolment'),
    Type.Literal('withdrawal'),
    Type.Literal('intermission'),
  ]),
  feeAmount: Type.Union([Type.String(), Type.Null()]),
  startDate: Type.String(),
  expectedEndDate: Type.Union([Type.String(), Type.Null()]),
});

const SlcNotificationSchema = Type.Object({
  notificationId: Type.String(),
  enrolmentId: Type.String(),
  notificationTypeCode: Type.String(),
  effectiveDate: Type.String(),
  amount: Type.Union([Type.String(), Type.Null()]),
  receivedAt: Type.String(),
});

export function regulatorySlcRoutes(fastify: FastifyInstance): void {
  fastify.post(
    '/regulatory/slc/confirmations/generate',
    {
      schema: {
        querystring: Type.Object({ dryRun: Type.Optional(Type.Boolean()) }),
        response: {
          200: Type.Object({
            processedCount: Type.Number(),
            dryRun: Type.Boolean(),
            payload: Type.Object({ confirmations: Type.Array(SlcConfirmationRecordSchema) }),
          }),
        },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const { dryRun = false } = request.query as { dryRun?: boolean };
      const result = await fastify.slcService.generateConfirmations(request.tenantId, request.user.sub, { dryRun });
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
      await reply.send({ ...result, dryRun });
    },
  );

  fastify.post(
    '/enrolments/:enrolmentId/slc-status-notification',
    {
      schema: {
        params: Type.Object({ enrolmentId: Type.String() }),
        response: { 200: SlcConfirmationRecordSchema, 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const { enrolmentId } = request.params as { enrolmentId: string };
      const record = await fastify.slcService.generateStatusChangeNotification(
        enrolmentId,
        request.tenantId,
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
      await reply.send(record);
    },
  );

  fastify.post(
    '/regulatory/slc/notifications',
    {
      schema: {
        body: Type.Object({
          enrolmentId: Type.String(),
          notificationTypeCode: Type.String({ minLength: 1 }),
          effectiveDate: Type.String(),
          amount: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Null()])),
          rawPayload: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
          idempotencyKey: Type.Optional(Type.String()),
          notificationId: Type.Optional(Type.String()),
        }),
        response: { 201: Type.Object({ notificationId: Type.String() }), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const notificationId = await fastify.slcService.processInboundNotification(
        request.tenantId,
        request.body as SlcNotificationInput,
        request.user.sub,
      );
      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'slc_notification',
        entityId: notificationId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });
      await reply.code(201).send({ notificationId });
    },
  );

  fastify.get(
    '/enrolments/:enrolmentId/slc-notifications',
    {
      schema: {
        params: Type.Object({ enrolmentId: Type.String() }),
        response: { 200: Type.Array(SlcNotificationSchema), 404: ErrorSchema },
      },
      preHandler: [requirePermission('regulatory:read')],
    },
    async (request, reply) => {
      const { enrolmentId } = request.params as { enrolmentId: string };
      const notifications = await fastify.slcService.listNotifications(enrolmentId, request.tenantId);
      await reply.send(notifications.map(notificationToWire));
    },
  );

  // ── Submission approval workflow (BPR-W12 reference implementation) ────────
  const SubmissionRequestSchema = Type.Object({
    workflowInstanceId: Type.String(),
    workflowTaskId:      Type.String(),
    statusCode:          Type.String(),
    recordCount:         Type.Number(),
    context:             Type.Record(Type.String(), Type.Unknown()),
    startedAt:           Type.String(),
  });

  fastify.post(
    '/regulatory/slc/confirmations/requests',
    {
      schema: {
        body:     Type.Object({ reason: Type.Optional(Type.String()) }),
        response: { 202: SubmissionRequestSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const { reason } = request.body as { reason?: string };
      const submissionRequest = await fastify.slcService.requestSubmission(request.tenantId, request.user.sub, reason);

      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'slc_confirmation_batch',
        entityId: submissionRequest.workflowInstanceId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });

      await reply.code(202).send(submissionRequestToWire(submissionRequest));
    },
  );

  fastify.get(
    '/regulatory/slc/confirmations/requests',
    {
      schema: { response: { 200: Type.Array(SubmissionRequestSchema) } },
      preHandler: [requirePermission('regulatory:decide')],
    },
    async (request, reply) => {
      const requests = await fastify.slcService.listPendingSubmissionRequests(request.tenantId);
      await reply.send(requests.map(submissionRequestToWire));
    },
  );

  fastify.post(
    '/regulatory/slc/confirmations/requests/:workflowInstanceId/decision',
    {
      schema: {
        params: Type.Object({ workflowInstanceId: Type.String() }),
        body: Type.Object({
          decisionCode: Type.Union([Type.Literal('approved'), Type.Literal('rejected')]),
          reason:       Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Object({ processedCount: Type.Number() }),
          404: ErrorSchema, 422: ErrorSchema,
        },
      },
      preHandler: [requirePermission('regulatory:decide')],
    },
    async (request, reply) => {
      const { workflowInstanceId } = request.params as { workflowInstanceId: string };
      const { decisionCode, reason } = request.body as { decisionCode: 'approved' | 'rejected'; reason?: string };

      const result = await fastify.slcService.decideSubmissionRequest(
        request.tenantId, workflowInstanceId, decisionCode, request.user.sub, reason,
      );

      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'slc_confirmation_batch',
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

function submissionRequestToWire(submissionRequest: SubmissionRequestDto) {
  return {
    ...submissionRequest,
    startedAt: submissionRequest.startedAt.toISOString(),
  };
}

function notificationToWire(notification: SlcNotificationDto) {
  return {
    notificationId: notification.notificationId,
    enrolmentId: notification.enrolmentId,
    notificationTypeCode: notification.notificationTypeCode,
    effectiveDate: notification.effectiveDate,
    amount: notification.amount,
    receivedAt: notification.receivedAt.toISOString(),
  };
}

export type { SlcConfirmationRecord };
