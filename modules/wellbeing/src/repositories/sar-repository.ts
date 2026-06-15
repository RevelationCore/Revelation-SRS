import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { WellbeingDb, WellbeingTx } from '../db/client.js';
import { disabilitySupportCases, dsaEntitlements, evidenceReferences } from '../db/schema/disability.js';
import { adjustmentCases } from '../db/schema/adjustment.js';
import { ecClaims } from '../db/schema/circumstances.js';
import { mentalHealthCases, interventionPlans, mhSessionNotes } from '../db/schema/mental-health.js';
import {
  wellbeingCases,
  earlyWarningAlerts,
  sarExportLogs,
} from '../db/schema/wellbeing-case.js';

export interface SarExport {
  exportedAt:             string;
  personId:               string;
  tenantId:               string;
  wellbeingCases:         unknown[];
  disabilitySupportCases: unknown[];
  dsaEntitlements:        unknown[];
  evidenceReferences:     unknown[];
  adjustmentCases:        unknown[];
  ecClaims:               unknown[];
  mentalHealthCases:      unknown[];
  sessionNotes:           unknown[];
  interventionPlans:      unknown[];
  earlyWarningAlerts:     unknown[];
}

export async function exportPersonData(
  db:       WellbeingTx | WellbeingDb,
  tenantId: string,
  personId: string,
): Promise<SarExport> {
  // Evidence references are linked via disability_support_case, not directly
  // by person_id, so we fetch them via a subquery.
  const dsSubquery = db
    .select({ id: disabilitySupportCases.id })
    .from(disabilitySupportCases)
    .where(and(
      eq(disabilitySupportCases.tenantId, tenantId),
      eq(disabilitySupportCases.personId, personId),
    ));

  const [wbCases, dsCases, dsa, evidence, adjCases, ec, mhCases, notes, plans, alerts] =
    await Promise.all([
      db.select().from(wellbeingCases)
        .where(and(eq(wellbeingCases.tenantId, tenantId), eq(wellbeingCases.personId, personId))),

      db.select().from(disabilitySupportCases)
        .where(and(
          eq(disabilitySupportCases.tenantId, tenantId),
          eq(disabilitySupportCases.personId, personId),
          isNull(disabilitySupportCases.recordedUntil),
        )),

      db.select().from(dsaEntitlements)
        .where(and(
          eq(dsaEntitlements.tenantId, tenantId),
          eq(dsaEntitlements.personId, personId),
          isNull(dsaEntitlements.recordedUntil),
        )),

      db.select().from(evidenceReferences)
        .where(and(
          eq(evidenceReferences.tenantId, tenantId),
          inArray(evidenceReferences.disabilitySupportCaseId, dsSubquery),
        )),

      db.select().from(adjustmentCases)
        .where(and(
          eq(adjustmentCases.tenantId, tenantId),
          eq(adjustmentCases.personId, personId),
          isNull(adjustmentCases.recordedUntil),
        )),

      db.select().from(ecClaims)
        .where(and(
          eq(ecClaims.tenantId, tenantId),
          eq(ecClaims.personId, personId),
          isNull(ecClaims.recordedUntil),
        )),

      db.select().from(mentalHealthCases)
        .where(and(
          eq(mentalHealthCases.tenantId, tenantId),
          eq(mentalHealthCases.personId, personId),
          isNull(mentalHealthCases.recordedUntil),
        )),

      db.select().from(mhSessionNotes)
        .where(and(
          eq(mhSessionNotes.tenantId, tenantId),
          eq(mhSessionNotes.personId, personId),
        )),

      db.select().from(interventionPlans)
        .where(and(
          eq(interventionPlans.tenantId, tenantId),
          eq(interventionPlans.personId, personId),
          isNull(interventionPlans.recordedUntil),
        )),

      db.select().from(earlyWarningAlerts)
        .where(and(
          eq(earlyWarningAlerts.tenantId, tenantId),
          eq(earlyWarningAlerts.personId, personId),
        )),
    ]);

  return {
    exportedAt:             new Date().toISOString(),
    personId,
    tenantId,
    wellbeingCases:         wbCases,
    disabilitySupportCases: dsCases,
    dsaEntitlements:        dsa,
    evidenceReferences:     evidence,
    adjustmentCases:        adjCases,
    ecClaims:               ec,
    mentalHealthCases:      mhCases,
    sessionNotes:           notes,
    interventionPlans:      plans,
    earlyWarningAlerts:     alerts,
  };
}

export async function logSarExport(
  db:                   WellbeingTx | WellbeingDb,
  tenantId:             string,
  exportedForPersonId:  string,
  requestedByActorId:   string,
  recordCounts:         Record<string, number>,
): Promise<void> {
  await db.insert(sarExportLogs).values({
    tenantId,
    exportedForPersonId,
    requestedByActorId,
    recordCounts,
  });
}
