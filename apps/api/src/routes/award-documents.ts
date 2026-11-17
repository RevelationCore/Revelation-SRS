import { Type } from '@sinclair/typebox';
import { requireAnyPermission, requirePermission } from '@revelation-srs/auth';
import type { CeremonyAllocation, GraduationInvitation } from '@revelation-srs/db';
import { ForbiddenError, hasPermission } from '@revelation-srs/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { DocumentIssueDto, RevocationRequestDto, VerificationResult } from '../platform/progression/award-document-service.js';
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
  personId: Type.String(),
  rendered: Type.Union([Type.Object({
    documentId: Type.String(), templateCode: Type.String(), templateVersion: Type.String(), pdfSha256: Type.String(), signingKeyId: Nullable(Type.String()),
  }), Type.Null()]),
});
const Json = Type.Record(Type.String(), Type.Unknown());
export const VerificationSchema = Type.Object({
  outcomeCode: Type.String(),
  document: Type.Union([Type.Object({
    documentTypeCode: Type.String(), holderName: Type.String(), qualificationCode: Type.String(),
    classificationCode: Type.String(), awardDate: Type.String(), issuedAt: Type.String(),
  }), Type.Null()]),
  signature: Type.Optional(Type.Object({ status: Type.String(), keyId: Type.Union([Type.String(), Type.Null()]) })),
  issuer: Type.Optional(Type.String()),
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

  // Revoking needs two people (D-20): a request, then a decision by someone else.
  fastify.post('/document-issues/:documentIssueId/revocation', {
    schema: {
      params: Type.Object({ documentIssueId: Type.String() }),
      body: Type.Object({ reasonCode: Type.String(), reasonText: Type.String({ minLength: 1, maxLength: 2000 }) }),
      response: { 201: Json, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('document:revoke')],
  }, async (request, reply) => {
    const { documentIssueId } = request.params as { documentIssueId: string };
    const requested = await fastify.awardDocumentService.requestRevocation(request.tenantId, documentIssueId, request.body as never, request.user.sub);
    await audit(fastify, request, 'document_issue', documentIssueId, 'update', `Revocation requested: ${requested.reasonCode}`);
    await reply.code(201).send(revocationToWire(requested));
  });

  fastify.get('/document-revocation-requests', {
    schema: { querystring: Type.Object({ open: Type.Optional(Type.Boolean()), documentIssueId: Type.Optional(Type.String()) }), response: { 200: Type.Array(Json) } },
    preHandler: [requireAnyPermission('document:revoke', 'document:revoke:approve')],
  }, async (request, reply) => {
    const q = request.query as { open?: boolean; documentIssueId?: string };
    await reply.send((await fastify.awardDocumentService.listRevocationRequests(request.tenantId, { ...(q.open ? { open: true } : {}), ...(q.documentIssueId ? { documentIssueId: q.documentIssueId } : {}) })).map(revocationToWire));
  });

  fastify.post('/document-revocation-requests/:caseId/decision', {
    schema: {
      params: Type.Object({ caseId: Type.String() }),
      body: Type.Object({ outcome: Type.Union([Type.Literal('approved'), Type.Literal('rejected')]), note: Type.Optional(Type.String({ maxLength: 2000 })) }),
      response: { 200: Json, 404: ErrorSchema, 409: ErrorSchema },
    },
    preHandler: [requirePermission('document:revoke:approve')],
  }, async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const decided = await fastify.awardDocumentService.decideRevocation(request.tenantId, caseId, request.body as never, request.user.sub);
    await audit(fastify, request, 'document_issue', decided.documentIssueId, 'update', `Revocation ${decided.decision?.outcome ?? ''}`);
    await reply.send(revocationToWire(decided));
  });

  // The issued PDF (D-20): staff, or the student it belongs to.
  fastify.get('/document-issues/:documentIssueId/pdf', {
    schema: { params: Type.Object({ documentIssueId: Type.String() }) },
    preHandler: [requireAnyPermission('document:read', 'document:read:own')],
  }, async (request, reply) => {
    const { documentIssueId } = request.params as { documentIssueId: string };
    assertOwn(request, await fastify.awardDocumentService.personForIssue(request.tenantId, documentIssueId), 'document:read');
    const file = await fastify.awardDocumentService.pdf(request.tenantId, documentIssueId, request.user.sub);
    await reply.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="${file.filename}"`).send(file.content);
  });

  // The institution's signing keys (D-20): tenant administrators retire or withdraw them.
  fastify.get('/document-signing-keys', {
    schema: { response: { 200: Type.Array(Json) } },
    preHandler: [requirePermission('document-signing-key:manage')],
  }, async (request, reply) => {
    await reply.send((await fastify.awardDocumentService.listSigningKeys(request.tenantId)).map((k) => ({
      keyId: k.keyId, algorithm: k.algorithm, providerCode: k.providerCode, statusCode: k.statusCode, registeredAt: k.registeredAt.toISOString(),
      retiredAt: k.retiredAt?.toISOString() ?? null, compromisedAt: k.compromisedAt?.toISOString() ?? null,
    })));
  });

  fastify.post('/document-signing-keys/:keyId/status', {
    schema: {
      params: Type.Object({ keyId: Type.String() }),
      body: Type.Object({ statusCode: Type.Union([Type.Literal('retired'), Type.Literal('compromised')]) }),
      response: { 200: Json, 404: ErrorSchema },
    },
    preHandler: [requirePermission('document-signing-key:manage')],
  }, async (request, reply) => {
    const { keyId } = request.params as { keyId: string };
    const result = await fastify.awardDocumentService.setSigningKeyStatus(request.tenantId, keyId, (request.body as { statusCode: 'retired' | 'compromised' }).statusCode, request.user.sub);
    await fastify.audit.record({
      tenantId: request.tenantId, entityType: 'document_signing_key', entityId: request.tenantId, actionType: 'update', actorType: 'user', actorId: request.user.sub,
      actorDisplayName: request.user.displayName, correlationId: request.id, reasonText: `Signing key ${keyId} ${result.statusCode}; ${result.affectedIssueIds.length} issue(s) to re-issue`,
    });
    await reply.send(result);
  });

  // A check by name and date of birth needs the holder's recorded consent (D-21).
  fastify.post('/document-verifications/lookup', {
    schema: {
      body: Type.Object({ legalFamilyName: Type.String({ minLength: 1 }), dateOfBirth: DateString, consentEvidenceRef: Type.String({ minLength: 1, maxLength: 300 }) }),
      response: { 200: Type.Array(Json), 422: ErrorSchema },
    },
    preHandler: [requirePermission('document:verify')],
  }, async (request, reply) => {
    const results = await fastify.awardDocumentService.staffLookup(request.tenantId, request.body as never, request.user.sub);
    await reply.send(results.map(resultToWire));
  });

  fastify.post('/document-verifications', {
    schema: {
      body: Type.Object({ verificationCode: Type.String({ minLength: 4, maxLength: 64 }), requesterNote: Type.Optional(Type.String({ maxLength: 300 })) }),
      response: {
        200: VerificationSchema,
      },
    },
    preHandler: [requirePermission('document:verify')],
  }, async (request, reply) => {
    const { verificationCode, requesterNote } = request.body as { verificationCode: string; requesterNote?: string };
    const result = await fastify.awardDocumentService.verify(request.tenantId, verificationCode, request.user.sub, requesterNote);
    await reply.send(resultToWire(result));
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

  fastify.get('/graduation-cycles', {
    schema: { response: { 200: Type.Array(Type.Object({
      cycleId: Type.String(), cycleCode: Type.String(), title: Type.String(), awardsFrom: Type.String(), awardsTo: Type.String(),
      statusCode: Type.String(), createdAt: Type.String(), frozenAt: Nullable(Type.String()),
    })) } },
    preHandler: [requirePermission('graduation:read')],
  }, async (request, reply) => {
    const cycles = await fastify.graduationService.listCycles(request.tenantId);
    await reply.send(cycles.map((c) => ({
      cycleId: c.id, cycleCode: c.cycleCode, title: c.title, awardsFrom: c.awardsFrom, awardsTo: c.awardsTo, statusCode: c.statusCode,
      createdAt: c.createdAt.toISOString(), frozenAt: c.frozenAt?.toISOString() ?? null,
    })));
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
    schema: { params: Type.Object({ cycleId: Type.String() }), response: { 200: Type.Array(Type.Composite([InvitationSchema, Type.Object({
      studentName: Type.String(), studentNumber: Type.String(), allocation: Type.Union([AllocationSchema, Type.Null()]),
    })])) } },
    preHandler: [requirePermission('graduation:read')],
  }, async (request, reply) => {
    const { cycleId } = request.params as { cycleId: string };
    const rows = await fastify.graduationService.listInvitationsWithAllocations(request.tenantId, cycleId);
    await reply.send(rows.map(({ studentName, studentNumber, allocation, ...i }) => ({
      ...invitationToWire(i), studentName, studentNumber, allocation: allocation ? allocationToWire(allocation) : null,
    })));
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

function revocationToWire(r: RevocationRequestDto) {
  return { ...r, requestedAt: r.requestedAt.toISOString(), decision: r.decision ? { ...r.decision, decidedAt: r.decision.decidedAt.toISOString() } : null };
}

export function resultToWire(r: VerificationResult) {
  return { ...r, document: r.document ? { ...r.document, issuedAt: r.document.issuedAt.toISOString() } : null };
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
