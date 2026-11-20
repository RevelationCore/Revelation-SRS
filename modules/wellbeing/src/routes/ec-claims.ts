import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { sendProblem } from '../http/problem.js';
import { Uuid, Text, DateText, idParams } from '../http/schemas.js';
import { withWellbeingTenantContext } from '../db/client.js';
import type { SrsEcClient } from '../srs/srs-ec-client.js';
import { appendAudit } from '../repositories/audit-log-repository.js';
import {
  createEcClaim,
  findCurrentEcClaim,
  listEcClaimsForPerson,
  transitionEcStatus,
  recordEvidenceReview,
  listEvidenceReviews,
  recordDetermination,
  findLatestDetermination,
  isBoardVisible,
} from '../repositories/ec-claim-repository.js';
import {
  enqueueEcHandoff,
  findEcHandoffForClaim,
  markEcHandoffSent,
  markEcHandoffFailed,
  ecHandoffKey,
} from '../repositories/srs-ec-handoff-repository.js';
import { wellbeingCases } from '../db/schema/wellbeing-case.js';
import { EC_CLAIM_TRANSITIONS, StatusTransitionError, assertTransition } from '../domain/status-rules.js';

import { sendTransitionProblem } from './disability-cases.js';

// ── Internal helpers ──────────────────────────────────────────────────────────

function generateCaseRef(): string {
  const year   = new Date().getFullYear();
  const suffix = Math.random().toString(36).toUpperCase().slice(2, 8);
  return `EC-${year}-${suffix}`;
}

/**
 * The acting user comes from the token, never the request (ADR-028). A
 * client that still names its own reviewer or authoriser is refused rather
 * than silently ignored, so old callers fail loudly.
 */
function actorFieldSent(body: unknown, field: string): boolean {
  return typeof body === 'object' && body !== null && field in body;
}

function refuseActorField(reply: FastifyReply, field: string) {
  return sendProblem(reply, 400, `${field} is not accepted: the signed-in user is recorded as the actor`, { title: 'Actor taken from the token' });
}

// ── Route plugin ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/require-await
export async function ecClaimRoutes(
  fastify: FastifyInstance,
  opts:    { srsEcClient: SrsEcClient },
): Promise<void> {
  const { srsEcClient } = opts;

  // ── POST /api/v1/ec-claims ────────────────────────────────────────────────

  fastify.post<{
    Body: {
      personId:                string;
      enrolmentId:             string;
      assessmentPeriodRef:     string;
      affectedModuleCodes:     string[];
      circumstancesNarrative?: string;
      evidenceDeadline?:       string;
      assignedAdvisorId?:      string;
    };
  }>('/api/v1/ec-claims', { preHandler: [requirePermission('ec-claim:manage')], schema: { tags: ['ec-claims'], summary: 'Record an EC claim', body: Type.Object({ personId: Uuid, enrolmentId: Uuid, assessmentPeriodRef: Text, affectedModuleCodes: Type.Array(Text), circumstancesNarrative: Type.Optional(Type.String()), evidenceDeadline: Type.Optional(Type.String()), assignedAdvisorId: Type.Optional(Type.String()) }) } }, async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const body         = request.body;

    const { claimId, wellbeingCaseId } = await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        // Auto-create parent wellbeing_case
        const [wc] = await tx.insert(wellbeingCases).values({
          tenantId,
          personId:          body.personId,
          caseRef:           generateCaseRef(),
          statusCode:        'active',
          ...(body.assignedAdvisorId !== undefined ? { assignedAdvisorId: body.assignedAdvisorId } : {}),
        }).returning({ id: wellbeingCases.id });

        if (!wc) throw new Error('Failed to create wellbeing case');

        const id = await createEcClaim(tx, tenantId, actorId, {
          wellbeingCaseId:     wc.id,
          personId:            body.personId,
          enrolmentId:         body.enrolmentId,
          assessmentPeriodRef: body.assessmentPeriodRef,
          affectedModuleCodes: body.affectedModuleCodes,
          ...(body.circumstancesNarrative !== undefined ? { circumstancesNarrative: body.circumstancesNarrative } : {}),
          ...(body.evidenceDeadline       !== undefined ? { evidenceDeadline: new Date(body.evidenceDeadline) }   : {}),
        });

        await appendAudit(tx, {
          tenantId,
          actorId,
          actionCode:   'write',
          resourceType: 'ec-claim',
          resourceId:   id,
          personId:     body.personId,
          context:      { action: 'create-ec-claim', assessmentPeriodRef: body.assessmentPeriodRef },
        });

        return { claimId: id, wellbeingCaseId: wc.id };
      },
    );

    return reply.code(201).send({ id: claimId, wellbeingCaseId });
  });

  // ── GET /api/v1/ec-claims?personId= ──────────────────────────────────────

  fastify.get<{
    Querystring: { personId?: string };
  }>('/api/v1/ec-claims', { preHandler: [requirePermission('ec-claim:read')], schema: { tags: ['ec-claims'], summary: 'List a person\'s EC claims', querystring: Type.Object({ personId: Type.Optional(Uuid) }) } }, async (request, reply) => {
    const { tenantId } = request;
    const { personId } = request.query;

    if (!personId) {
      return sendProblem(reply, 400, 'personId query parameter is required');
    }

    const claims = await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      (tx) => listEcClaimsForPerson(tx, tenantId, personId),
    );

    return reply.send({ items: claims, total: claims.length });
  });

  // ── GET /api/v1/ec-claims/:claimId ───────────────────────────────────────

  fastify.get<{
    Params: { claimId: string };
  }>('/api/v1/ec-claims/:claimId', { preHandler: [requirePermission('ec-claim:read')], schema: { tags: ['ec-claims'], summary: 'Get an EC claim', params: idParams('claimId') } }, async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { claimId }  = request.params;

    const result = await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const c = await findCurrentEcClaim(tx, tenantId, claimId);
        if (!c) return null;

        const [evidenceReviews, determination, handoff] = await Promise.all([
          listEvidenceReviews(tx, tenantId, claimId),
          findLatestDetermination(tx, tenantId, claimId),
          findEcHandoffForClaim(tx, claimId),
        ]);

        await appendAudit(tx, {
          tenantId,
          actorId,
          actionCode:   'read',
          resourceType: 'ec-claim',
          resourceId:   claimId,
          personId:     c.personId,
          context:      { action: 'read-ec-claim' },
        });

        return { c, evidenceReviews, determination, handoff };
      },
    );

    if (!result) {
      return sendProblem(reply, 404, 'EC claim not found');
    }

    return reply.send({
      ...result.c,
      evidenceReviews:  result.evidenceReviews,
      determination:    result.determination,
      srsHandoffStatus: result.handoff?.statusCode ?? null,
      boardVisible:     result.determination ? isBoardVisible(result.determination.determinationCode) : false,
    });
  });

  // ── PATCH /api/v1/ec-claims/:claimId/status ───────────────────────────────

  fastify.patch<{
    Params: { claimId: string };
    Body:   { statusCode: string; circumstancesNarrative?: string; evidenceDeadline?: string };
  }>('/api/v1/ec-claims/:claimId/status', { preHandler: [requirePermission('ec-claim:manage')], schema: { tags: ['ec-claims'], summary: 'Change the claim status', params: idParams('claimId'), body: Type.Object({ statusCode: Text, circumstancesNarrative: Type.Optional(Type.String()), evidenceDeadline: Type.Optional(Type.String()) }) } }, async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { claimId }  = request.params;
    const { statusCode, circumstancesNarrative, evidenceDeadline } = request.body;

    try {
      await withWellbeingTenantContext(
        request.server.wellbeingDb,
        tenantId,
        async (tx) => {
          const c = await findCurrentEcClaim(tx, tenantId, claimId);
          if (!c) {
            throw Object.assign(new Error('EC claim not found'), { statusCode: 404 });
          }
          // Only a determination may set upheld or not_upheld (ADR-028).
          assertTransition(EC_CLAIM_TRANSITIONS, 'EC claim', c.statusCode, statusCode);
          await transitionEcStatus(tx, tenantId, claimId, statusCode, actorId, {
            ...(circumstancesNarrative !== undefined ? { circumstancesNarrative } : {}),
            ...(evidenceDeadline       !== undefined ? { evidenceDeadline: new Date(evidenceDeadline) } : {}),
          });
          await appendAudit(tx, {
            tenantId,
            actorId,
            actionCode:   'write',
            resourceType: 'ec-claim',
            resourceId:   claimId,
            personId:     c.personId,
            context:      { action: 'status-transition', from: c.statusCode, newStatus: statusCode },
          });
        },
      );
    } catch (err) {
      if (err instanceof StatusTransitionError) return sendTransitionProblem(reply, err);
      throw err;
    }

    return reply.code(204).send();
  });

  // ── POST /api/v1/ec-claims/:claimId/evidence-reviews ─────────────────────

  fastify.post<{
    Params: { claimId: string };
    Body: {
      reviewedAt:         string;
      evidenceStatusCode: string;
      reviewNotes?:       string;
    };
  }>('/api/v1/ec-claims/:claimId/evidence-reviews', { preHandler: [requirePermission('ec-claim:manage')], schema: { tags: ['ec-claims'], summary: 'Record an evidence review (the reviewer is the signed-in user)', params: idParams('claimId'), body: Type.Object({ reviewedAt: DateText, evidenceStatusCode: Text, reviewNotes: Type.Optional(Type.String()) }) } }, async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { claimId }  = request.params;
    const body         = request.body;

    if (actorFieldSent(body, 'reviewerId')) return refuseActorField(reply, 'reviewerId');

    const reviewId = await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const c = await findCurrentEcClaim(tx, tenantId, claimId);
        if (!c) {
          throw Object.assign(new Error('EC claim not found'), { statusCode: 404 });
        }

        const id = await recordEvidenceReview(tx, tenantId, {
          ecClaimId:          claimId,
          reviewerId:         actorId,
          reviewedAt:         new Date(body.reviewedAt),
          evidenceStatusCode: body.evidenceStatusCode,
          ...(body.reviewNotes !== undefined ? { reviewNotes: body.reviewNotes } : {}),
        });

        // Auto-advance status to under_review when evidence is marked sufficient
        if (body.evidenceStatusCode === 'sufficient' && c.statusCode === 'evidence_pending') {
          await transitionEcStatus(tx, tenantId, claimId, 'under_review', actorId);
        }

        await appendAudit(tx, {
          tenantId,
          actorId,
          actionCode:   'write',
          resourceType: 'ec-claim',
          resourceId:   claimId,
          personId:     c.personId,
          context:      { action: 'record-evidence-review', reviewId: id, evidenceStatusCode: body.evidenceStatusCode },
        });

        return id;
      },
    );

    return reply.code(201).send({ id: reviewId });
  });

  // ── POST /api/v1/ec-claims/:claimId/determine ─────────────────────────────
  //
  // Record a determination and, if board-visible, atomically enqueue SRS
  // handoff then attempt synchronous delivery.
  //
  // Upheld/partially_upheld → SRS receives the claim for board preparation.
  // Not_upheld / withdrawn  → determination stays local; SRS is never called.

  fastify.post<{
    Params: { claimId: string };
    Body: {
      determinationCode:       string;
      determinationRationale?: string;
      moduleOutcomes:          Array<{ moduleCode: string; outcome: string }>;
      determinedAt:            string;
    };
  }>('/api/v1/ec-claims/:claimId/determine', { preHandler: [requirePermission('ec-claim:manage')], schema: { tags: ['ec-claims'], summary: 'Determine the claim (the authoriser is the signed-in user)', params: idParams('claimId'), body: Type.Object({ determinationCode: Text, determinationRationale: Type.Optional(Type.String()), moduleOutcomes: Type.Array(Type.Object({ moduleCode: Text, outcome: Text })), determinedAt: DateText }) } }, async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { claimId }  = request.params;
    const body         = request.body;

    if (actorFieldSent(body, 'authorisedById')) return refuseActorField(reply, 'authorisedById');

    const boardVisible = isBoardVisible(body.determinationCode);

    let personId     = '';
    let enrolmentId  = '';
    let outboxId     = '';
    let alreadySent  = false;

    // ── Phase 1: atomic DB write ──────────────────────────────────────────

    try {
      await withWellbeingTenantContext(
        request.server.wellbeingDb,
        tenantId,
        async (tx) => {
          const c = await findCurrentEcClaim(tx, tenantId, claimId);
          if (!c) {
            throw Object.assign(new Error('EC claim not found'), { statusCode: 404 });
          }
          personId    = c.personId;
          enrolmentId = c.enrolmentId;

          // Check for idempotent re-determine
          const existingHandoff = boardVisible ? await findEcHandoffForClaim(tx, claimId) : null;
          if (existingHandoff) {
            outboxId    = existingHandoff.id;
            alreadySent = existingHandoff.statusCode === 'sent';
            return;
          }

          // A withdrawn or closed claim is never determined, so it never reaches SRS.
          if (c.statusCode === 'closed') {
            throw new StatusTransitionError('EC claim', c.statusCode, 'determined', []);
          }

          // Record the determination; the authoriser is the signed-in user (ADR-028).
          await recordDetermination(tx, tenantId, {
            ecClaimId:         claimId,
            authorisedById:    actorId,
            determinationCode: body.determinationCode,
            moduleOutcomes:    body.moduleOutcomes,
            determinedAt:      new Date(body.determinedAt),
            ...(body.determinationRationale !== undefined
              ? { determinationRationale: body.determinationRationale }
              : {}),
          });

          // Transition claim status
          const newStatus = body.determinationCode === 'not_upheld' ? 'not_upheld' : 'upheld';
          await transitionEcStatus(tx, tenantId, claimId, newStatus, actorId);

          if (boardVisible) {
            // Derive F-WELL-SIS-02 outcomeCode from determinationCode
            const outcomeCode = body.determinationCode.replace('_', '-');

            await enqueueEcHandoff(tx, tenantId, claimId, personId, {
              tenantId,
              personId,
              enrolmentId,
              outcomeCode,
              determinationDate: body.determinedAt.split('T')[0] ?? body.determinedAt,
              determinationRationale: body.determinationRationale ?? null,
              moduleOutcomes: body.moduleOutcomes,
            });

            const newOutbox = await findEcHandoffForClaim(tx, claimId);
            if (!newOutbox) throw new Error('Failed to enqueue EC handoff');
            outboxId = newOutbox.id;
          }

          await appendAudit(tx, {
            tenantId,
            actorId,
            actionCode:   'write',
            resourceType: 'ec-claim',
            resourceId:   claimId,
            personId,
            context:      { action: 'determine', determinationCode: body.determinationCode, boardVisible },
          });
        },
      );
    } catch (err) {
      if (err instanceof StatusTransitionError) return sendTransitionProblem(reply, err);
      throw err;
    }

    // ── Not board-visible: return immediately ─────────────────────────────

    if (!boardVisible) {
      return reply.code(204).send();
    }

    if (alreadySent) {
      const outbox = await withWellbeingTenantContext(request.server.wellbeingDb, tenantId, (tx) => findEcHandoffForClaim(tx, claimId));
      return reply.code(200).send({
        status: 'already_sent',
        exceptionalCircumstancesId:
          (outbox?.srsResponse as { exceptionalCircumstancesId?: string } | null)
            ?.exceptionalCircumstancesId ?? null,
      });
    }

    // ── Phase 2: SRS HTTP call (outside the transaction) ─────────────────

    const det  = await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      (tx) => findLatestDetermination(tx, tenantId, claimId),
    );

    try {
      const result = await srsEcClient.submitEc({
        idempotencyKey:    ecHandoffKey(claimId),
        personId,
        enrolmentId,
        outcomeCode:       (det?.determinationCode ?? body.determinationCode).replace('_', '-'),
        determinationDate: body.determinedAt.split('T')[0] ?? body.determinedAt,
        ...(body.determinationRationale !== undefined ? { notes: body.determinationRationale } : {}),
      });

      await withWellbeingTenantContext(request.server.wellbeingDb, tenantId, (tx) => markEcHandoffSent(
        tx,
        outboxId,
        { exceptionalCircumstancesId: result.exceptionalCircumstancesId },
      ));

      return reply.code(202).send({
        status: 'submitted',
        exceptionalCircumstancesId: result.exceptionalCircumstancesId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await withWellbeingTenantContext(request.server.wellbeingDb, tenantId, (tx) => markEcHandoffFailed(tx, outboxId, msg));
      return sendProblem(reply, 502, 'SRS EC handoff failed — will be retried', { cause: msg });
    }
  });

  // ── POST /api/v1/ec-claims/:claimId/withdraw ─────────────────────────────
  //
  // Withdraw a claim. Withdrawn claims never reach SRS regardless of prior state.

  fastify.post<{
    Params: { claimId: string };
    Body:   { reason?: string };
  }>('/api/v1/ec-claims/:claimId/withdraw', { preHandler: [requirePermission('ec-claim:manage')], schema: { tags: ['ec-claims'], summary: 'Withdraw the claim', params: idParams('claimId'), body: Type.Optional(Type.Object({ reason: Type.Optional(Type.String()) })) } }, async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { claimId }  = request.params;
    const reason       = request.body?.reason;

    try {
      await withWellbeingTenantContext(
        request.server.wellbeingDb,
        tenantId,
        async (tx) => {
          const c = await findCurrentEcClaim(tx, tenantId, claimId);
          if (!c) {
            throw Object.assign(new Error('EC claim not found'), { statusCode: 404 });
          }
          assertTransition(EC_CLAIM_TRANSITIONS, 'EC claim', c.statusCode, 'closed');
          await transitionEcStatus(tx, tenantId, claimId, 'closed', actorId);
          await appendAudit(tx, {
            tenantId,
            actorId,
            actionCode:   'write',
            resourceType: 'ec-claim',
            resourceId:   claimId,
            personId:     c.personId,
            context:      { action: 'withdraw', from: c.statusCode, ...(reason !== undefined ? { reason } : {}) },
          });
        },
      );
    } catch (err) {
      if (err instanceof StatusTransitionError) return sendTransitionProblem(reply, err);
      throw err;
    }

    return reply.code(204).send();
  });
}
