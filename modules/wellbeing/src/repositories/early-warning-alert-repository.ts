import { and, desc, eq, inArray } from 'drizzle-orm';

import type { WellbeingDb, WellbeingTx } from '../db/client.js';
import { earlyWarningAlerts, type EarlyWarningAlert } from '../db/schema/wellbeing-case.js';

// ── Query ─────────────────────────────────────────────────────────────────────

/** Fetch a single early warning alert by ID. */
export async function findAlert(
  db:       WellbeingDb | WellbeingTx,
  tenantId: string,
  alertId:  string,
): Promise<EarlyWarningAlert | null> {
  const rows = await db
    .select()
    .from(earlyWarningAlerts)
    .where(
      and(
        eq(earlyWarningAlerts.tenantId, tenantId),
        eq(earlyWarningAlerts.id, alertId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** List all alerts for a person, most-recently received first. */
export async function listAlertsForPerson(
  db:       WellbeingDb | WellbeingTx,
  tenantId: string,
  personId: string,
): Promise<EarlyWarningAlert[]> {
  return db
    .select()
    .from(earlyWarningAlerts)
    .where(
      and(
        eq(earlyWarningAlerts.tenantId, tenantId),
        eq(earlyWarningAlerts.personId, personId),
      ),
    )
    .orderBy(earlyWarningAlerts.receivedAt);
}

/** List pending (untriaged) alerts for a tenant — triage queue view. */
export async function listPendingAlerts(
  db:       WellbeingDb | WellbeingTx,
  tenantId: string,
): Promise<EarlyWarningAlert[]> {
  return db
    .select()
    .from(earlyWarningAlerts)
    .where(
      and(
        eq(earlyWarningAlerts.tenantId, tenantId),
        eq(earlyWarningAlerts.triageStatusCode, 'pending'),
      ),
    )
    .orderBy(earlyWarningAlerts.receivedAt);
}

/** Alerts still being worked — pending, reviewed or assigned — newest first. */
export async function listOpenAlerts(
  db:       WellbeingDb | WellbeingTx,
  tenantId: string,
): Promise<EarlyWarningAlert[]> {
  return db
    .select()
    .from(earlyWarningAlerts)
    .where(
      and(
        eq(earlyWarningAlerts.tenantId, tenantId),
        inArray(earlyWarningAlerts.triageStatusCode, ['pending', 'reviewed', 'assigned']),
      ),
    )
    .orderBy(desc(earlyWarningAlerts.receivedAt))
    .limit(200);
}

/** Record a concern raised by a member of staff (source 'staff'). */
export async function raiseStaffAlert(
  db:       WellbeingDb | WellbeingTx,
  tenantId: string,
  input:    { personId: string; alertTypeCode: string; summary: string; raisedBy: string },
): Promise<string> {
  const [row] = await db
    .insert(earlyWarningAlerts)
    .values({
      tenantId,
      personId:        input.personId,
      alertTypeCode:   input.alertTypeCode,
      alertSourceCode: 'staff',
      alertPayload:    { summary: input.summary, raisedBy: input.raisedBy },
    })
    .returning({ id: earlyWarningAlerts.id });
  if (!row) throw new Error('Failed to raise early warning alert');
  return row.id;
}

// ── Triage ────────────────────────────────────────────────────────────────────

/**
 * Update triage status and optionally assign the alert to a wellbeing case.
 *
 * Valid triageStatusCode values: pending | reviewed | assigned | resolved | dismissed
 */
export async function triageAlert(
  db:              WellbeingDb | WellbeingTx,
  tenantId:        string,
  alertId:         string,
  triageStatusCode: string,
  triagedBy:       string,
  assignedCaseId?: string,
): Promise<void> {
  await db
    .update(earlyWarningAlerts)
    .set({
      triageStatusCode,
      triagedBy,
      triagedAt: new Date(),
      ...(assignedCaseId !== undefined ? { assignedCaseId } : {}),
    })
    .where(
      and(
        eq(earlyWarningAlerts.tenantId, tenantId),
        eq(earlyWarningAlerts.id, alertId),
      ),
    );
}
