import { Type } from '@sinclair/typebox';
import { requireAnyPermission, requirePermission } from '@revelation-srs/auth';
import type { CeremonyAllocation, GraduationInvitation } from '@revelation-srs/db';
import { ForbiddenError, hasPermission } from '@revelation-srs/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { DocumentIssueDto } from '../platform/progression/award-document-service.js';
import type { CycleDto } from '../platform/progression/graduation-service.js';

const ErrorSchema = Type.Object({ type: Type.String(), title: Type.String(), status: Type.Number(), detail: Type.Optional(Type.String()) });
const Nullable = <T extends ReturnType<typeof Type.String>>(t: T) => Type.Union([t, Type.Null()]);
const DateString = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' });

const IssueSchema = Type.Object({
  documentIssueId: Type.String(), studentDocumentId: Type.String(), documentTypeCode: Type.String(), awardId: Type.String(),
  issueNumber: Type.Integer(), issueTypeCode: Type.String(), contentSnapshot: Type.Record(Type.String(), Type.Unknown()),
  contentHash: Type.String(), verificationCode: Type.String(), channelCode: Type.String(), statusCode: Type.String(),
  issuedBy: Type.String(), issuedAt: Type.String(),
  revocation: Type.Union([Type.Object({ reasonCode: Type.String(), reasonText: Type.String(), revokedBy: Type.String(), revokedAt: Type.String() }), Type.Null()]),
});
const InvitationSchema = Type.Object({
  invitationId: Type.String(), cycleId: Type.String(), awardId: Type.String(), personId: Type.String(), responseCode: Type.String(),
  guestCount: Type.Integer(), accessibilityRequired: Type.Boolean(), respondedAt: Nullable(Type.String()), createdAt: Type.String(),
});
const AllocationSchema = Type.Object({
  allocationId: Type.String(), invitationId: Type.String(), ceremonyId: Type.String(), presentationOrder: Type.Union([Type.Integer(), Type.Null()]),
  attendanceCode: Type.String(), allocatedBy: Type.String(), allocatedAt: Type.String(), attendanceRecordedAt: Nullable(Type.String()),
});
const CycleSchema = Type.Object({
  cycleId: Type.String(), cycleCode: Type.String(), title: Type.String(), awardsFrom: Type.String(), awardsTo: Type.String(),
  statusCode: Type.String(), createdBy: Type.String(), createdAt: Type.String(), frozenAt: Nullable(Type.String()),
  ceremonies: Type.Array(Type.Object({
    ceremonyId: Type.String(), ceremonyCode: Type.String(), startsAt: Type.String(), venue: Type.String(),
    capacity: Type.Integer(), guestLimit: Type.Integer(), allocated: Type.Integer(),
  })),
});
const PresentationSchema = Type.Array(Type.Object({
  ceremonyCode: Type.String(), presentationOrder: Type.Union([Type.Integer(), Type.Null()]), invitationId: Type.String(), awardId: Type.String(),
  personId: Type.String(), guestCount: Type.Integer(), accessibilityRequired: Type.Boolean(), attendanceCode: Type.String(),
}));

/** Award documents and graduation (BPR-D15; BP-06-004, BP-06-005). */
export function awardDocumentRoutes(fastify: FastifyInstance): void {
  // ── Documents ────────────────────────────────────────────────────────────

  fastify.post('/awards/:awardId/documents', {
    schema: {
      params: Type.Object({ awardId: Type.String() }),
      body: Type.Object({
        documentTypeCode: Type.String(), channelCode: Type.String(),
        issueTypeCode: Type.Optional(Type.Union(['original', 'replacement', 'corrected-name', 'certified-copy'].map((c) => Type.Literal(c)))),
      }),
      response: { 201: IssueSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('document:issue')],
  }, async (request, reply) => {
    const { awardId } = request.params as { awardId: string };
    const issued = await fastify.awardDocumentService.issue(request.tenantId, awardId, request.body as never, request.user.sub);
    await audit(fastify, request, 'document_issue', issued.documentIssueId, 'create', `Issued ${issued.documentTypeCode} #${issued.issueNumber} (${issued.issueTypeCode})`);
    await reply.code(201).send(issueToWire(issued));
  });

  fastify.get('/awards/:awardId/documents', {
    schema: { params: Type.Object({ awardId: Type.String() }), response: { 200: Type.Array(IssueSchema) } },
    preHandler: [requirePermission('document:read')],
  }, async (request, reply) => {
    const { awardId } = request.params as { awardId: string };
    await reply.send((await fastify.awardDocumentService.listForAward(request.tenantId, awardId)).map(issueToWire));
  });

  fastify.get('/students/:personId/documents', {
    schema: { params: Type.Object({ personId: Type.String() }), response: { 200: Type.Array(IssueSchema), 403: ErrorSchema } },
    preHandler: [requireAnyPermission('document:read', 'document:read:own')],
  }, async (request, reply) => {
    const { personId } = request.params as { personId: string };
    assertOwn(request, personId, 'document:read');
    await reply.send((await fastify.awardDocumentService.listForPerson(request.tenantId, personId)).map(issueToWire));
  });

  fastify.post('/document-issues/:documentIssueId/revocation', {
    schema: {
      params: Type.Object({ documentIssueId: Type.String() }),
      body: Type.Object({ reasonCode: Type.String(), reasonText: Type.String({ minLength: 1, maxLength: 2000 }) }),
      response: { 200: IssueSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('document:revoke')],
  }, async (request, reply) => {
    const { documentIssueId } = request.params as { documentIssueId: string };
    const revoked = await fastify.awardDocumentService.revoke(request.tenantId, documentIssueId, request.body as never, request.user.sub);
    await audit(fastify, request, 'document_issue', documentIssueId, 'update', `Revoked: ${revoked.revocation?.reasonCode ?? ''}`);
    await reply.send(issueToWire(revoked));
  });

  fastify.post('/document-verifications', {
    schema: {
      body: Type.Object({ verificationCode: Type.String({ minLength: 4, maxLength: 64 }), requesterNote: Type.Optional(Type.String({ maxLength: 300 })) }),
      response: {
        200: Type.Object({
          outcomeCode: Type.String(),
          document: Type.Union([Type.Object({
            documentTypeCode: Type.String(), holderName: Type.String(), qualificationCode: Type.String(),
            classificationCode: Type.String(), awardDate: Type.String(), issuedAt: Type.String(),
          }), Type.Null()]),
        }),
      },
    },
    preHandler: [requirePermission('document:verify')],
  }, async (request, reply) => {
    const { verificationCode, requesterNote } = request.body as { verificationCode: string; requesterNote?: string };
    const result = await fastify.awardDocumentService.verify(request.tenantId, verificationCode, request.user.sub, requesterNote);
    await reply.send({ ...result, document: result.document ? { ...result.document, issuedAt: result.document.issuedAt.toISOString() } : null });
  });

  // ── Graduation ───────────────────────────────────────────────────────────

  fastify.post('/graduation-cycles', {
    schema: {
      body: Type.Object({
        cycleCode: Type.String({ minLength: 1, maxLength: 50 }), title: Type.String({ minLength: 1, maxLength: 200 }),
        awardsFrom: DateString, awardsTo: DateString,
        ceremonies: Type.Array(Type.Object({
          ceremonyCode: Type.String({ minLength: 1, maxLength: 50 }), startsAt: Type.String({ format: 'date-time' }),
          venue: Type.String({ minLength: 1, maxLength: 200 }), capacity: Type.Integer({ minimum: 1 }), guestLimit: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
        }), { minItems: 1, maxItems: 50 }),
      }),
      response: { 201: CycleSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('graduation:manage')],
  }, async (request, reply) => {
    const cycle = await fastify.graduationService.createCycle(request.tenantId, request.body as never, request.user.sub);
    await audit(fastify, request, 'graduation_cycle', cycle.id, 'create', `Created graduation cycle ${cycle.cycleCode}`);
    await reply.code(201).send(cycleToWire(cycle));
  });

  fastify.get('/graduation-cycles/:cycleId', {
    schema: { params: Type.Object({ cycleId: Type.String() }), response: { 200: CycleSchema, 404: ErrorSchema } },
    preHandler: [requirePermission('graduation:read')],
  }, async (request, reply) => {
    const { cycleId } = request.params as { cycleId: string };
    await reply.send(cycleToWire(await fastify.graduationService.getCycle(request.tenantId, cycleId)));
  });

  fastify.post('/graduation-cycles/:cycleId/invitations', {
    schema: {
      params: Type.Object({ cycleId: Type.String() }),
      response: { 200: Type.Object({ invited: Type.Integer(), alreadyInvited: Type.Integer(), previouslyPresented: Type.Integer() }), 404: ErrorSchema, 409: ErrorSchema },
    },
    preHandler: [requirePermission('graduation:manage')],
  }, async (request, reply) => {
    const { cycleId } = request.params as { cycleId: string };
    const result = await fastify.graduationService.deriveInvitations(request.tenantId, cycleId);
    await audit(fastify, request, 'graduation_cycle', cycleId, 'update', `Invited ${result.invited}`);
    await reply.send(result);
  });

  fastify.get('/graduation-cycles/:cycleId/invitations', {
    schema: { params: Type.Object({ cycleId: Type.String() }), response: { 200: Type.Array(InvitationSchema) } },
    preHandler: [requirePermission('graduation:read')],
  }, async (request, reply) => {
    const { cycleId } = request.params as { cycleId: string };
    await reply.send((await fastify.graduationService.listInvitations(request.tenantId, cycleId)).map(invitationToWire));
  });

  fastify.get('/students/:personId/graduation-invitations', {
    schema: { params: Type.Object({ personId: Type.String() }), response: { 200: Type.Array(InvitationSchema), 403: ErrorSchema } },
    preHandler: [requireAnyPermission('graduation:read', 'graduation:respond:own')],
  }, async (request, reply) => {
    const { personId } = request.params as { personId: string };
    assertOwn(request, personId, 'graduation:read');
    await reply.send((await fastify.graduationService.listInvitationsForPerson(request.tenantId, personId)).map(invitationToWire));
  });

  fastify.post('/graduation-invitations/:invitationId/response', {
    schema: {
      params: Type.Object({ invitationId: Type.String() }),
      body: Type.Object({
        responseCode: Type.Union(['attending', 'in-absentia', 'deferred', 'declined'].map((c) => Type.Literal(c))),
        guestCount: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })), accessibilityRequired: Type.Optional(Type.Boolean()),
      }),
      response: { 200: InvitationSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema },
    },
    preHandler: [requireAnyPermission('graduation:manage', 'graduation:respond:own')],
  }, async (request, reply) => {
    const { invitationId } = request.params as { invitationId: string };
    const invitation = await fastify.graduationService.getInvitation(request.tenantId, invitationId);
    assertOwn(request, invitation.personId, 'graduation:manage');
    const updated = await fastify.graduationService.respond(request.tenantId, invitationId, request.body as never);
    await audit(fastify, request, 'graduation_invitation', invitationId, 'update', `Response: ${updated.responseCode}`);
    await reply.send(invitationToWire(updated));
  });

  fastify.post('/graduation-invitations/:invitationId/allocation', {
    schema: {
      params: Type.Object({ invitationId: Type.String() }), body: Type.Object({ ceremonyId: Type.String() }),
      response: { 200: AllocationSchema, 404: ErrorSchema, 409: ErrorSchema },
    },
    preHandler: [requirePermission('graduation:manage')],
  }, async (request, reply) => {
    const { invitationId } = request.params as { invitationId: string };
    const { ceremonyId } = request.body as { ceremonyId: string };
    const allocation = await fastify.graduationService.allocate(request.tenantId, invitationId, ceremonyId, request.user.sub);
    await audit(fastify, request, 'ceremony_allocation', allocation.id, 'create', 'Allocated to ceremony');
    await reply.send(allocationToWire(allocation));
  });

  fastify.post('/graduation-cycles/:cycleId/freeze', {
    schema: { params: Type.Object({ cycleId: Type.String() }), response: { 200: PresentationSchema, 404: ErrorSchema, 409: ErrorSchema } },
    preHandler: [requirePermission('graduation:manage')],
  }, async (request, reply) => {
    const { cycleId } = request.params as { cycleId: string };
    const list = await fastify.graduationService.freeze(request.tenantId, cycleId);
    await audit(fastify, request, 'graduation_cycle', cycleId, 'update', 'Presentation list frozen');
    await reply.send(list);
  });

  fastify.post('/ceremony-allocations/:allocationId/attendance', {
    schema: {
      params: Type.Object({ allocationId: Type.String() }),
      body: Type.Object({ attendanceCode: Type.Union([Type.Literal('attended'), Type.Literal('absent')]) }),
      response: { 200: AllocationSchema, 404: ErrorSchema, 409: ErrorSchema },
    },
    preHandler: [requirePermission('graduation:manage')],
  }, async (request, reply) => {
    const { allocationId } = request.params as { allocationId: string };
    const { attendanceCode } = request.body as { attendanceCode: 'attended' | 'absent' };
    const allocation = await fastify.graduationService.recordAttendance(request.tenantId, allocationId, attendanceCode);
    await audit(fastify, request, 'ceremony_allocation', allocationId, 'update', `Attendance: ${attendanceCode}`);
    await reply.send(allocationToWire(allocation));
  });
}

function assertOwn(request: FastifyRequest, personId: string, staffPermission: string): void {
  if (hasPermission(request.user.roles, staffPermission as never)) return;
  if (request.user.srsPersonId !== personId) throw new ForbiddenError('You can only see your own records');
}

async function audit(fastify: FastifyInstance, request: FastifyRequest, entityType: string, entityId: string, actionType: 'create' | 'update', reasonText: string) {
  await fastify.audit.record({
    tenantId: request.tenantId, entityType, entityId, actionType, actorType: 'user', actorId: request.user.sub,
    actorDisplayName: request.user.displayName, correlationId: request.id, reasonText,
  });
}

function issueToWire(i: DocumentIssueDto) {
  return {
    ...i, issuedAt: i.issuedAt.toISOString(),
    revocation: i.revocation ? { ...i.revocation, revokedAt: i.revocation.revokedAt.toISOString() } : null,
  };
}

function invitationToWire(i: GraduationInvitation) {
  const { id, tenantId: _t, ...rest } = i;
  return { invitationId: id, ...rest, respondedAt: i.respondedAt?.toISOString() ?? null, createdAt: i.createdAt.toISOString() };
}

function allocationToWire(a: CeremonyAllocation) {
  const { id, tenantId: _t, ...rest } = a;
  return { allocationId: id, ...rest, allocatedAt: a.allocatedAt.toISOString(), attendanceRecordedAt: a.attendanceRecordedAt?.toISOString() ?? null };
}

function cycleToWire(c: CycleDto) {
  const { id, tenantId: _t, ceremonies, ...rest } = c;
  return {
    cycleId: id, ...rest, createdAt: c.createdAt.toISOString(), frozenAt: c.frozenAt?.toISOString() ?? null,
    ceremonies: ceremonies.map(({ id: ceremonyId, tenantId: _tt, cycleId: _c, ...cer }) => ({ ceremonyId, ...cer, startsAt: cer.startsAt.toISOString() })),
  };
}
