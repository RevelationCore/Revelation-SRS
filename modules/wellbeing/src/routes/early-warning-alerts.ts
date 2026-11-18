import { requirePermission } from '@revelation-srs/auth';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { withWellbeingTenantContext } from '../db/client.js';
import { mentalHealthCases, interventionPlans } from '../db/schema/mental-health.js';
import { earlyWarningAlerts, type EarlyWarningAlert } from '../db/schema/wellbeing-case.js';
import {
  ALERT_TRIAGE_TRANSITIONS,
  StatusTransitionError,
  allowedNext,
  assertTransition,
} from '../domain/status-rules.js';
import { appendAudit } from '../repositories/audit-log-repository.js';
import {
  findAlert,
  listAlertsForPerson,
  listOpenAlerts,
  listPendingAlerts,
  raiseStaffAlert,
  triageAlert,
} from '../repositories/early-warning-alert-repository.js';
import { findCurrentMentalHealthCase } from '../repositories/mental-health-case-repository.js';

import { sendTransitionProblem } from './disability-cases.js';

const READ   = { preHandler: [requirePermission('early-warning:read')] };
const TRIAGE = { preHandler: [requirePermission('early-warning:triage')] };

/** Concerns staff may raise by hand; UKVI alerts arrive from SRS events only. */
const STAFF_ALERT_TYPES = ['staff-referral', 'tutor-concern'] as const;

function withActions(alert: EarlyWarningAlert) {
  return { ...alert, allowedNextStatuses: allowedNext(ALERT_TRIAGE_TRANSITIONS, alert.triageStatusCode) };
}

// ── Route plugin ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/require-await
export async function earlyWarningAlertRoutes(fastify: FastifyInstance): Promise<void> {

  // ── GET /api/v1/early-warning-alerts ─────────────────────────────────────
  //
  // Three modes:
  //   ?personId=<uuid>       — alerts for a specific student
  //   ?triageStatus=pending  — tenant-wide untriaged queue
  //   ?triageStatus=open     — tenant-wide: pending, reviewed and assigned

  fastify.get<{
    Querystring: { personId?: string; triageStatus?: string };
  }>('/api/v1/early-warning-alerts', READ, async (request, reply) => {
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
        if (triageStatus === 'open') return listOpenAlerts(tx, tenantId);
        return listPendingAlerts(tx, tenantId);
      },
    );

    return reply.send({ items: alerts.map(withActions), total: alerts.length });
  });

  // ── POST /api/v1/early-warning-alerts ────────────────────────────────────
  //
  // A member of staff raises a concern about a student. The summary is a
  // short, non-clinical description; clinical detail belongs in a case.

  fastify.post<{
    Body: { personId: string; alertTypeCode: string; summary: string };
  }>('/api/v1/early-warning-alerts', TRIAGE, async (request, reply) => {
    const { tenantId } = request;
    const actorId      = request.user.sub;
    const { personId, alertTypeCode, summary } = request.body ?? {} as never;

    if (!personId || !summary?.trim() || !(STAFF_ALERT_TYPES as readonly string[]).includes(alertTypeCode)) {
      return reply.code(422).send({
        type: 'about:blank', title: 'Invalid concern', status: 422,
        detail: `personId, summary and an alertTypeCode of ${STAFF_ALERT_TYPES.join(' or ')} are required`,
        error: 'Invalid concern',
      });
    }

    const id = await withWellbeingTenantContext(
      request.server.wellbeingDb,
      tenantId,
      async (tx) => {
        const alertId = await raiseStaffAlert(tx, tenantId, {
          personId, alertTypeCode, summary: summary.trim(), raisedBy: actorId,
        });
        await appendAudit(tx, {
          tenantId,
          actorId,
          actionCode:   'write',
          resourceType: 'early-warning-alert',
          resourceId:   alertId,
          personId,
          context:      { action: 'raise', alertTypeCode },
        });
        return alertId;
      },
    );

    return reply.code(201).send({ id });
  });

  // ── GET /api/v1/early-warning-alerts/:alertId ────────────────────────────

  fastify.get<{
    Params: { alertId: string };
  }>('/api/v1/early-warning-alerts/:alertId', READ, async (request, reply) => {
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

    return reply.send(withActions(alert));
  });

  // ── PATCH /api/v1/early-warning-alerts/:alertId/triage ───────────────────
  //
  // Valid triageStatusCode values: pending | reviewed | assigned | resolved | dismissed.
  // 'assigned' links the alert to one of the same student's mental health cases.

  fastify.patch<{
    Params: { alertId: string };
    Body: {
      triageStatusCode: string;
      assignedCaseId?:  string;
    };
  }>('/api/v1/early-warning-alerts/:alertId/triage', TRIAGE, async (request, reply) => {
    const { tenantId }   = request;
    const actorId        = request.user.sub;
    const { alertId }    = request.params;
    const { triageStatusCode, assignedCaseId } = request.body;

    try {
      await withWellbeingTenantContext(
        request.server.wellbeingDb,
        tenantId,
        async (tx) => {
          const alert = await findAlert(tx, tenantId, alertId);
          if (!alert) {
            throw Object.assign(new Error('Early warning alert not found'), { statusCode: 404 });
          }
          assertTransition(ALERT_TRIAGE_TRANSITIONS, 'early warning alert', alert.triageStatusCode, triageStatusCode);

          if (triageStatusCode === 'assigned') {
            if (!assignedCaseId) {
              throw Object.assign(new Error('assignedCaseId is required to assign an alert'), { statusCode: 422 });
            }
            const mh = await findCurrentMentalHealthCase(tx, tenantId, assignedCaseId);
            if (!mh || mh.personId !== alert.personId) {
              throw Object.assign(new Error('assignedCaseId must be a mental health case for the same student'), { statusCode: 422 });
            }
          }

          if (assignedCaseId !== undefined) {
            await triageAlert(tx, tenantId, alertId, triageStatusCode, actorId, assignedCaseId);
          } else {
            await triageAlert(tx, tenantId, alertId, triageStatusCode, actorId);
          }

          await appendAudit(tx, {
            tenantId,
            actorId,
            actionCode:   'write',
            resourceType: 'early-warning-alert',
            resourceId:   alertId,
            personId:     alert.personId,
            context:      { action: 'triage', triageStatusCode, ...(assignedCaseId ? { assignedCaseId } : {}) },
          });
        },
      );
    } catch (err) {
      if (err instanceof StatusTransitionError) return sendTransitionProblem(reply, err);
      throw err;
    }

    return reply.code(204).send();
  });

  // ── GET /api/v1/reports/wellbeing-summary ────────────────────────────────
  //
  // Aggregate counts for operational dashboards.
  //
  // PRIVACY CONTRACT: returns counts only — no person identifiers, no case
  // notes, no clinical detail.

  fastify.get('/api/v1/reports/wellbeing-summary', READ, async (request, reply) => {
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
              sql`${mentalHealthCases.statusCode} <> 'closed'`,
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
