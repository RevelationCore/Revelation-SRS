import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { withWellbeingTenantContext } from '../db/client.js';
import type { EdrmsAdapter } from '../edrms/edrms-adapter.js';
import {
  CLOSED_DISABILITY_STATUSES,
  DISABILITY_CASE_TRANSITIONS,
  EVIDENCE_TRANSITIONS,
  StatusTransitionError,
  allowedNext,
  assertTransition,
} from '../domain/status-rules.js';
import { appendAudit }    from '../repositories/audit-log-repository.js';
import {
  createDisabilityCase,
  findCurrentCase,
  listCasesForPerson,
  listCaseload,
  transitionCaseStatus,
  addDsaEntitlement,
  listDsaEntitlements,
  addEvidenceReference,
  listEvidence,
  updateEvidenceStatus,
  findEvidence,
} from '../repositories/disability-case-repository.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Serialise a CaseWithParent to a JSON-friendly shape. */
function serializeCase(c: Awaited<ReturnType<typeof findCurrentCase>>) {
  if (!c) return null;
  return {
    id:                     c.disabilityCase.id,
    wellbeingCaseId:        c.wellbeingCase.id,
    caseRef:                c.wellbeingCase.caseRef,
    personId:               c.disabilityCase.personId,
    supportTypeCode:        c.disabilityCase.supportTypeCode,
    statusCode:             c.disabilityCase.statusCode,
    supportPlanStatusCode:  c.disabilityCase.supportPlanStatusCode,
    dsaAwardRef:            c.disabilityCase.dsaAwardRef,
    assignedAdvisorId:      c.wellbeingCase.assignedAdvisorId,
    notes:                  c.wellbeingCase.notes,
    validFrom:              c.disabilityCase.validFrom,
    recordedAt:             c.disabilityCase.recordedAt,
    allowedNextStatuses:    allowedNext(DISABILITY_CASE_TRANSITIONS, c.disabilityCase.statusCode),
  };
}

/** A refused status change, in the problem shape the admin client reads. */
export function sendTransitionProblem(reply: FastifyReply, err: StatusTransitionError) {
  return reply.code(409).send({
    type: 'about:blank', title: 'Status change not allowed', status: 409,
    detail: err.message, error: err.message, allowedNextStatuses: err.allowed,
  });
}

const READ  = { preHandler: [requirePermission('disability:read')] };
const WRITE = { preHandler: [requirePermission('disability:write')] };

// ── Route plugin ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/require-await
export async function disabilityCaseRoutes(
  fastify: FastifyInstance,
  opts: { edrms: EdrmsAdapter },
): Promise<void> {
  const { edrms } = opts;

  // ── POST /api/v1/disability-cases ──────────────────────────────────────────

  fastify.post<{
    Body: {
      personId:           string;
      supportTypeCode:    string;
      dsaAwardRef?:       string;
      notes?:             string;
      assignedAdvisorId?: string;
    };
  }>('/api/v1/disability-cases', WRITE, async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const body         = request.body;

    const result = await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const ids = await createDisabilityCase(tx, tenantId, actorId, {
          personId:        body.personId,
          supportTypeCode: body.supportTypeCode as 'dsa' | 'institutional' | 'interim',
          ...(body.dsaAwardRef       !== undefined ? { dsaAwardRef:       body.dsaAwardRef }       : {}),
          ...(body.notes             !== undefined ? { notes:             body.notes }             : {}),
          ...(body.assignedAdvisorId !== undefined ? { assignedAdvisorId: body.assignedAdvisorId } : {}),
        });

        await appendAudit(tx, {
          tenantId,
          actorId,
          actionCode:   'write',
          resourceType: 'disability-case',
          resourceId:   ids.disabilityCaseId,
          personId:     body.personId,
          context:      { action: 'create', supportTypeCode: body.supportTypeCode },
        });

        return ids;
      },
    );

    return reply.code(201).send({
      id:             result.disabilityCaseId,
      wellbeingCaseId: result.wellbeingCaseId,
    });
  });

  // ── GET /api/v1/disability-cases?personId= ─────────────────────────────────

  fastify.get<{
    Querystring: { personId?: string; page?: string; limit?: string };
  }>('/api/v1/disability-cases', READ, async (request, reply) => {
    const { tenantId } = request;
    const { personId } = request.query;

    if (!personId) {
      return reply.code(400).send({ error: 'personId query parameter is required' });
    }

    const cases = await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      (tx) => listCasesForPerson(tx, tenantId, personId),
    );

    return reply.send({ items: cases.map(serializeCase), total: cases.length });
  });

  // ── GET /api/v1/disability-cases/caseload ─────────────────────────────────
  //
  // Open cases across the tenant (closed and rejected left out), newest
  // first, for the staff caseload screen. ?statusCode narrows to one status;
  // ?assignedTo=me to the caller's own cases.

  fastify.get<{
    Querystring: { statusCode?: string; assignedTo?: string };
  }>('/api/v1/disability-cases/caseload', READ, async (request, reply) => {
    const { tenantId } = request;
    const { statusCode, assignedTo } = request.query;
    const cases = await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      (tx) => listCaseload(tx, tenantId, {
        excludeStatuses: [...CLOSED_DISABILITY_STATUSES],
        ...(statusCode ? { statusCode } : {}),
        ...(assignedTo === 'me' ? { assignedAdvisorId: request.user.sub } : {}),
      }),
    );
    return reply.send({ items: cases.map(serializeCase), total: cases.length });
  });

  // ── GET /api/v1/disability-cases/:caseId ──────────────────────────────────

  fastify.get<{
    Params: { caseId: string };
  }>('/api/v1/disability-cases/:caseId', READ, async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { caseId }   = request.params;

    const result = await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const c = await findCurrentCase(tx, tenantId, caseId);
        if (!c) return null;

        const [evidence, entitlements] = await Promise.all([
          listEvidence(tx, tenantId, caseId),
          listDsaEntitlements(tx, tenantId, caseId),
        ]);

        // Read audit for special-category data
        await appendAudit(tx, {
          tenantId,
          actorId,
          actionCode:   'read',
          resourceType: 'disability-case',
          resourceId:   caseId,
          personId:     c.disabilityCase.personId,
        });

        return { c, evidence, entitlements };
      },
    );

    if (!result) {
      return reply.code(404).send({ error: 'Disability case not found' });
    }

    return reply.send({
      ...serializeCase(result.c),
      evidence:     result.evidence.map((e) => ({ ...e, allowedNextStatuses: allowedNext(EVIDENCE_TRANSITIONS, e.statusCode) })),
      entitlements: result.entitlements,
    });
  });

  // ── PATCH /api/v1/disability-cases/:caseId/status ─────────────────────────

  fastify.patch<{
    Params: { caseId: string };
    Body:   { statusCode: string };
  }>('/api/v1/disability-cases/:caseId/status', WRITE, async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { caseId }   = request.params;
    const { statusCode } = request.body;

    try {
    await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const c = await findCurrentCase(tx, tenantId, caseId);
        if (!c) {
          throw Object.assign(new Error('Disability case not found'), { statusCode: 404 });
        }

        assertTransition(DISABILITY_CASE_TRANSITIONS, 'disability case', c.disabilityCase.statusCode, statusCode);
        await transitionCaseStatus(tx, tenantId, caseId, statusCode, actorId);

        await appendAudit(tx, {
          tenantId,
          actorId,
          actionCode:   'write',
          resourceType: 'disability-case',
          resourceId:   caseId,
          personId:     c.disabilityCase.personId,
          context:      { action: 'status-transition', newStatus: statusCode },
        });
      },
    );
    } catch (err) {
      if (err instanceof StatusTransitionError) return sendTransitionProblem(reply, err);
      throw err;
    }

    return reply.code(204).send();
  });

  // ── POST /api/v1/disability-cases/:caseId/evidence ────────────────────────

  fastify.post<{
    Params: { caseId: string };
    Body: {
      evidenceTypeCode: string;
      filename:         string;
      contentType:      string;
    };
  }>('/api/v1/disability-cases/:caseId/evidence', WRITE, async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { caseId }   = request.params;
    const body         = request.body;

    const result = await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const c = await findCurrentCase(tx, tenantId, caseId);
        if (!c) {
          throw Object.assign(new Error('Disability case not found'), { statusCode: 404 });
        }

        // Register with EDRMS to get document reference
        const { documentRef, documentUrl } = await edrms.registerDocument(
          tenantId,
          caseId,
          { evidenceTypeCode: body.evidenceTypeCode, filename: body.filename, contentType: body.contentType, uploadedBy: actorId },
        );

        const evidenceId = await addEvidenceReference(tx, tenantId, {
          disabilitySupportCaseId: caseId,
          personId:                c.disabilityCase.personId,
          evidenceTypeCode:        body.evidenceTypeCode,
          edrmsDocumentRef:        documentRef,
          edrmsDocumentUrl:        documentUrl,
          uploadedBy:              actorId,
        });

        await appendAudit(tx, {
          tenantId,
          actorId,
          actionCode:   'write',
          resourceType: 'evidence',
          resourceId:   evidenceId,
          personId:     c.disabilityCase.personId,
          context:      { action: 'register', evidenceTypeCode: body.evidenceTypeCode, documentRef },
        });

        return { evidenceId, documentRef, documentUrl };
      },
    );

    return reply.code(201).send(result);
  });

  // ── PATCH /api/v1/evidence/:evidenceId/status ─────────────────────────────

  fastify.patch<{
    Params: { evidenceId: string };
    Body:   { statusCode: string };
  }>('/api/v1/evidence/:evidenceId/status', WRITE, async (request, reply) => {
    const { tenantId }   = request;
    const actorId        = request.user.sub;
    const { evidenceId } = request.params;
    const { statusCode } = request.body;

    try {
    await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const ev = await findEvidence(tx, tenantId, evidenceId);
        if (!ev) {
          throw Object.assign(new Error('Evidence reference not found'), { statusCode: 404 });
        }

        assertTransition(EVIDENCE_TRANSITIONS, 'evidence reference', ev.statusCode, statusCode);
        await updateEvidenceStatus(tx, tenantId, evidenceId, statusCode);
        const owner = await findCurrentCase(tx, tenantId, ev.disabilitySupportCaseId);
        if (!owner) {
          throw Object.assign(new Error('Disability case not found'), { statusCode: 404 });
        }

        await appendAudit(tx, {
          tenantId,
          actorId,
          actionCode:   'write',
          resourceType: 'evidence',
          resourceId:   evidenceId,
          personId:     owner.disabilityCase.personId,
          context:      { action: 'status-update', newStatus: statusCode },
        });
      },
    );
    } catch (err) {
      if (err instanceof StatusTransitionError) return sendTransitionProblem(reply, err);
      throw err;
    }

    return reply.code(204).send();
  });

  // ── POST /api/v1/disability-cases/:caseId/dsa-entitlements ───────────────

  fastify.post<{
    Params: { caseId: string };
    Body: {
      entitlementTypeCode: string;
      providerRef?:        string;
      effectiveFrom:       string;
      effectiveTo?:        string;
      approvedBy:          string;
    };
  }>('/api/v1/disability-cases/:caseId/dsa-entitlements', WRITE, async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { caseId }   = request.params;
    const body         = request.body;

    const entitlementId = await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const c = await findCurrentCase(tx, tenantId, caseId);
        if (!c) {
          throw Object.assign(new Error('Disability case not found'), { statusCode: 404 });
        }

        const id = await addDsaEntitlement(tx, tenantId, actorId, {
          disabilitySupportCaseId: caseId,
          personId:                c.disabilityCase.personId,
          entitlementTypeCode:     body.entitlementTypeCode,
          effectiveFrom:           new Date(body.effectiveFrom),
          approvedBy:              body.approvedBy,
          ...(body.providerRef !== undefined ? { providerRef: body.providerRef } : {}),
          ...(body.effectiveTo !== undefined ? { effectiveTo: new Date(body.effectiveTo) } : {}),
        });

        await appendAudit(tx, {
          tenantId,
          actorId,
          actionCode:   'write',
          resourceType: 'dsa-entitlement',
          resourceId:   id,
          personId:     c.disabilityCase.personId,
          context:      { action: 'create', entitlementTypeCode: body.entitlementTypeCode },
        });

        return id;
      },
    );

    return reply.code(201).send({ id: entitlementId });
  });

  // ── GET /api/v1/disability-cases/:caseId/dsa-entitlements ────────────────

  fastify.get<{
    Params: { caseId: string };
  }>('/api/v1/disability-cases/:caseId/dsa-entitlements', READ, async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { caseId }   = request.params;

    const entitlements = await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const c = await findCurrentCase(tx, tenantId, caseId);
        if (!c) return null;

        await appendAudit(tx, {
          tenantId,
          actorId,
          actionCode:   'read',
          resourceType: 'dsa-entitlement',
          resourceId:   caseId,
          personId:     c.disabilityCase.personId,
        });

        return listDsaEntitlements(tx, tenantId, caseId);
      },
    );

    if (!entitlements) {
      return reply.code(404).send({ error: 'Disability case not found' });
    }

    return reply.send({ items: entitlements, total: entitlements.length });
  });
}
