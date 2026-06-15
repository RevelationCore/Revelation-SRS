import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { withWellbeingTenantContext } from '../db/client.js';
import { mentalHealthCases, interventionPlans } from '../db/schema/mental-health.js';
import { earlyWarningAlerts } from '../db/schema/wellbeing-case.js';
import {
  findAlert,
  listAlertsForPerson,
  listPendingAlerts,
  triageAlert,
} from '../repositories/early-warning-alert-repository.js';

// ── Route plugin ──────────────────────────────────────────────────────────────

export async function earlyWarningAlertRoutes(fastify: FastifyInstance): Promise<void> {

  // ── GET /api/v1/early-warning-alerts ─────────────────────────────────────
  //
  // Two modes:
  //   ?personId=<uuid>       — alerts for a specific student
  //   ?triageStatus=pending  — tenant-wide triage queue (no personId needed)

  fastify.get<{
    Querystring: { personId?: string; triageStatus?: string };
  }>('/api/v1/early-warning-alerts', async (request, reply) => {
    const { tenantId }               = request;
    const { personId, triageStatus } = request.query;

    if (!personId && !triageStatus) {
      return reply.code(400).send({
        error: 'Provide personId or triageStatus query parameter',
      });
    }

    const alerts = await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        if (personId) return listAlertsForPerson(tx, tenantId, personId);
        return listPendingAlerts(tx, tenantId);
      },
    );

    return reply.send({ items: alerts, total: alerts.length });
  });

  // ── GET /api/v1/early-warning-alerts/:alertId ────────────────────────────

  fastify.get<{
    Params: { alertId: string };
  }>('/api/v1/early-warning-alerts/:alertId', async (request, reply) => {
    const { tenantId } = request;
    const { alertId }  = request.params;

    const alert = await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      (tx) => findAlert(tx, tenantId, alertId),
    );

    if (!alert) {
      return reply.code(404).send({ error: 'Early warning alert not found' });
    }

    return reply.send(alert);
  });

  // ── PATCH /api/v1/early-warning-alerts/:alertId/triage ───────────────────
  //
  // Valid triageStatusCode values: pending | reviewed | assigned | resolved | dismissed

  fastify.patch<{
    Params: { alertId: string };
    Body: {
      triageStatusCode: string;
      assignedCaseId?:  string;
    };
  }>('/api/v1/early-warning-alerts/:alertId/triage', async (request, reply) => {
    const { tenantId }   = request;
    const actorId        = request.user.sub;
    const { alertId }    = request.params;
    const { triageStatusCode, assignedCaseId } = request.body;

    await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const alert = await findAlert(tx, tenantId, alertId);
        if (!alert) {
          throw Object.assign(new Error('Early warning alert not found'), { statusCode: 404 });
        }

        if (assignedCaseId !== undefined) {
          await triageAlert(tx, tenantId, alertId, triageStatusCode, actorId, assignedCaseId);
        } else {
          await triageAlert(tx, tenantId, alertId, triageStatusCode, actorId);
        }
      },
    );

    return reply.code(204).send();
  });

  // ── GET /api/v1/reports/wellbeing-summary ────────────────────────────────
  //
  // Aggregate counts for operational dashboards.
  //
  // PRIVACY CONTRACT: returns counts only — no person identifiers, no case
  // notes, no clinical detail.  Safe to expose to all wellbeing roles.

  fastify.get('/api/v1/reports/wellbeing-summary', async (request, reply) => {
    const { tenantId } = request;

    const summary = await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const [mhRow] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(mentalHealthCases)
          .where(
            and(
              eq(mentalHealthCases.tenantId, tenantId),
              isNull(mentalHealthCases.recordedUntil),
            ),
          );

        const [planRow] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(interventionPlans)
          .where(
            and(
              eq(interventionPlans.tenantId, tenantId),
              isNull(interventionPlans.recordedUntil),
              eq(interventionPlans.statusCode, 'active'),
            ),
          );

        const [alertRow] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(earlyWarningAlerts)
          .where(
            and(
              eq(earlyWarningAlerts.tenantId, tenantId),
              eq(earlyWarningAlerts.triageStatusCode, 'pending'),
            ),
          );

        return {
          openMentalHealthCases:   mhRow?.count    ?? 0,
          activeInterventionPlans: planRow?.count   ?? 0,
          pendingAlerts:           alertRow?.count  ?? 0,
        };
      },
    );

    return reply.send(summary);
  });
}
