import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

const ErrorSchema = Type.Object({
  type:   Type.String(),
  title:  Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const OpenRequestBody = Type.Object({
  personId:              Type.String(),
  requestTypeCode:       Type.Union([
    Type.Literal('access'), Type.Literal('rectification'), Type.Literal('erasure'),
    Type.Literal('restriction'), Type.Literal('portability'), Type.Literal('objection'),
  ]),
  statutoryDeadlineDate: Type.String(),
  ownerId:               Type.String(),
});

const AddScopeBody = Type.Object({
  scopeEntityType:  Type.String(),
  scopeDescription: Type.Optional(Type.String()),
});

const RecordSearchBody = Type.Object({
  searchedSystem: Type.String(),
  recordCount:    Type.Integer({ minimum: 0 }),
});

const DecideBody = Type.Object({
  decisionTypeCode: Type.Union([Type.Literal('granted'), Type.Literal('partially-granted'), Type.Literal('refused')]),
  legalBasis:       Type.Optional(Type.String()),
});

const ApplyRestrictionBody = Type.Object({
  personId:             Type.String(),
  restrictionTypeCode:  Type.String(),
  rightsDecisionId:     Type.Optional(Type.String()),
});

const CreateScheduleBody = Type.Object({
  entityType:             Type.String(),
  retentionPeriodMonths:  Type.String(),
  triggerEventCode:       Type.String(),
  description:            Type.Optional(Type.String()),
});

const AssignScheduleBody = Type.Object({
  entityType:             Type.String(),
  entityId:               Type.String(),
  scheduledDisposalDate:  Type.Optional(Type.String()),
});

const PlaceHoldBody = Type.Object({
  holdReasonCode: Type.String(),
});

const RecordDispositionBody = Type.Object({
  dispositionTypeCode: Type.Union([Type.Literal('anonymised'), Type.Literal('deleted'), Type.Literal('transferred')]),
  evidenceRef:         Type.Optional(Type.String()),
});

const IndividualRightsRequestSchema = Type.Object({
  individualRightsRequestId: Type.String(),
  personId:                  Type.String(),
  requestTypeCode:           Type.String(),
  statusCode:                Type.String(),
  ownerId:                   Type.String(),
  receivedAt:                Type.String(),
  statutoryDeadlineDate:     Type.String(),
});

const RetentionScheduleSchema = Type.Object({
  retentionScheduleId:   Type.String(),
  entityType:            Type.String(),
  retentionPeriodMonths: Type.String(),
  triggerEventCode:      Type.String(),
  description:           Type.Union([Type.String(), Type.Null()]),
});

const RetentionAssignmentSchema = Type.Object({
  retentionAssignmentId: Type.String(),
  retentionScheduleId:   Type.String(),
  entityType:            Type.String(),
  entityId:              Type.String(),
  assignedAt:            Type.String(),
  scheduledDisposalDate: Type.Union([Type.String(), Type.Null()]),
  hasActiveHold:         Type.Boolean(),
  disposed:              Type.Boolean(),
});

export function rightsRequestsRoutes(fastify: FastifyInstance): void {
  fastify.get(
    '/rights-requests',
    {
      schema: {
        querystring: Type.Object({ statusCode: Type.Optional(Type.String()) }),
        response: { 200: Type.Array(IndividualRightsRequestSchema) },
      },
      preHandler: [requirePermission('identity:manage')],
    },
    async (request, reply) => {
      const { statusCode } = request.query as { statusCode?: string };
      const requests = await fastify.rightsRequestService.listRequests(request.tenantId, statusCode);
      await reply.send(requests.map((r) => ({ ...r, receivedAt: r.receivedAt.toISOString() })));
    },
  );

  fastify.get(
    '/retention-schedules',
    {
      schema: { response: { 200: Type.Array(RetentionScheduleSchema) } },
      preHandler: [requirePermission('retention:enforce')],
    },
    async (request, reply) => {
      const schedules = await fastify.rightsRequestService.listSchedules(request.tenantId);
      await reply.send(schedules);
    },
  );

  fastify.get(
    '/retention-assignments',
    {
      schema: {
        querystring: Type.Object({ retentionScheduleId: Type.Optional(Type.String()) }),
        response: { 200: Type.Array(RetentionAssignmentSchema) },
      },
      preHandler: [requirePermission('retention:enforce')],
    },
    async (request, reply) => {
      const { retentionScheduleId } = request.query as { retentionScheduleId?: string };
      const assignments = await fastify.rightsRequestService.listAssignments(request.tenantId, retentionScheduleId);
      await reply.send(assignments.map((a) => ({
        ...a,
        assignedAt: a.assignedAt.toISOString(),
      })));
    },
  );

  fastify.post(
    '/rights-requests',
    {
      schema: { body: OpenRequestBody, response: { 201: Type.Object({ requestId: Type.String() }) } },
      preHandler: [requirePermission('identity:manage')],
    },
    async (request, reply) => {
      const body = request.body as { personId: string; requestTypeCode: string; statutoryDeadlineDate: string; ownerId: string };
      const requestId = await fastify.rightsRequestService.openRequest(request.tenantId, body, request.user.sub);

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'individual_rights_request',
        entityId:         requestId,
        actionType:       'create',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(201).send({ requestId });
    },
  );

  fastify.post(
    '/rights-requests/:requestId/scope',
    {
      schema: {
        params: Type.Object({ requestId: Type.String() }),
        body: AddScopeBody,
        response: { 201: Type.Object({ scopeId: Type.String() }) },
      },
      preHandler: [requirePermission('identity:manage')],
    },
    async (request, reply) => {
      const { requestId } = request.params as { requestId: string };
      const body = request.body as { scopeEntityType: string; scopeDescription?: string };
      const scopeId = await fastify.rightsRequestService.addScope(request.tenantId, requestId, body.scopeEntityType, body.scopeDescription);
      await reply.code(201).send({ scopeId });
    },
  );

  fastify.post(
    '/rights-requests/:requestId/search-manifest',
    {
      schema: {
        params: Type.Object({ requestId: Type.String() }),
        body: RecordSearchBody,
        response: { 201: Type.Object({ manifestId: Type.String() }) },
      },
      preHandler: [requirePermission('identity:manage')],
    },
    async (request, reply) => {
      const { requestId } = request.params as { requestId: string };
      const body = request.body as { searchedSystem: string; recordCount: number };
      const manifestId = await fastify.rightsRequestService.recordSearch(request.tenantId, requestId, body);
      await reply.code(201).send({ manifestId });
    },
  );

  fastify.post(
    '/rights-requests/:requestId/decision',
    {
      schema: {
        params: Type.Object({ requestId: Type.String() }),
        body: DecideBody,
        response: { 201: Type.Object({ decisionId: Type.String() }) },
      },
      preHandler: [requirePermission('identity:manage')],
    },
    async (request, reply) => {
      const { requestId } = request.params as { requestId: string };
      const body = request.body as { decisionTypeCode: 'granted' | 'partially-granted' | 'refused'; legalBasis?: string };
      const decisionId = await fastify.rightsRequestService.decide(request.tenantId, requestId, body, request.user.sub);

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'rights_decision',
        entityId:         decisionId,
        actionType:       'create',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(201).send({ decisionId });
    },
  );

  fastify.post(
    '/rights-restrictions',
    {
      schema: { body: ApplyRestrictionBody, response: { 201: Type.Object({ restrictionId: Type.String() }) } },
      preHandler: [requirePermission('identity:manage')],
    },
    async (request, reply) => {
      const body = request.body as { personId: string; restrictionTypeCode: string; rightsDecisionId?: string };
      const restrictionId = await fastify.rightsRequestService.applyRestriction(request.tenantId, body.personId, body.restrictionTypeCode, request.user.sub, body.rightsDecisionId);
      await reply.code(201).send({ restrictionId });
    },
  );

  fastify.patch(
    '/rights-restrictions/:restrictionId/lift',
    {
      schema: { params: Type.Object({ restrictionId: Type.String() }), response: { 204: Type.Null(), 404: ErrorSchema } },
      preHandler: [requirePermission('identity:manage')],
    },
    async (request, reply) => {
      const { restrictionId } = request.params as { restrictionId: string };
      await fastify.rightsRequestService.liftRestriction(request.tenantId, restrictionId);
      await reply.code(204).send();
    },
  );

  fastify.post(
    '/retention-schedules',
    {
      schema: { body: CreateScheduleBody, response: { 201: Type.Object({ retentionScheduleId: Type.String() }) } },
      preHandler: [requirePermission('retention:enforce')],
    },
    async (request, reply) => {
      const body = request.body as { entityType: string; retentionPeriodMonths: string; triggerEventCode: string; description?: string };
      const retentionScheduleId = await fastify.rightsRequestService.createSchedule(request.tenantId, body.entityType, body.retentionPeriodMonths, body.triggerEventCode, body.description);
      await reply.code(201).send({ retentionScheduleId });
    },
  );

  fastify.post(
    '/retention-schedules/:scheduleId/assignments',
    {
      schema: {
        params: Type.Object({ scheduleId: Type.String() }),
        body: AssignScheduleBody,
        response: { 201: Type.Object({ retentionAssignmentId: Type.String() }) },
      },
      preHandler: [requirePermission('retention:enforce')],
    },
    async (request, reply) => {
      const { scheduleId } = request.params as { scheduleId: string };
      const body = request.body as { entityType: string; entityId: string; scheduledDisposalDate?: string };
      const retentionAssignmentId = await fastify.rightsRequestService.assignSchedule(request.tenantId, scheduleId, body.entityType, body.entityId, body.scheduledDisposalDate);
      await reply.code(201).send({ retentionAssignmentId });
    },
  );

  fastify.post(
    '/retention-assignments/:assignmentId/holds',
    {
      schema: {
        params: Type.Object({ assignmentId: Type.String() }),
        body: PlaceHoldBody,
        response: { 201: Type.Object({ holdId: Type.String() }) },
      },
      preHandler: [requirePermission('retention:enforce')],
    },
    async (request, reply) => {
      const { assignmentId } = request.params as { assignmentId: string };
      const { holdReasonCode } = request.body as { holdReasonCode: string };
      const holdId = await fastify.rightsRequestService.placeHold(request.tenantId, assignmentId, holdReasonCode, request.user.sub);
      await reply.code(201).send({ holdId });
    },
  );

  fastify.post(
    '/retention-assignments/:assignmentId/disposition',
    {
      schema: {
        params: Type.Object({ assignmentId: Type.String() }),
        body: RecordDispositionBody,
        response: { 201: Type.Object({ dispositionId: Type.String() }), 422: ErrorSchema },
      },
      preHandler: [requirePermission('retention:enforce')],
    },
    async (request, reply) => {
      const { assignmentId } = request.params as { assignmentId: string };
      const body = request.body as { dispositionTypeCode: string; evidenceRef?: string };
      const dispositionId = await fastify.rightsRequestService.recordDisposition(request.tenantId, assignmentId, body.dispositionTypeCode, request.user.sub, body.evidenceRef);

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'record_disposition',
        entityId:         dispositionId,
        actionType:       'create',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(201).send({ dispositionId });
    },
  );
}
