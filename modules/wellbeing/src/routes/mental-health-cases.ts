import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

import { withWellbeingTenantContext } from '../db/client.js';
import { appendAudit } from '../repositories/audit-log-repository.js';
import {
  createMentalHealthCase,
  findCurrentMentalHealthCase,
  listMentalHealthCasesForPerson,
  transitionMhStatus,
  updateRiskLevel,
  recordConsent,
  addSessionNote,
  listSessionNotes,
  createInterventionPlan,
  listInterventionPlansForCase,
  transitionPlanStatus,
} from '../repositories/mental-health-case-repository.js';

// ── Route plugin ──────────────────────────────────────────────────────────────

export async function mentalHealthCaseRoutes(fastify: FastifyInstance): Promise<void> {

  // ── POST /api/v1/mental-health-cases ─────────────────────────────────────

  fastify.post<{
    Body: {
      personId:              string;
      presentingConcernCode: string;
      riskLevelCode?:        string;
      assignedAdvisorId?:    string;
      notes?:                string;
    };
  }>('/api/v1/mental-health-cases', async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const body         = request.body;

    const { mhCaseId, wellbeingCaseId } = await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const ids = await createMentalHealthCase(tx, tenantId, actorId, {
          personId:              body.personId,
          presentingConcernCode: body.presentingConcernCode,
          ...(body.riskLevelCode     !== undefined ? { riskLevelCode: body.riskLevelCode }         : {}),
          ...(body.assignedAdvisorId !== undefined ? { assignedAdvisorId: body.assignedAdvisorId } : {}),
          ...(body.notes             !== undefined ? { notes: body.notes }                         : {}),
        });

        await appendAudit(tx, {
          tenantId,
          actorId,
          actionCode:   'write',
          resourceType: 'mental-health-case',
          resourceId:   ids.mhCaseId,
          personId:     body.personId,
          context:      { action: 'create', presentingConcernCode: body.presentingConcernCode },
        });

        return ids;
      },
    );

    return reply.code(201).send({ id: mhCaseId, wellbeingCaseId });
  });

  // ── GET /api/v1/mental-health-cases?personId= ────────────────────────────

  fastify.get<{
    Querystring: { personId?: string };
  }>('/api/v1/mental-health-cases', async (request, reply) => {
    const { tenantId } = request;
    const { personId } = request.query;

    if (!personId) {
      return reply.code(400).send({ error: 'personId query parameter is required' });
    }

    const cases = await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      (tx) => listMentalHealthCasesForPerson(tx, tenantId, personId),
    );

    // Session notes and clinical content are NEVER included in list responses
    return reply.send({ items: cases.map(omitSensitiveFields), total: cases.length });
  });

  // ── GET /api/v1/mental-health-cases/:caseId ──────────────────────────────

  fastify.get<{
    Params: { caseId: string };
  }>('/api/v1/mental-health-cases/:caseId', async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { caseId }   = request.params;

    const result = await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const c = await findCurrentMentalHealthCase(tx, tenantId, caseId);
        if (!c) return null;

        const plans = await listInterventionPlansForCase(tx, tenantId, caseId);

        await appendAudit(tx, {
          tenantId,
          actorId,
          actionCode:   'read',
          resourceType: 'mental-health-case',
          resourceId:   caseId,
          personId:     c.personId,
          context:      { action: 'read-case-detail' },
        });

        return { c, plans };
      },
    );

    if (!result) {
      return reply.code(404).send({ error: 'Mental health case not found' });
    }

    // Session notes are returned only via the dedicated session-notes endpoint
    // to ensure every access is explicitly audited and role-gated.
    return reply.send({
      ...omitSensitiveFields(result.c),
      interventionPlans: result.plans,
    });
  });

  // ── PATCH /api/v1/mental-health-cases/:caseId/status ─────────────────────

  fastify.patch<{
    Params: { caseId: string };
    Body:   { statusCode: string; riskLevelCode?: string };
  }>('/api/v1/mental-health-cases/:caseId/status', async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { caseId }   = request.params;
    const { statusCode, riskLevelCode } = request.body;

    await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        await transitionMhStatus(tx, tenantId, caseId, statusCode, actorId, {
          ...(riskLevelCode !== undefined ? { riskLevelCode } : {}),
        });

        const c = await findCurrentMentalHealthCase(tx, tenantId, caseId);
        if (c) {
          await appendAudit(tx, {
            tenantId,
            actorId,
            actionCode:   'write',
            resourceType: 'mental-health-case',
            resourceId:   caseId,
            personId:     c.personId,
            context:      { action: 'status-transition', statusCode },
          });
        }
      },
    );

    return reply.code(204).send();
  });

  // ── PATCH /api/v1/mental-health-cases/:caseId/risk ───────────────────────

  fastify.patch<{
    Params: { caseId: string };
    Body:   { riskLevelCode: string };
  }>('/api/v1/mental-health-cases/:caseId/risk', async (request, reply) => {
    const { tenantId }    = request;
    const actorId         = request.user.sub;
    const { caseId }      = request.params;
    const { riskLevelCode } = request.body;

    await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        await updateRiskLevel(tx, tenantId, caseId, riskLevelCode, actorId);

        const c = await findCurrentMentalHealthCase(tx, tenantId, caseId);
        if (c) {
          await appendAudit(tx, {
            tenantId,
            actorId,
            actionCode:   'write',
            resourceType: 'mental-health-case',
            resourceId:   caseId,
            personId:     c.personId,
            context:      { action: 'risk-update', riskLevelCode },
          });
        }
      },
    );

    return reply.code(204).send();
  });

  // ── POST /api/v1/mental-health-cases/:caseId/consent ─────────────────────

  fastify.post<{
    Params: { caseId: string };
    Body:   { consentDate: string };
  }>('/api/v1/mental-health-cases/:caseId/consent', async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { caseId }   = request.params;

    await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        await recordConsent(tx, tenantId, caseId, new Date(request.body.consentDate), actorId);

        const c = await findCurrentMentalHealthCase(tx, tenantId, caseId);
        if (c) {
          await appendAudit(tx, {
            tenantId,
            actorId,
            actionCode:   'write',
            resourceType: 'mental-health-case',
            resourceId:   caseId,
            personId:     c.personId,
            context:      { action: 'consent-recorded', consentDate: request.body.consentDate },
          });
        }
      },
    );

    return reply.code(204).send();
  });

  // ── POST /api/v1/mental-health-cases/:caseId/session-notes ───────────────
  //
  // Writes a clinical session note.  Content is special-category health data
  // (UK GDPR Art. 9) and must never be forwarded to SRS events or reports.

  fastify.post<{
    Params: { caseId: string };
    Body: {
      practitionerId: string;
      sessionDate:    string;
      sessionTypeCode: string;
      content:        string;
    };
  }>('/api/v1/mental-health-cases/:caseId/session-notes', {
    preHandler: [requirePermission('mh-session-note:read')],
  }, async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { caseId }   = request.params;
    const body         = request.body;

    const noteId = await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const c = await findCurrentMentalHealthCase(tx, tenantId, caseId);
        if (!c) {
          throw Object.assign(new Error('Mental health case not found'), { statusCode: 404 });
        }

        const id = await addSessionNote(tx, {
          tenantId,
          mentalHealthCaseId: caseId,
          personId:           c.personId,
          practitionerId:     body.practitionerId,
          sessionDate:        new Date(body.sessionDate),
          sessionTypeCode:    body.sessionTypeCode,
          content:            body.content,
          actorId,
        });

        // Write-audit for special-category content creation
        await appendAudit(tx, {
          tenantId,
          actorId,
          actionCode:   'write',
          resourceType: 'mh-session-note',
          resourceId:   id,
          personId:     c.personId,
          context:      { action: 'session-note-created', sessionTypeCode: body.sessionTypeCode },
        });

        return id;
      },
    );

    return reply.code(201).send({ id: noteId });
  });

  // ── GET /api/v1/mental-health-cases/:caseId/session-notes ────────────────
  //
  // EVERY access to session content is read-audited and restricted to the
  // wellbeing-mental-health-advisor role (enforcement at route layer).
  // Content must never appear in aggregate reports or SRS event payloads.

  fastify.get<{
    Params: { caseId: string };
  }>('/api/v1/mental-health-cases/:caseId/session-notes', {
    preHandler: [requirePermission('mh-session-note:read')],
  }, async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { caseId }   = request.params;

    const notes = await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const c = await findCurrentMentalHealthCase(tx, tenantId, caseId);
        if (!c) return null;

        const n = await listSessionNotes(tx, tenantId, caseId);

        // Read-audit: every read of special-category session content is logged
        await appendAudit(tx, {
          tenantId,
          actorId,
          actionCode:   'read',
          resourceType: 'mh-session-note',
          resourceId:   caseId,
          personId:     c.personId,
          context:      { action: 'list-session-notes', noteCount: n.length },
        });

        return n;
      },
    );

    if (notes === null) {
      return reply.code(404).send({ error: 'Mental health case not found' });
    }

    return reply.send({ items: notes, total: notes.length });
  });

  // ── POST /api/v1/mental-health-cases/:caseId/intervention-plans ──────────

  fastify.post<{
    Params: { caseId: string };
    Body: {
      planTypeCode:             string;
      practitionerId:           string;
      sessionFrequencyCode?:    string;
      plannedSessionCount?:     string;
      goals?:                   Array<{ goal: string; targetDate?: string }>;
      reviewDate?:              string;
      externalReferral?:        boolean;
      externalReferralDetails?: string;
    };
  }>('/api/v1/mental-health-cases/:caseId/intervention-plans', async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { caseId }   = request.params;
    const body         = request.body;

    const planId = await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const c = await findCurrentMentalHealthCase(tx, tenantId, caseId);
        if (!c) {
          throw Object.assign(new Error('Mental health case not found'), { statusCode: 404 });
        }

        const id = await createInterventionPlan(tx, tenantId, actorId, {
          mentalHealthCaseId:   caseId,
          personId:             c.personId,
          planTypeCode:         body.planTypeCode,
          practitionerId:       body.practitionerId,
          ...(body.sessionFrequencyCode    !== undefined ? { sessionFrequencyCode: body.sessionFrequencyCode }       : {}),
          ...(body.plannedSessionCount     !== undefined ? { plannedSessionCount: body.plannedSessionCount }         : {}),
          ...(body.goals                   !== undefined ? { goals: body.goals }                                     : {}),
          ...(body.reviewDate              !== undefined ? { reviewDate: new Date(body.reviewDate) }                 : {}),
          ...(body.externalReferral        !== undefined ? { externalReferral: body.externalReferral }               : {}),
          ...(body.externalReferralDetails !== undefined ? { externalReferralDetails: body.externalReferralDetails } : {}),
        });

        await appendAudit(tx, {
          tenantId,
          actorId,
          actionCode:   'write',
          resourceType: 'intervention-plan',
          resourceId:   id,
          personId:     c.personId,
          context:      { action: 'create-plan', planTypeCode: body.planTypeCode },
        });

        return id;
      },
    );

    return reply.code(201).send({ id: planId });
  });

  // ── GET /api/v1/mental-health-cases/:caseId/intervention-plans ───────────

  fastify.get<{
    Params: { caseId: string };
  }>('/api/v1/mental-health-cases/:caseId/intervention-plans', async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { caseId }   = request.params;

    const result = await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const c = await findCurrentMentalHealthCase(tx, tenantId, caseId);
        if (!c) return null;

        const plans = await listInterventionPlansForCase(tx, tenantId, caseId);

        await appendAudit(tx, {
          tenantId,
          actorId,
          actionCode:   'read',
          resourceType: 'intervention-plan',
          resourceId:   caseId,
          personId:     c.personId,
          context:      { action: 'list-plans' },
        });

        return plans;
      },
    );

    if (result === null) {
      return reply.code(404).send({ error: 'Mental health case not found' });
    }

    return reply.send({ items: result, total: result.length });
  });

  // ── PATCH /api/v1/mental-health-cases/:caseId/intervention-plans/:planId/status

  fastify.patch<{
    Params: { caseId: string; planId: string };
    Body:   { statusCode: string };
  }>('/api/v1/mental-health-cases/:caseId/intervention-plans/:planId/status', async (request, reply) => {
    const { tenantId }   = request;
    const actorId        = request.user.sub;
    const { caseId, planId } = request.params;
    const { statusCode } = request.body;

    await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const c = await findCurrentMentalHealthCase(tx, tenantId, caseId);
        if (!c) {
          throw Object.assign(new Error('Mental health case not found'), { statusCode: 404 });
        }

        await transitionPlanStatus(tx, tenantId, planId, statusCode, actorId);

        await appendAudit(tx, {
          tenantId,
          actorId,
          actionCode:   'write',
          resourceType: 'intervention-plan',
          resourceId:   planId,
          personId:     c.personId,
          context:      { action: 'plan-status-transition', statusCode },
        });
      },
    );

    return reply.code(204).send();
  });
}

// ── Privacy helper ────────────────────────────────────────────────────────────

/**
 * Remove fields that must not appear in list or summary responses.
 *
 * Session content is never stored on the MH case row — it lives in
 * mh_session_note.  But consent details and risk level are on the row and
 * may be suppressed for non-clinical readers if role checks are added in a
 * future pass.  For now we strip the versionId (internal PK) from responses.
 */
function omitSensitiveFields<T extends { versionId: string }>(
  row: T,
): Omit<T, 'versionId'> {
  const { versionId: _v, ...rest } = row;
  return rest;
}
