import { requirePermission } from '@revelation-srs/auth';
import { and, eq, isNotNull, lt, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { withWellbeingTenantContext } from '../db/client.js';
import { wellbeingCases } from '../db/schema/wellbeing-case.js';

// ── Route plugin ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/require-await
export async function adminRetentionRoutes(fastify: FastifyInstance): Promise<void> {

  // ── PATCH /api/v1/admin/retention/wellbeing-cases/:caseId ────────────────
  //
  // Schedules a retention due date for a wellbeing case.  When the date
  // passes, the case is eligible for closure via the /apply endpoint.
  // Restricted to wellbeing-auditor and registry-administrator.

  fastify.patch<{
    Params: { caseId: string };
    Body: { retentionDueDate: string; lawfulBasisCode?: string; dataClassificationCode?: string };
  }>('/api/v1/admin/retention/wellbeing-cases/:caseId', {
    preHandler: [requirePermission('wellbeing-retention:write')],
  }, async (request, reply) => {
    const { tenantId } = request;
    const { caseId }   = request.params;
    const body         = request.body;

    await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const [existing] = await tx
          .select({ id: wellbeingCases.id })
          .from(wellbeingCases)
          .where(and(eq(wellbeingCases.tenantId, tenantId), eq(wellbeingCases.id, caseId)));

        if (!existing) {
          throw Object.assign(new Error('Wellbeing case not found'), { statusCode: 404 });
        }

        await tx
          .update(wellbeingCases)
          .set({
            retentionDueDate: new Date(body.retentionDueDate),
            updatedAt:        new Date(),
            ...(body.lawfulBasisCode        !== undefined ? { lawfulBasisCode: body.lawfulBasisCode }               : {}),
            ...(body.dataClassificationCode !== undefined ? { dataClassificationCode: body.dataClassificationCode } : {}),
          })
          .where(and(eq(wellbeingCases.tenantId, tenantId), eq(wellbeingCases.id, caseId)));
      },
    );

    return reply.code(204).send();
  });

  // ── POST /api/v1/admin/retention/apply ───────────────────────────────────
  //
  // Closes all wellbeing cases whose retention_due_date has passed and that
  // are still in an active state.  Idempotent — safe to run on a schedule.
  // Returns the count of cases closed.

  fastify.post('/api/v1/admin/retention/apply', {
    preHandler: [requirePermission('wellbeing-retention:write')],
  }, async (request, reply) => {
    const { tenantId } = request;
    const now          = new Date();

    const closed = await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const due = await tx
          .select({ id: wellbeingCases.id })
          .from(wellbeingCases)
          .where(
            and(
              eq(wellbeingCases.tenantId, tenantId),
              eq(wellbeingCases.statusCode, 'active'),
              isNotNull(wellbeingCases.retentionDueDate),
              lt(wellbeingCases.retentionDueDate, now),
              isNull(wellbeingCases.closedAt),
            ),
          );

        if (due.length === 0) return 0;

        await tx
          .update(wellbeingCases)
          .set({ statusCode: 'closed', closedAt: now, updatedAt: now })
          .where(
            and(
              eq(wellbeingCases.tenantId, tenantId),
              eq(wellbeingCases.statusCode, 'active'),
              isNotNull(wellbeingCases.retentionDueDate),
              lt(wellbeingCases.retentionDueDate, now),
              isNull(wellbeingCases.closedAt),
            ),
          );

        return due.length;
      },
    );

    return reply.send({ closedCases: closed });
  });
}
