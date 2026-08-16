import { requirePermission } from '@revelation-srs/auth';
import {
  createPostgresDocumentAdapter,
  DocumentNotFoundError,
  DocumentTooLargeError,
  DocumentTypeNotAllowedError,
  type RetrievedDocument,
} from '@revelation-srs/documents';
import { hasPermission, type Permission } from '@revelation-srs/domain';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { withWellbeingTenantContext } from '../db/client.js';
import type { SrsAdjustmentClient } from '../srs/srs-adjustment-client.js';
import {
  createAdjustmentCase,
  findCurrentAdjustmentCase,
  listAdjustmentCasesForPerson,
  listAllAdjustmentCases,
  transitionAdjustmentStatus,
  personHasActiveModules,
  recordAssessment,
  listAssessments,
  recordPanelDecision,
  getCurrentPanelDecision,
  hasApprovableDetermination,
  ApprovalPreconditionError,
} from '../repositories/adjustment-case-repository.js';
import type { AdjustmentCase } from '../db/schema/adjustment.js';
import {
  createEvidence,
  listEvidence,
  findEvidence,
  softDeleteEvidence,
} from '../repositories/adjustment-case-evidence-repository.js';
import {
  createDisabilityCase,
  listCasesForPerson,
} from '../repositories/disability-case-repository.js';
import type { WellbeingTx } from '../db/client.js';
import {
  enqueueHandoff,
  findHandoffForCase,
  markHandoffSent,
  markHandoffFailed,
} from '../repositories/srs-handoff-repository.js';
import { appendAudit } from '../repositories/audit-log-repository.js';

// ── Own-record authorization ────────────────────────────────────────────────
//
// Staff hold 'adjustment-case:read:all'/'adjustment-case:manage'/
// 'panel-decision:write' and may act on any case. A student only holds
// 'adjustment-case:read:own'/'adjustment-case:write:own' and may only act
// on a case whose personId is their own srsPersonId JWT claim — unlike
// most other SRS routes, that comparison can't be done against a URL
// :personId param here (routes are keyed by :caseId), so the case has to
// be loaded first.

// eslint-disable-next-line @typescript-eslint/require-await
async function assertCaseAccess(
  request: FastifyRequest,
  c: AdjustmentCase,
  opts: { ownPermission: Permission; allPermission: Permission },
): Promise<void> {
  const roles = request.user.roles;
  if (hasPermission(roles, opts.allPermission)) return;
  if (hasPermission(roles, opts.ownPermission) && c.personId === request.user.srsPersonId) return;
  throw Object.assign(new Error(`Role(s) ${roles.join(', ')} may not access this adjustment case`), { statusCode: 403 });
}

function assertOwnPersonOrAll(request: FastifyRequest, targetPersonId: string, ownPermission: Permission, allPermission: Permission): void {
  const roles = request.user.roles;
  if (hasPermission(roles, allPermission)) return;
  if (hasPermission(roles, ownPermission) && targetPersonId === request.user.srsPersonId) return;
  throw Object.assign(new Error(`Role(s) ${roles.join(', ')} may not access records for this person`), { statusCode: 403 });
}

/**
 * Reuse the person's current disability support case if they have one;
 * otherwise open a new interim referral. Used when an adjustment-case
 * create request doesn't supply the IDs directly (the student
 * self-service path — see the POST handler below).
 */
async function resolveDisabilityCaseForPerson(
  tx: WellbeingTx, tenantId: string, actorId: string, personId: string,
): Promise<{ wellbeingCaseId: string; disabilityCaseId: string }> {
  const existing = await listCasesForPerson(tx, tenantId, personId);
  const current  = existing.at(-1);
  if (current) {
    return { wellbeingCaseId: current.wellbeingCase.id, disabilityCaseId: current.disabilityCase.id };
  }
  return createDisabilityCase(tx, tenantId, actorId, { personId, supportTypeCode: 'interim' });
}

// ── Route plugin ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/require-await
export async function adjustmentCaseRoutes(
  fastify: FastifyInstance,
  opts: { srsClient: SrsAdjustmentClient },
): Promise<void> {
  const { srsClient } = opts;

  // ── POST /api/v1/adjustment-cases ─────────────────────────────────────────

  fastify.post<{
    Body: {
      wellbeingCaseId?:        string;
      disabilitySupportCaseId?: string;
      personId:                string;
      adjustmentTypeCode:      string;
      rationale?:              string;
      dsaEntitlementId?:       string;
    };
  }>('/api/v1/adjustment-cases', async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const body         = request.body;

    assertOwnPersonOrAll(request, body.personId, 'adjustment-case:write:own', 'adjustment-case:manage');

    const caseId = await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        // Staff creating a case on behalf of a student normally already
        // know the disability support case to attach it to. A student
        // requesting their own first adjustment typically doesn't have
        // one yet — resolve (reuse the current one, or open a new
        // interim referral) rather than requiring the caller to supply
        // opaque IDs they can't know.
        let wellbeingCaseId = body.wellbeingCaseId;
        let disabilitySupportCaseId = body.disabilitySupportCaseId;
        if (!wellbeingCaseId || !disabilitySupportCaseId) {
          const resolved = await resolveDisabilityCaseForPerson(tx, tenantId, actorId, body.personId);
          wellbeingCaseId = resolved.wellbeingCaseId;
          disabilitySupportCaseId = resolved.disabilityCaseId;
        }

        const id = await createAdjustmentCase(tx, tenantId, actorId, {
          wellbeingCaseId,
          disabilitySupportCaseId,
          personId:                body.personId,
          adjustmentTypeCode:      body.adjustmentTypeCode,
          ...(body.rationale       !== undefined ? { rationale:       body.rationale }       : {}),
          ...(body.dsaEntitlementId !== undefined ? { dsaEntitlementId: body.dsaEntitlementId } : {}),
        });

        await appendAudit(tx, {
          tenantId,
          actorId,
          actionCode:   'write',
          resourceType: 'disability-case',
          resourceId:   id,
          personId:     body.personId,
          context:      { action: 'create-adjustment', adjustmentTypeCode: body.adjustmentTypeCode },
        });

        return id;
      },
    );

    return reply.code(201).send({ id: caseId });
  });

  // ── GET /api/v1/adjustment-cases?personId=  (own/all)  ─────────────────────
  // ── GET /api/v1/adjustment-cases?statusCode=  (all — staff triage queue) ───
  //
  // personId omitted -> a cross-student queue, staff-only
  // (adjustment-case:read:all); a student without that permission must
  // supply their own personId (enforced by assertOwnPersonOrAll).

  fastify.get<{
    Querystring: { personId?: string; statusCode?: string };
  }>('/api/v1/adjustment-cases', async (request, reply) => {
    const { tenantId } = request;
    const { personId, statusCode } = request.query;

    if (!personId) {
      if (!hasPermission(request.user.roles, 'adjustment-case:read:all')) {
        return reply.code(400).send({ error: 'personId query parameter is required' });
      }
      const cases = await withWellbeingTenantContext(
        request.server.wellbeingDb,
        tenantId,
        (tx) => listAllAdjustmentCases(tx, tenantId, statusCode),
      );
      return reply.send({ items: cases, total: cases.length });
    }

    assertOwnPersonOrAll(request, personId, 'adjustment-case:read:own', 'adjustment-case:read:all');

    const cases = await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      (tx) => listAdjustmentCasesForPerson(tx, tenantId, personId),
    );

    return reply.send({ items: cases, total: cases.length });
  });

  // ── GET /api/v1/adjustment-cases/:caseId ─────────────────────────────────

  fastify.get<{
    Params: { caseId: string };
  }>('/api/v1/adjustment-cases/:caseId', async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { caseId }   = request.params;

    const result = await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const c = await findCurrentAdjustmentCase(tx, tenantId, caseId);
        if (!c) return null;

        await assertCaseAccess(request, c, { ownPermission: 'adjustment-case:read:own', allPermission: 'adjustment-case:read:all' });

        const [assessments, panelDecision, handoff, evidence] = await Promise.all([
          listAssessments(tx, tenantId, caseId),
          getCurrentPanelDecision(tx, tenantId, caseId),
          findHandoffForCase(tx, caseId),
          listEvidence(tx, tenantId, caseId),
        ]);

        await appendAudit(tx, {
          tenantId,
          actorId,
          actionCode:   'read',
          resourceType: 'disability-case',
          resourceId:   caseId,
          personId:     c.personId,
          context:      { action: 'read-adjustment' },
        });

        return { c, assessments, panelDecision, handoff, evidence };
      },
    );

    if (!result) {
      return reply.code(404).send({ error: 'Adjustment case not found' });
    }

    return reply.send({
      ...result.c,
      assessments:      result.assessments,
      panelDecision:    result.panelDecision,
      srsHandoffStatus: result.handoff?.statusCode ?? null,
      evidence:         result.evidence,
    });
  });

  // ── POST /api/v1/adjustment-cases/:caseId/start-assessment ────────────────
  //
  // referral_received|assessment_pending -> under_assessment. Manual action;
  // no other trigger naturally produces this transition.

  fastify.post<{
    Params: { caseId: string };
  }>('/api/v1/adjustment-cases/:caseId/start-assessment', {
    preHandler: [requirePermission('adjustment-case:assess')],
  }, async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { caseId }   = request.params;

    await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      (tx) => transitionAdjustmentStatus(tx, tenantId, caseId, 'under_assessment', actorId),
    );

    return reply.code(204).send();
  });

  // ── POST /api/v1/adjustment-cases/:caseId/request-review ──────────────────
  //
  // Reopens an approved/rejected case for review.

  fastify.post<{
    Params: { caseId: string };
  }>('/api/v1/adjustment-cases/:caseId/request-review', {
    preHandler: [requirePermission('adjustment-case:manage')],
  }, async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { caseId }   = request.params;

    await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      (tx) => transitionAdjustmentStatus(tx, tenantId, caseId, 'under_review', actorId),
    );

    return reply.code(204).send();
  });

  // ── POST /api/v1/adjustment-cases/:caseId/close ────────────────────────────

  fastify.post<{
    Params: { caseId: string };
  }>('/api/v1/adjustment-cases/:caseId/close', {
    preHandler: [requirePermission('adjustment-case:manage')],
  }, async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { caseId }   = request.params;

    await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      (tx) => transitionAdjustmentStatus(tx, tenantId, caseId, 'closed', actorId),
    );

    return reply.code(204).send();
  });

  // ── PATCH /api/v1/adjustment-cases/:caseId/status-correction ──────────────
  //
  // Administrative correction only — bypasses the state-machine check, but
  // requires an explicit reason and the same 'manage' permission as every
  // other write action, and is audited distinctly from a normal transition
  // so a correction is never mistaken for ordinary case progression.

  fastify.patch<{
    Params: { caseId: string };
    Body:   { statusCode: string; reason: string };
  }>('/api/v1/adjustment-cases/:caseId/status-correction', {
    preHandler: [requirePermission('adjustment-case:manage')],
  }, async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { caseId }   = request.params;
    const { statusCode, reason } = request.body;

    await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const c = await findCurrentAdjustmentCase(tx, tenantId, caseId);
        if (!c) throw Object.assign(new Error('Adjustment case not found'), { statusCode: 404 });

        await transitionAdjustmentStatus(tx, tenantId, caseId, statusCode, actorId, undefined, { skipValidation: true });

        await appendAudit(tx, {
          tenantId,
          actorId,
          actionCode:   'write',
          resourceType: 'disability-case',
          resourceId:   caseId,
          personId:     c.personId,
          context:      { action: 'status-correction', from: c.statusCode, to: statusCode, reason },
        });
      },
    );

    return reply.code(204).send();
  });

  // ── POST /api/v1/adjustment-cases/:caseId/assessments ─────────────────────
  //
  // Recording an assessment also progresses the case: a conclusive outcome
  // (recommended/not-recommended) advances it to determination_made;
  // referred-to-panel escalates it directly to under_review, same
  // destination as a panel decision itself (the assessor is flagging the
  // need for one, not yet recording one).

  fastify.post<{
    Params: { caseId: string };
    Body: {
      assessorId:        string;
      assessedAt:        string;
      outcomeCode:       string;
      findings?:         string;
      recommendedAction?: string;
    };
  }>('/api/v1/adjustment-cases/:caseId/assessments', {
    preHandler: [requirePermission('adjustment-case:assess')],
  }, async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { caseId }   = request.params;
    const body         = request.body;

    const assessmentId = await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const c = await findCurrentAdjustmentCase(tx, tenantId, caseId);
        if (!c) {
          throw Object.assign(new Error('Adjustment case not found'), { statusCode: 404 });
        }

        const id = await recordAssessment(tx, tenantId, {
          adjustmentCaseId:  caseId,
          assessorId:        body.assessorId,
          assessedAt:        new Date(body.assessedAt),
          outcomeCode:       body.outcomeCode,
          ...(body.findings          !== undefined ? { findings:          body.findings }          : {}),
          ...(body.recommendedAction !== undefined ? { recommendedAction: body.recommendedAction } : {}),
        });

        if (body.outcomeCode === 'recommended' || body.outcomeCode === 'not-recommended') {
          await transitionAdjustmentStatus(tx, tenantId, caseId, 'determination_made', actorId);
        } else if (body.outcomeCode === 'referred-to-panel') {
          await transitionAdjustmentStatus(tx, tenantId, caseId, 'under_review', actorId);
        }

        await appendAudit(tx, {
          tenantId,
          actorId,
          actionCode:   'write',
          resourceType: 'disability-case',
          resourceId:   id,
          personId:     c.personId,
          context:      { action: 'record-assessment', outcomeCode: body.outcomeCode },
        });

        return id;
      },
    );

    return reply.code(201).send({ id: assessmentId });
  });

  // ── POST /api/v1/adjustment-cases/:caseId/panel-decisions ─────────────────

  fastify.post<{
    Params: { caseId: string };
    Body: {
      panelChairId:      string;
      panelDate:         string;
      decisionCode:      string;
      decisionRationale?: string;
    };
  }>('/api/v1/adjustment-cases/:caseId/panel-decisions', {
    preHandler: [requirePermission('panel-decision:write')],
  }, async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { caseId }   = request.params;
    const body         = request.body;

    const decisionId = await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const c = await findCurrentAdjustmentCase(tx, tenantId, caseId);
        if (!c) {
          throw Object.assign(new Error('Adjustment case not found'), { statusCode: 404 });
        }

        const id = await recordPanelDecision(tx, tenantId, {
          adjustmentCaseId:  caseId,
          panelChairId:      body.panelChairId,
          panelDate:         new Date(body.panelDate),
          decisionCode:      body.decisionCode,
          ...(body.decisionRationale !== undefined ? { decisionRationale: body.decisionRationale } : {}),
        });

        // Transition case to under_review if not already there
        if (c.statusCode !== 'under_review') {
          await transitionAdjustmentStatus(tx, tenantId, caseId, 'under_review', actorId);
        }

        await appendAudit(tx, {
          tenantId,
          actorId,
          actionCode:   'write',
          resourceType: 'disability-case',
          resourceId:   caseId,
          personId:     c.personId,
          context:      { action: 'record-panel-decision', decisionCode: body.decisionCode },
        });

        return id;
      },
    );

    return reply.code(201).send({ id: decisionId });
  });

  // ── POST /api/v1/adjustment-cases/:caseId/approve ─────────────────────────
  //
  // Atomically transitions case to 'approved' and enqueues SRS handoff.
  // The idempotency_key UNIQUE constraint means duplicate calls are safe.
  // After the DB commit, we attempt synchronous SRS delivery.
  //
  // Precondition: approval requires either a recommending needs assessment
  // or an upheld/modified panel decision — referral information alone is
  // not sufficient (hasApprovableDetermination).

  fastify.post<{
    Params: { caseId: string };
    Body: {
      enrolmentId:           string;
      scopeCode:             string;
      recommendedAdjustment: string;
      validFrom:             string;
      validTo?:              string;
      notes?:                string;
      forceApprove?:         boolean;
    };
  }>('/api/v1/adjustment-cases/:caseId/approve', {
    preHandler: [requirePermission('panel-decision:write')],
  }, async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { caseId }   = request.params;
    const body         = request.body;

    // ── Phase 1: DB — validate, transition, enqueue (atomic) ──────────────

    let personId    = '';
    let outboxId    = '';
    let alreadySent = false;

    await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const c = await findCurrentAdjustmentCase(tx, tenantId, caseId);
        if (!c) {
          throw Object.assign(new Error('Adjustment case not found'), { statusCode: 404 });
        }
        personId = c.personId;

        // Check existing handoff — idempotent re-approve. Checked before
        // the determination precondition so a retried/duplicate approve
        // call on an already-approved case still short-circuits cleanly.
        const existing = await findHandoffForCase(tx, caseId);
        if (existing) {
          outboxId    = existing.id;
          alreadySent = existing.statusCode === 'sent';
          return; // do not create a second outbox record
        }

        if (!await hasApprovableDetermination(tx, tenantId, caseId)) {
          throw Object.assign(new ApprovalPreconditionError(), { statusCode: 409 });
        }

        // Validate module registrations unless caller opts out
        if (!body.forceApprove) {
          const hasModules = await personHasActiveModules(tx, tenantId, personId);
          if (!hasModules) {
            throw Object.assign(
              new Error('Person has no active module registrations in SRS projection. Use forceApprove:true to override.'),
              { statusCode: 422 },
            );
          }
        }

        // Transition to approved (bitemporal)
        await transitionAdjustmentStatus(tx, tenantId, caseId, 'approved', actorId, {
          recommendedAdjustment: body.recommendedAdjustment,
        });

        // Enqueue handoff payload — ON CONFLICT DO NOTHING if already exists
        const payload: Record<string, unknown> = {
          tenantId,
          personId,
          enrolmentId:        body.enrolmentId,
          adjustmentTypeCode: c.adjustmentTypeCode,
          scopeCode:          body.scopeCode,
          validFrom:          body.validFrom,
          recommendedAdjustment: body.recommendedAdjustment,
          sourceCaseId:       caseId,
        };
        if (body.validTo !== undefined) payload['validTo'] = body.validTo;
        if (body.notes   !== undefined) payload['notes']   = body.notes;

        await enqueueHandoff(tx, tenantId, caseId, personId, payload);

        // Fetch the newly created outbox record ID
        const newOutbox = await findHandoffForCase(tx, caseId);
        if (!newOutbox) throw new Error('Failed to enqueue handoff');
        outboxId = newOutbox.id;

        await appendAudit(tx, {
          tenantId,
          actorId,
          actionCode:   'write',
          resourceType: 'disability-case',
          resourceId:   caseId,
          personId,
          context:      { action: 'approve', scopeCode: body.scopeCode },
        });
      },
    );

    if (alreadySent) {
      // Already delivered to SRS — return cached result
      const outbox = await findHandoffForCase(request.server.wellbeingDb, caseId);
      return reply.code(200).send({
        status:       'already_sent',
        adjustmentId: (outbox?.srsResponse as { adjustmentId?: string } | null)?.adjustmentId ?? null,
      });
    }

    // ── Phase 2: SRS HTTP call (outside the DB transaction) ───────────────
    //
    // The outbox record with the idempotency_key is already committed.
    // Even if this process crashes here, a retry will find the pending outbox
    // record and re-attempt delivery without creating a duplicate.

    try {
      const result = await srsClient.submitAdjustment({
        idempotencyKey:     `adj-handoff-${caseId}`,
        personId,
        enrolmentId:        body.enrolmentId,
        adjustmentTypeCode: (await withWellbeingTenantContext(
          request.server.wellbeingDb,
          tenantId,
          (tx) => findCurrentAdjustmentCase(tx, tenantId, caseId).then((c) => c?.adjustmentTypeCode ?? ''),
        )),
        scopeCode:          body.scopeCode,
        validFrom:          body.validFrom,
        sourceCaseId:       caseId,
        ...(body.validTo !== undefined ? { validTo: body.validTo } : {}),
        ...(body.notes   !== undefined ? { notes:   body.notes }   : {}),
      });

      await markHandoffSent(request.server.wellbeingDb, outboxId, { adjustmentId: result.adjustmentId });

      // Record SRS ref on case (new bitemporal version)
      await withWellbeingTenantContext(
        request.server.wellbeingDb,
        tenantId,
        (tx) => transitionAdjustmentStatus(tx, tenantId, caseId, 'approved', actorId, {
          srsApplicationRef: result.adjustmentId,
        }),
      );

      return reply.code(202).send({ status: 'submitted', adjustmentId: result.adjustmentId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await markHandoffFailed(request.server.wellbeingDb, outboxId, msg);
      return reply.code(502).send({ error: 'SRS handoff failed — will be retried', detail: msg });
    }
  });

  // ── POST /api/v1/adjustment-cases/:caseId/reject ──────────────────────────

  fastify.post<{
    Params: { caseId: string };
    Body:   { rationale: string };
  }>('/api/v1/adjustment-cases/:caseId/reject', {
    preHandler: [requirePermission('panel-decision:write')],
  }, async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { caseId }   = request.params;

    await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const c = await findCurrentAdjustmentCase(tx, tenantId, caseId);
        if (!c) {
          throw Object.assign(new Error('Adjustment case not found'), { statusCode: 404 });
        }
        await transitionAdjustmentStatus(tx, tenantId, caseId, 'rejected', actorId, {
          rationale: request.body.rationale,
        });
      },
    );

    return reply.code(204).send();
  });

  // ── Evidence ────────────────────────────────────────────────────────────────
  //
  // The document adapter's own queries are RLS-tenant-scoped just like
  // every other table here (see packages/documents' migration) — it must
  // therefore run against the SAME transaction as the rest of a request's
  // reads/writes, not a connection opened outside withWellbeingTenantContext.
  // A previous version of this code called the (constructor-injected)
  // adapter outside the transaction; that only worked in tests because the
  // test database role happens to bypass RLS (superuser), masking what
  // would be a hard failure — or worse, a silent tenant-isolation gap — in
  // production. Fixed by constructing the adapter fresh from `tx` each time.

  fastify.post(
    '/api/v1/adjustment-cases/:caseId/evidence',
    async (request: FastifyRequest<{ Params: { caseId: string } }>, reply: FastifyReply) => {
      const { tenantId } = request;
      const actorId      = request.user.sub;
      const { caseId }   = request.params;

      const file = await request.file();
      if (!file) return reply.code(400).send({ error: 'multipart file field is required' });
      const evidenceTypeCode = (file.fields['evidenceTypeCode'] as { value?: string } | undefined)?.value ?? 'other';
      const content = await file.toBuffer();

      try {
        const evidenceId = await withWellbeingTenantContext(
          request.server.wellbeingDb,
          tenantId,
          async (tx) => {
            const c = await findCurrentAdjustmentCase(tx, tenantId, caseId);
            if (!c) throw Object.assign(new Error('Adjustment case not found'), { statusCode: 404 });
            await assertCaseAccess(request, c, { ownPermission: 'adjustment-case:write:own', allPermission: 'adjustment-case:manage' });

            const stored = await createPostgresDocumentAdapter(tx).store({
              tenantId,
              ownerService: 'wellbeing',
              ownerRef:     caseId,
              filename:     file.filename,
              mimeType:     file.mimetype,
              content,
              actorId,
            });

            const id = await createEvidence(tx, tenantId, {
              adjustmentCaseId: caseId,
              documentId:       stored.documentId,
              evidenceTypeCode,
              uploadedBy:       actorId,
            });

            await appendAudit(tx, {
              tenantId, actorId, actionCode: 'write', resourceType: 'disability-case',
              resourceId: caseId, personId: c.personId,
              context: { action: 'upload-evidence', evidenceTypeCode },
            });

            return { id, documentId: stored.documentId, checksumSha256: stored.checksumSha256 };
          },
        );

        return reply.code(201).send(evidenceId);
      } catch (err) {
        if (err instanceof DocumentTooLargeError || err instanceof DocumentTypeNotAllowedError) {
          return reply.code(422).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  fastify.get<{
    Params: { caseId: string; evidenceId: string };
  }>('/api/v1/adjustment-cases/:caseId/evidence/:evidenceId', async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { caseId, evidenceId } = request.params;

    let doc: RetrievedDocument;
    try {
      doc = await withWellbeingTenantContext(
        request.server.wellbeingDb,
        tenantId,
        async (tx) => {
          const c = await findCurrentAdjustmentCase(tx, tenantId, caseId);
          if (!c) throw Object.assign(new Error('Adjustment case not found'), { statusCode: 404 });
          await assertCaseAccess(request, c, { ownPermission: 'adjustment-case:read:own', allPermission: 'adjustment-case:read:all' });

          const evidence = await findEvidence(tx, tenantId, caseId, evidenceId);
          if (!evidence) throw Object.assign(new Error('Evidence not found'), { statusCode: 404 });

          return createPostgresDocumentAdapter(tx).retrieve(tenantId, evidence.documentId, actorId);
        },
      );
    } catch (err) {
      if (err instanceof DocumentNotFoundError) return reply.code(404).send({ error: 'Document not found' });
      throw err;
    }

    return reply
      .header('content-type', doc.mimeType)
      .header('content-disposition', `attachment; filename="${doc.filename}"`)
      .send(doc.content);
  });

  fastify.delete<{
    Params: { caseId: string; evidenceId: string };
  }>('/api/v1/adjustment-cases/:caseId/evidence/:evidenceId', {
    preHandler: [requirePermission('adjustment-case:manage')],
  }, async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { caseId, evidenceId } = request.params;

    await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const c = await findCurrentAdjustmentCase(tx, tenantId, caseId);
        if (!c) throw Object.assign(new Error('Adjustment case not found'), { statusCode: 404 });

        const evidence = await findEvidence(tx, tenantId, caseId, evidenceId);
        if (!evidence) throw Object.assign(new Error('Evidence not found'), { statusCode: 404 });

        await createPostgresDocumentAdapter(tx).softDelete(tenantId, evidence.documentId, actorId, 'removed from adjustment case');
        await softDeleteEvidence(tx, tenantId, evidenceId);
        await appendAudit(tx, {
          tenantId, actorId, actionCode: 'write', resourceType: 'disability-case',
          resourceId: caseId, personId: c.personId, context: { action: 'delete-evidence' },
        });
      },
    );

    return reply.code(204).send();
  });
}
