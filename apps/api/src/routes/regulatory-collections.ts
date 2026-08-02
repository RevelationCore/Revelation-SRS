import { Type } from '@sinclair/typebox';
import { requireAnyPermission, requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

const ErrorSchema = Type.Object({
  type:   Type.String(),
  title:  Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const CreateCollectionBody = Type.Object({
  regulatorCode:      Type.String(),
  collectionTypeCode: Type.String(),
  academicYear:       Type.String(),
});

const CreateSnapshotBody = Type.Object({
  sourceTransactionTime: Type.String(),
});

const AddRecordBody = Type.Object({
  enrolmentId:   Type.Optional(Type.String()),
  recordPayload: Type.Record(Type.String(), Type.Unknown()),
});

const AddValidationIssueBody = Type.Object({
  regulatoryRecordId: Type.Optional(Type.String()),
  severityCode:       Type.Union([Type.Literal('blocking'), Type.Literal('warning')]),
  fieldCode:          Type.Optional(Type.String()),
  message:            Type.String(),
});

const SignOffBody = Type.Object({
  commentary: Type.Optional(Type.String()),
});

const SubmitBody = Type.Object({
  collectionSnapshotId: Type.String(),
  submissionReference:  Type.Optional(Type.String()),
});

const RegulatoryCollectionSchema = Type.Object({
  regulatoryCollectionId: Type.String(),
  regulatorCode:          Type.String(),
  collectionTypeCode:     Type.String(),
  academicYear:           Type.String(),
  statusCode:             Type.String(),
  createdAt:              Type.String(),
  createdBy:              Type.String(),
});

export function regulatoryCollectionsRoutes(fastify: FastifyInstance): void {
  fastify.get(
    '/regulatory/collections',
    {
      schema: {
        querystring: Type.Object({
          regulatorCode: Type.Optional(Type.String()),
          academicYear:  Type.Optional(Type.String()),
        }),
        response: { 200: Type.Array(RegulatoryCollectionSchema) },
      },
      preHandler: [requireAnyPermission('regulatory:read', 'regulatory:write')],
    },
    async (request, reply) => {
      const query = request.query as { regulatorCode?: string; academicYear?: string };
      const collections = await fastify.regulatoryCollectionService.listCollections(request.tenantId, query);
      await reply.send(collections.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })));
    },
  );

  fastify.post(
    '/regulatory/collections',
    {
      schema: {
        body:     CreateCollectionBody,
        response: { 201: Type.Object({ regulatoryCollectionId: Type.String() }) },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const body = request.body as { regulatorCode: string; collectionTypeCode: string; academicYear: string };
      const regulatoryCollectionId = await fastify.regulatoryCollectionService.createCollection(request.tenantId, body, request.user.sub);
      await reply.code(201).send({ regulatoryCollectionId });
    },
  );

  fastify.post(
    '/regulatory/collections/:collectionId/snapshots',
    {
      schema: {
        params:   Type.Object({ collectionId: Type.String() }),
        body:     CreateSnapshotBody,
        response: { 201: Type.Object({ collectionSnapshotId: Type.String() }), 404: ErrorSchema },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const { collectionId } = request.params as { collectionId: string };
      const { sourceTransactionTime } = request.body as { sourceTransactionTime: string };
      const collectionSnapshotId = await fastify.regulatoryCollectionService.createSnapshot(
        request.tenantId,
        collectionId,
        { sourceTransactionTime: new Date(sourceTransactionTime) },
        request.user.sub,
      );
      await reply.code(201).send({ collectionSnapshotId });
    },
  );

  fastify.post(
    '/regulatory/snapshots/:snapshotId/records',
    {
      schema: {
        params:   Type.Object({ snapshotId: Type.String() }),
        body:     AddRecordBody,
        response: { 201: Type.Object({ regulatoryRecordId: Type.String() }) },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const { snapshotId } = request.params as { snapshotId: string };
      const body = request.body as { enrolmentId?: string; recordPayload: Record<string, unknown> };
      const regulatoryRecordId = await fastify.regulatoryCollectionService.addRecord(request.tenantId, snapshotId, body);
      await reply.code(201).send({ regulatoryRecordId });
    },
  );

  fastify.post(
    '/regulatory/collections/:collectionId/validation-issues',
    {
      schema: {
        params:   Type.Object({ collectionId: Type.String() }),
        body:     AddValidationIssueBody,
        response: { 201: Type.Object({ issueId: Type.String() }) },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const { collectionId } = request.params as { collectionId: string };
      const body = request.body as { regulatoryRecordId?: string; severityCode: string; fieldCode?: string; message: string };
      const issueId = await fastify.regulatoryCollectionService.addValidationIssue(request.tenantId, collectionId, body);
      await reply.code(201).send({ issueId });
    },
  );

  fastify.post(
    '/regulatory/collections/:collectionId/signoff',
    {
      schema: {
        params:   Type.Object({ collectionId: Type.String() }),
        body:     SignOffBody,
        response: { 201: Type.Object({ signoffId: Type.String() }), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const { collectionId } = request.params as { collectionId: string };
      const { commentary } = request.body as { commentary?: string };
      const signoffId = await fastify.regulatoryCollectionService.signOff(request.tenantId, collectionId, request.user.sub, commentary);

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'regulatory_collection',
        entityId:         collectionId,
        actionType:       'update',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(201).send({ signoffId });
    },
  );

  fastify.post(
    '/regulatory/collections/:collectionId/submit',
    {
      schema: {
        params:   Type.Object({ collectionId: Type.String() }),
        body:     SubmitBody,
        response: { 201: Type.Object({ submissionId: Type.String() }), 404: ErrorSchema },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const { collectionId } = request.params as { collectionId: string };
      const { collectionSnapshotId, submissionReference } = request.body as { collectionSnapshotId: string; submissionReference?: string };
      const submissionId = await fastify.regulatoryCollectionService.submit(request.tenantId, collectionId, collectionSnapshotId, request.user.sub, submissionReference);

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'regulatory_submission',
        entityId:         submissionId,
        actionType:       'create',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(201).send({ submissionId });
    },
  );
}
