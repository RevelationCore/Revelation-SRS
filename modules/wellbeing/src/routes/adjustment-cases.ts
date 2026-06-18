import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

import { withWellbeingTenantContext } from '../db/client.js';
import type { SrsAdjustmentClient } from '../srs/srs-adjustment-client.js';
import {
  createAdjustmentCase,
  findCurrentAdjustmentCase,
  listAdjustmentCasesForPerson,
  transitionAdjustmentStatus,
  personHasActiveModules,
  recordAssessment,
  listAssessments,
  recordPanelDecision,
  getCurrentPanelDecision,
} from '../repositories/adjustment-case-repository.js';
import {
  enqueueHandoff,
  findHandoffForCase,
  markHandoffSent,
  markHandoffFailed,
} from '../repositories/srs-handoff-repository.js';
import { appendAudit } from '../repositories/audit-log-repository.js';

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
      wellbeingCaseId:         string;
      disabilitySupportCaseId: string;
      personId:                string;
      adjustmentTypeCode:      string;
      rationale?:              string;
      dsaEntitlementId?:       string;
    };
  }>('/api/v1/adjustment-cases', async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const body         = request.body;

    const caseId = await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const id = await createAdjustmentCase(tx, tenantId, actorId, {
          wellbeingCaseId:         body.wellbeingCaseId,
          disabilitySupportCaseId: body.disabilitySupportCaseId,
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

  // ── GET /api/v1/adjustment-cases?personId= ────────────────────────────────

  fastify.get<{
    Querystring: { personId?: string };
  }>('/api/v1/adjustment-cases', async (request, reply) => {
    const { tenantId } = request;
    const { personId } = request.query;

    if (!personId) {
      return reply.code(400).send({ error: 'personId query parameter is required' });
    }

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

        const [assessments, panelDecision, handoff] = await Promise.all([
          listAssessments(tx, tenantId, caseId),
          getCurrentPanelDecision(tx, tenantId, caseId),
          findHandoffForCase(tx, caseId),
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

        return { c, assessments, panelDecision, handoff };
      },
    );

    if (!result) {
      return reply.code(404).send({ error: 'Adjustment case not found' });
    }

    return reply.send({
      ...result.c,
      assessments:    result.assessments,
      panelDecision:  result.panelDecision,
      srsHandoffStatus: result.handoff?.statusCode ?? null,
    });
  });

  // ── PATCH /api/v1/adjustment-cases/:caseId/status ─────────────────────────

  fastify.patch<{
    Params: { caseId: string };
    Body:   { statusCode: string; recommendedAdjustment?: string; rationale?: string };
  }>('/api/v1/adjustment-cases/:caseId/status', async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { caseId }   = request.params;
    const { statusCode, recommendedAdjustment, rationale } = request.body;

    await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        await transitionAdjustmentStatus(tx, tenantId, caseId, statusCode, actorId, {
          ...(recommendedAdjustment !== undefined ? { recommendedAdjustment } : {}),
          ...(rationale             !== undefined ? { rationale }             : {}),
        });
      },
    );

    return reply.code(204).send();
  });

  // ── POST /api/v1/adjustment-cases/:caseId/assessments ─────────────────────

  fastify.post<{
    Params: { caseId: string };
    Body: {
      assessorId:        string;
      assessedAt:        string;
      outcomeCode:       string;
      findings?:         string;
      recommendedAction?: string;
    };
  }>('/api/v1/adjustment-cases/:caseId/assessments', async (request, reply) => {
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

        // Transition case to under_review if still pending assessment
        if (['referral_received', 'assessment_pending', 'under_assessment', 'determination_made'].includes(c.statusCode)) {
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

        // Check existing handoff — idempotent re-approve
        const existing = await findHandoffForCase(tx, caseId);
        if (existing) {
          outboxId    = existing.id;
          alreadySent = existing.statusCode === 'sent';
          return; // do not create a second outbox record
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
}
