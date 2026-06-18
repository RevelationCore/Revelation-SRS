import type { FastifyInstance } from 'fastify';

import { withWellbeingTenantContext } from '../db/client.js';
import type { EdrmsAdapter } from '../edrms/edrms-adapter.js';
import { appendAudit }    from '../repositories/audit-log-repository.js';
import {
  createDisabilityCase,
  findCurrentCase,
  listCasesForPerson,
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
  };
}

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
  }>('/api/v1/disability-cases', async (request, reply) => {
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
  }>('/api/v1/disability-cases', async (request, reply) => {
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

  // ── GET /api/v1/disability-cases/:caseId ──────────────────────────────────

  fastify.get<{
    Params: { caseId: string };
  }>('/api/v1/disability-cases/:caseId', async (request, reply) => {
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
      evidence:     result.evidence,
      entitlements: result.entitlements,
    });
  });

  // ── PATCH /api/v1/disability-cases/:caseId/status ─────────────────────────

  fastify.patch<{
    Params: { caseId: string };
    Body:   { statusCode: string };
  }>('/api/v1/disability-cases/:caseId/status', async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { caseId }   = request.params;
    const { statusCode } = request.body;

    await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const c = await findCurrentCase(tx, tenantId, caseId);
        if (!c) {
          throw Object.assign(new Error('Disability case not found'), { statusCode: 404 });
        }

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
  }>('/api/v1/disability-cases/:caseId/evidence', async (request, reply) => {
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
  }>('/api/v1/evidence/:evidenceId/status', async (request, reply) => {
    const { tenantId }   = request;
    const actorId        = request.user.sub;
    const { evidenceId } = request.params;
    const { statusCode } = request.body;

    await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const ev = await findEvidence(tx, tenantId, evidenceId);
        if (!ev) {
          throw Object.assign(new Error('Evidence reference not found'), { statusCode: 404 });
        }

        await updateEvidenceStatus(tx, tenantId, evidenceId, statusCode);

        await appendAudit(tx, {
          tenantId,
          actorId,
          actionCode:   'write',
          resourceType: 'evidence',
          resourceId:   evidenceId,
          personId:     ev.disabilitySupportCaseId,
          context:      { action: 'status-update', newStatus: statusCode },
        });
      },
    );

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
  }>('/api/v1/disability-cases/:caseId/dsa-entitlements', async (request, reply) => {
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
  }>('/api/v1/disability-cases/:caseId/dsa-entitlements', async (request, reply) => {
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
