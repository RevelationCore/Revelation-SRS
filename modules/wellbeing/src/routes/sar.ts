import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

import { withWellbeingTenantContext } from '../db/client.js';
import { appendAudit } from '../repositories/audit-log-repository.js';
import { exportPersonData, logSarExport } from '../repositories/sar-repository.js';

// ── Route plugin ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/require-await
export async function sarRoutes(fastify: FastifyInstance): Promise<void> {

  // ── GET /api/v1/sar/export/:personId ─────────────────────────────────────
  //
  // Subject Access Request export — returns all Wellbeing-owned data for a
  // person (GDPR Art. 15).  Restricted to wellbeing-auditor and dpo roles.
  // Every export is logged to sar_export_log and audit_log for compliance.

  fastify.get<{
    Params: { personId: string };
  }>('/api/v1/sar/export/:personId', {
    preHandler: [requirePermission('wellbeing-sar:export')],
  }, async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { personId } = request.params;

    const sarData = await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const data = await exportPersonData(tx, tenantId, personId);

        const counts = {
          wellbeingCases:         data.wellbeingCases.length,
          disabilitySupportCases: data.disabilitySupportCases.length,
          dsaEntitlements:        data.dsaEntitlements.length,
          evidenceReferences:     data.evidenceReferences.length,
          adjustmentCases:        data.adjustmentCases.length,
          ecClaims:               data.ecClaims.length,
          mentalHealthCases:      data.mentalHealthCases.length,
          sessionNotes:           data.sessionNotes.length,
          interventionPlans:      data.interventionPlans.length,
          earlyWarningAlerts:     data.earlyWarningAlerts.length,
        };

        await logSarExport(tx, tenantId, personId, actorId, counts);

        await appendAudit(tx, {
          tenantId,
          actorId,
          actionCode:   'export',
          resourceType: 'disability-case',
          resourceId:   personId,
          personId,
          context:      { action: 'sar-export', recordCounts: counts },
        });

        return data;
      },
    );

    return reply.send(sarData);
  });
}
