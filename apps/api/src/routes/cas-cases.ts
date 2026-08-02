import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

import type {
  OpenCasCaseInput,
  RecordEligibilityCheckInput,
  RecordAssignmentVersionInput,
  RecordSponsorReportVersionInput,
} from '../platform/regulatory/cas-case-service.js';

const ErrorSchema = Type.Object({
  type:   Type.String(),
  title:  Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const CasCaseSchema = Type.Object({
  casCaseId:          Type.String(),
  enrolmentId:        Type.String(),
  casReference:       Type.Union([Type.String(), Type.Null()]),
  statusCode:         Type.String(),
  actorId:            Type.String(),
  validFrom:          Type.String(),
  validTo:            Type.Union([Type.String(), Type.Null()]),
  recordedAt:         Type.String(),
  recordedUntil:      Type.Union([Type.String(), Type.Null()]),
});

const OpenCasCaseBody = Type.Object({
  casReference:       Type.Optional(Type.String()),
});

const EligibilityCheckBody = Type.Object({
  guidanceVersion: Type.String(),
  checkTypeCode:   Type.String(),
  resultCode:      Type.String(),
  evidenceRef:     Type.Optional(Type.String()),
});

const AssignmentVersionBody = Type.Object({
  assignedPayloadHash: Type.String(),
  casNumber:           Type.Optional(Type.String()),
  smsRequestSentAt:    Type.Optional(Type.String()),
  smsReceiptRef:       Type.Optional(Type.String()),
});

const SponsorReportVersionBody = Type.Object({
  reportPayloadRef:    Type.String(),
  distributionItemId:  Type.Optional(Type.String()),
});

export function casCasesRoutes(fastify: FastifyInstance): void {
  fastify.post(
    '/enrolments/:enrolmentId/regulatory/cas-cases',
    {
      schema: {
        params:   Type.Object({ enrolmentId: Type.String() }),
        body:     OpenCasCaseBody,
        response: { 201: Type.Object({ casCaseId: Type.String() }), 422: ErrorSchema },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const { enrolmentId } = request.params as { enrolmentId: string };
      const body = request.body as OpenCasCaseInput;
      const casCaseId = await fastify.casCaseService.openCase(
        request.tenantId,
        { enrolmentId, ...(body.casReference ? { casReference: body.casReference } : {}) },
        request.user.sub,
      );

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'cas_case',
        entityId:         casCaseId,
        actionType:       'create',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(201).send({ casCaseId });
    },
  );

  fastify.get(
    '/enrolments/:enrolmentId/regulatory/cas-cases',
    {
      schema: {
        params:   Type.Object({ enrolmentId: Type.String() }),
        response: { 200: Type.Array(CasCaseSchema) },
      },
      preHandler: [requirePermission('regulatory:read')],
    },
    async (request, reply) => {
      const { enrolmentId } = request.params as { enrolmentId: string };
      const cases = await fastify.casCaseService.listCasesForEnrolment(enrolmentId, request.tenantId);
      await reply.send(cases);
    },
  );

  fastify.post(
    '/regulatory/cas-cases/:casCaseId/eligibility-checks',
    {
      schema: {
        params:   Type.Object({ casCaseId: Type.String() }),
        body:     EligibilityCheckBody,
        response: { 201: Type.Object({ checkId: Type.String() }), 404: ErrorSchema },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const { casCaseId } = request.params as { casCaseId: string };
      const body = request.body as RecordEligibilityCheckInput;
      const checkId = await fastify.casCaseService.recordEligibilityCheck(casCaseId, request.tenantId, body, request.user.sub);

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'cas_eligibility_check',
        entityId:         checkId,
        actionType:       'create',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(201).send({ checkId });
    },
  );

  fastify.post(
    '/regulatory/cas-cases/:casCaseId/assignment-versions',
    {
      schema: {
        params:   Type.Object({ casCaseId: Type.String() }),
        body:     AssignmentVersionBody,
        response: { 201: Type.Object({ assignmentId: Type.String() }), 404: ErrorSchema },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const { casCaseId } = request.params as { casCaseId: string };
      const body = request.body as { assignedPayloadHash: string; casNumber?: string; smsRequestSentAt?: string; smsReceiptRef?: string };
      const input: RecordAssignmentVersionInput = {
        assignedPayloadHash: body.assignedPayloadHash,
        ...(body.casNumber ? { casNumber: body.casNumber } : {}),
        ...(body.smsRequestSentAt ? { smsRequestSentAt: new Date(body.smsRequestSentAt) } : {}),
        ...(body.smsReceiptRef ? { smsReceiptRef: body.smsReceiptRef } : {}),
      };
      const assignmentId = await fastify.casCaseService.recordAssignmentVersion(casCaseId, request.tenantId, input, request.user.sub);

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'cas_assignment_version',
        entityId:         assignmentId,
        actionType:       'create',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(201).send({ assignmentId });
    },
  );

  fastify.post(
    '/regulatory/cas-cases/:casCaseId/sponsor-report-versions',
    {
      schema: {
        params:   Type.Object({ casCaseId: Type.String() }),
        body:     SponsorReportVersionBody,
        response: { 201: Type.Object({ reportId: Type.String() }), 404: ErrorSchema },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const { casCaseId } = request.params as { casCaseId: string };
      const body = request.body as RecordSponsorReportVersionInput;
      const reportId = await fastify.casCaseService.recordSponsorReportVersion(casCaseId, request.tenantId, body, request.user.sub);

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'sponsor_report_version',
        entityId:         reportId,
        actionType:       'create',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(201).send({ reportId });
    },
  );
}
