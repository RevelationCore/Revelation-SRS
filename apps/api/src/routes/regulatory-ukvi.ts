import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

import type {
  UkviAttendanceReportPayload,
  UkviCasRequestDto,
  UkviComplianceAlertDto,
  UkviVisaStatusUpdateInput,
} from '../platform/regulatory/ukvi-service.js';

const ErrorSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const CasRequestSchema = Type.Object({
  casRequestId: Type.String(),
  enrolmentId: Type.String(),
  casReference: Type.Union([Type.String(), Type.Null()]),
  statusCode: Type.String(),
  requestedAt: Type.String(),
});

const PersonDataSchema = Type.Object({
  personId: Type.String(),
  legalFirstName: Type.Union([Type.String(), Type.Null()]),
  legalFamilyName: Type.Union([Type.String(), Type.Null()]),
  dateOfBirth: Type.Union([Type.String(), Type.Null()]),
  nationalityCode: Type.Union([Type.String(), Type.Null()]),
  programmeId: Type.Union([Type.String(), Type.Null()]),
  programmeCode: Type.Union([Type.String(), Type.Null()]),
  programmeTitle: Type.Union([Type.String(), Type.Null()]),
  modeOfStudyCode: Type.String(),
  academicYearOfEntry: Type.String(),
  startDate: Type.String(),
  expectedEndDate: Type.Union([Type.String(), Type.Null()]),
});

const AttendanceStudentSchema = Type.Object({
  enrolmentId: Type.String(),
  personId: Type.String(),
  casReference: Type.Union([Type.String(), Type.Null()]),
  programmeId: Type.Union([Type.String(), Type.Null()]),
  programmeCode: Type.Union([Type.String(), Type.Null()]),
  programmeTitle: Type.Union([Type.String(), Type.Null()]),
  enrolmentStatusCode: Type.String(),
  legalFirstName: Type.Union([Type.String(), Type.Null()]),
  legalFamilyName: Type.Union([Type.String(), Type.Null()]),
  absenceCount: Type.Number(),
  thresholdBreached: Type.Boolean(),
  attendanceDataCompleteness: Type.Union([
    Type.Literal('pending-attendance-integration'),
    Type.Literal('provided'),
  ]),
});

const AttendanceReportPayloadSchema = Type.Object({
  academicPeriodId: Type.String(),
  generatedAt: Type.String(),
  studentCount: Type.Number(),
  threshold: Type.Object({ unauthorisedAbsencesPerEightWeeks: Type.Number() }),
  _attendance_data_completeness: Type.Union([
    Type.Literal('pending-attendance-integration'),
    Type.Literal('provided'),
  ]),
  students: Type.Array(AttendanceStudentSchema),
});

const ComplianceAlertSchema = Type.Object({
  alertId: Type.String(),
  enrolmentId: Type.String(),
  casReference: Type.Union([Type.String(), Type.Null()]),
  alertTypeCode: Type.String(),
  triggeredAt: Type.String(),
  resolvedAt: Type.Union([Type.String(), Type.Null()]),
  resolvedBy: Type.Union([Type.String(), Type.Null()]),
});

const EvidenceSnapshotSchema = Type.Object({
  snapshotId: Type.String(),
  enrolmentId: Type.String(),
  engagementAlertId: Type.String(),
  policyVersionId: Type.String(),
  evidenceWindowFrom: Type.String(),
  evidenceWindowTo: Type.String(),
  evidenceSummary: Type.Record(Type.String(), Type.Unknown()),
  evidenceHash: Type.String(),
  evidenceQualityCode: Type.Union([
    Type.Literal('verified'),
    Type.Literal('reconciliation-required'),
  ]),
  createdAt: Type.String(),
  createdBy: Type.String(),
});

const SponsorDecisionSchema = Type.Object({
  decisionId: Type.String(),
  enrolmentId: Type.String(),
  evidenceSnapshotId: Type.String(),
  outcomeCode: Type.Union([
    Type.Literal('report'),
    Type.Literal('no-report'),
    Type.Literal('further-review'),
  ]),
  rationaleCode: Type.String(),
  guidanceVersion: Type.String(),
  statusCode: Type.Union([
    Type.Literal('pending-authorisation'),
    Type.Literal('authorised'),
  ]),
  decidedAt: Type.String(),
  decidedBy: Type.String(),
  authorisedAt: Type.Union([Type.String(), Type.Null()]),
  authorisedBy: Type.Union([Type.String(), Type.Null()]),
  externalReportId: Type.Union([Type.String(), Type.Null()]),
});

export function regulatoryUkviRoutes(fastify: FastifyInstance): void {
  fastify.post(
    '/regulatory/ukvi/cas-requests/generate',
    {
      schema: {
        response: {
          200: Type.Object({
            processedCount: Type.Number(),
            casRequests: Type.Array(Type.Object({
              casRequestId: Type.String(),
              enrolmentId: Type.String(),
              personData: PersonDataSchema,
            })),
          }),
        },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const result = await fastify.ukviService.generateCasRequests(request.tenantId, request.user.sub);
      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'ukvi_cas_request',
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

  fastify.post(
    '/regulatory/ukvi/engagement-evidence-snapshots',
    {
      schema: {
        body: Type.Object({ engagementAlertId: Type.String() }),
        response: { 201: EvidenceSnapshotSchema, 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const { engagementAlertId } = request.body as { engagementAlertId: string };
      const result = await fastify.ukviService.createEngagementEvidenceSnapshot(
        request.tenantId,
        engagementAlertId,
        request.user.sub,
      );
      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'ukvi_engagement_evidence_snapshot',
        entityId: result.snapshotId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });
      await reply.code(201).send(evidenceSnapshotToWire(result));
    },
  );

  fastify.post(
    '/regulatory/ukvi/sponsor-decisions',
    {
      schema: {
        body: Type.Object({
          evidenceSnapshotId: Type.String(),
          outcomeCode: Type.Union([
            Type.Literal('report'),
            Type.Literal('no-report'),
            Type.Literal('further-review'),
          ]),
          rationaleCode: Type.String({ minLength: 1 }),
          guidanceVersion: Type.String({ minLength: 1 }),
        }),
        response: { 201: SponsorDecisionSchema, 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const result = await fastify.ukviService.createSponsorDecision(
        request.tenantId,
        request.body as {
          evidenceSnapshotId: string;
          outcomeCode: 'report' | 'no-report' | 'further-review';
          rationaleCode: string;
          guidanceVersion: string;
        },
        request.user.sub,
      );
      await reply.code(201).send(sponsorDecisionToWire(result));
    },
  );

  fastify.get(
    '/regulatory/ukvi/sponsor-decisions',
    {
      schema: { response: { 200: Type.Array(SponsorDecisionSchema) } },
      preHandler: [requirePermission('regulatory:read')],
    },
    async (request, reply) => {
      const rows = await fastify.ukviService.listSponsorDecisions(request.tenantId);
      await reply.send(rows.map(sponsorDecisionToWire));
    },
  );

  fastify.post(
    '/regulatory/ukvi/sponsor-decisions/:decisionId/authorise',
    {
      schema: {
        params: Type.Object({ decisionId: Type.String() }),
        response: { 200: SponsorDecisionSchema, 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const { decisionId } = request.params as { decisionId: string };
      const result = await fastify.ukviService.authoriseSponsorDecision(
        decisionId,
        request.tenantId,
        request.user.sub,
      );
      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'ukvi_sponsor_decision',
        entityId: decisionId,
        actionType: 'update',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });
      await reply.send(sponsorDecisionToWire(result));
    },
  );

  fastify.get(
    '/regulatory/ukvi/operations/status',
    {
      schema: {
        response: { 200: Type.Object({
          reconciliationRequired: Type.Number(),
          pendingAuthorisation: Type.Number(),
          failedExchanges: Type.Number(),
        }) },
      },
      preHandler: [requirePermission('regulatory:read')],
    },
    async (request, reply) => {
      await reply.send(await fastify.ukviService.getOperationalStatus(request.tenantId));
    },
  );

  fastify.get(
    '/regulatory/ukvi/cas-requests',
    {
      schema: {
        querystring: Type.Object({ statusCode: Type.Optional(Type.String()) }),
        response: { 200: Type.Array(CasRequestSchema) },
      },
      preHandler: [requirePermission('regulatory:read')],
    },
    async (request, reply) => {
      const query = request.query as { statusCode?: string };
      const rows = await fastify.ukviService.listCasRequests(request.tenantId, query);
      await reply.send(rows.map(casRequestToWire));
    },
  );

  fastify.post(
    '/regulatory/ukvi/cas-requests/:casRequestId/assignment',
    {
      schema: {
        params: Type.Object({ casRequestId: Type.String() }),
        body: Type.Object({ casReference: Type.String({ minLength: 1 }) }),
        response: { 200: CasRequestSchema, 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const { casRequestId } = request.params as { casRequestId: string };
      const { casReference } = request.body as { casReference: string };
      const result = await fastify.ukviService.recordCasAssignment(
        casRequestId,
        casReference,
        request.tenantId,
        request.user.sub,
      );
      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'ukvi_cas_request',
        entityId: casRequestId,
        actionType: 'update',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });
      await reply.send(casRequestToWire(result));
    },
  );

  fastify.post(
    '/regulatory/ukvi/attendance-reports/generate',
    {
      schema: {
        body: Type.Object({ academicPeriodId: Type.String() }),
        response: {
          200: Type.Object({ reportId: Type.String(), payload: AttendanceReportPayloadSchema }),
          404: ErrorSchema,
          422: ErrorSchema,
        },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const { academicPeriodId } = request.body as { academicPeriodId: string };
      const result = await fastify.ukviService.generateAttendanceReport(
        request.tenantId,
        academicPeriodId,
        request.user.sub,
      );
      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'ukvi_attendance_report',
        entityId: result.reportId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });
      await reply.send(result);
    },
  );

  fastify.post(
    '/regulatory/ukvi/visa-updates',
    {
      schema: {
        body: Type.Object({
          casReference: Type.String({ minLength: 1 }),
          statusCode: Type.String({ minLength: 1 }),
          effectiveDate: Type.String(),
          rawPayload: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
          idempotencyKey: Type.Optional(Type.String()),
        }),
        response: {
          201: Type.Object({
            visaStatusId: Type.String(),
            alertId: Type.Union([Type.String(), Type.Null()]),
          }),
          404: ErrorSchema,
          422: ErrorSchema,
        },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const { casReference, ...update } = request.body as UkviVisaStatusUpdateInput & { casReference: string };
      const result = await fastify.ukviService.processVisaStatusUpdate(
        request.tenantId,
        casReference,
        update,
        request.user.sub,
      );
      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'ukvi_visa_status',
        entityId: result.visaStatusId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });
      await reply.code(201).send(result);
    },
  );

  fastify.post(
    '/regulatory/ukvi/compliance-alerts/evaluate',
    {
      schema: {
        response: { 200: Type.Object({ alertsRaised: Type.Number() }) },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const result = await fastify.ukviService.evaluateComplianceAlerts(request.tenantId, request.user.sub);
      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'ukvi_compliance_alert',
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

  fastify.get(
    '/regulatory/ukvi/compliance-alerts',
    {
      schema: {
        querystring: Type.Object({ unresolvedOnly: Type.Optional(Type.Boolean()) }),
        response: { 200: Type.Array(ComplianceAlertSchema) },
      },
      preHandler: [requirePermission('regulatory:read')],
    },
    async (request, reply) => {
      const { unresolvedOnly } = request.query as { unresolvedOnly?: boolean };
      const rows = await fastify.ukviService.listComplianceAlerts(request.tenantId, unresolvedOnly ?? false);
      await reply.send(rows.map(alertToWire));
    },
  );

  fastify.post(
    '/regulatory/ukvi/compliance-alerts/:alertId/resolve',
    {
      schema: {
        params: Type.Object({ alertId: Type.String() }),
        response: { 204: Type.Null(), 404: ErrorSchema },
      },
      preHandler: [requirePermission('regulatory:write')],
    },
    async (request, reply) => {
      const { alertId } = request.params as { alertId: string };
      await fastify.ukviService.resolveComplianceAlert(alertId, request.tenantId, request.user.sub);
      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'ukvi_compliance_alert',
        entityId: alertId,
        actionType: 'update',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });
      await reply.code(204).send();
    },
  );
}

function casRequestToWire(row: UkviCasRequestDto) {
  return {
    ...row,
    requestedAt: row.requestedAt.toISOString(),
  };
}

function alertToWire(row: UkviComplianceAlertDto) {
  return {
    ...row,
    triggeredAt: row.triggeredAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

function evidenceSnapshotToWire(
  row: Awaited<ReturnType<FastifyInstance['ukviService']['createEngagementEvidenceSnapshot']>>,
) {
  return {
    ...row,
    evidenceWindowFrom: row.evidenceWindowFrom.toISOString(),
    evidenceWindowTo: row.evidenceWindowTo.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function sponsorDecisionToWire(
  row: Awaited<ReturnType<FastifyInstance['ukviService']['createSponsorDecision']>>,
) {
  return {
    ...row,
    decidedAt: row.decidedAt.toISOString(),
    authorisedAt: row.authorisedAt?.toISOString() ?? null,
  };
}

export type { UkviAttendanceReportPayload };
