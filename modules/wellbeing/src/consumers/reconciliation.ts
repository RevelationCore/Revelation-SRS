/**
 * Projection reconciliation — Stage 2.
 *
 * Compares the local SRS context projection with authoritative data fetched
 * from the SRS REST API.  Repairs any drift by re-applying the authoritative
 * values.  Does NOT re-publish events; it is a one-way repair tool run on
 * demand or on a schedule.
 *
 * Called as a CLI command via `tsx src/consumers/reconciliation.ts <personId>`
 * or invoked from a Temporal activity in later stages.
 *
 * The SRS REST calls use the F053 wellbeing-student-context contract.
 */

import { createHash } from 'node:crypto';
import type { Logger } from 'pino';

import type { WellbeingDb } from '../db/client.js';
import { withWellbeingTenantContext } from '../db/client.js';
import { upsertProjection, getProjection } from '../repositories/projection-repository.js';

export interface ReconciliationResult {
  personId:   string;
  tenantId:   string;
  driftFound: boolean;
  repairedAt: string | null;
}

/**
 * Reconcile the local projection for a single person against SRS REST data.
 *
 * @param srsApiUrl  Base URL of the SRS API (e.g. http://localhost:3000)
 * @param authToken  Bearer token with wellbeing-advisor scope
 */
export async function reconcilePerson(
  db:        WellbeingDb,
  log:       Logger,
  srsApiUrl: string,
  authToken: string,
  tenantId:  string,
  personId:  string,
): Promise<ReconciliationResult> {
  const result: ReconciliationResult = {
    personId,
    tenantId,
    driftFound: false,
    repairedAt: null,
  };

  // Fetch authoritative data from SRS F053 endpoint.
  const srsData = await fetchSrsPersonContext(srsApiUrl, authToken, personId);

  if (!srsData) {
    log.warn({ personId, tenantId }, 'Reconciliation: person not found in SRS — skipping');
    return result;
  }

  // Compare with local projection.
  await withWellbeingTenantContext(db, tenantId, async (tx) => {
    const local = await getProjection(tx, tenantId, personId);

    const srsHash  = hashProjectionSnapshot(srsData as unknown as Record<string, unknown>);
    const localHash = local
      ? hashProjectionSnapshot({
          enrolmentStatus:             local.enrolmentStatus,
          disabilityDeclarationStatus: local.disabilityDeclarationStatus,
          activeEnrolmentIds:          local.activeEnrolmentIds,
        })
      : null;

    if (srsHash === localHash) {
      log.debug({ personId }, 'Reconciliation: no drift');
      return;
    }

    result.driftFound = true;
    log.info({ personId, tenantId }, 'Reconciliation: drift detected — repairing');

    const patch: Parameters<typeof upsertProjection>[3] = {
      personData:        srsData.personData,
      activeEnrolmentIds: srsData.activeEnrolmentIds,
      lastEventOffset:   `reconciled:${new Date().toISOString()}`,
    };
    if (srsData.enrolmentStatus !== null) {
      patch.enrolmentStatus = srsData.enrolmentStatus;
    }
    if (srsData.disabilityDeclarationStatus !== null) {
      patch.disabilityDeclarationStatus = srsData.disabilityDeclarationStatus;
    }

    await upsertProjection(tx, tenantId, personId, patch);

    result.repairedAt = new Date().toISOString();
  });

  return result;
}

// ── SRS REST fetch ────────────────────────────────────────────────────────────

interface SrsPersonSnapshot {
  personData:                  Record<string, unknown>;
  enrolmentStatus:             string | null;
  disabilityDeclarationStatus: string | null;
  activeEnrolmentIds:          string[];
}

async function fetchSrsPersonContext(
  srsApiUrl:  string,
  authToken:  string,
  personId:   string,
): Promise<SrsPersonSnapshot | null> {
  const res = await fetch(`${srsApiUrl}/api/v1/students/${personId}`, {
    headers: { authorization: `Bearer ${authToken}` },
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`SRS reconciliation fetch failed: ${res.status} ${res.statusText}`);
  }

  const body = await res.json() as Record<string, unknown>;

  // Map SRS response shape to projection snapshot.
  const enrolments = (body['enrolments'] as Array<{ id: string; status: string }> | undefined) ?? [];
  const latestEnrolment = enrolments.at(-1);

  const disabilityDeclarations = (body['disabilityDeclarations'] as Array<{ status: string }> | undefined) ?? [];
  const latestDeclaration = disabilityDeclarations.at(-1);

  return {
    personData:                  { srsId: body['id'], firstName: body['firstName'], lastName: body['lastName'] },
    enrolmentStatus:             latestEnrolment?.status ?? null,
    disabilityDeclarationStatus: latestDeclaration?.status ?? null,
    activeEnrolmentIds:          enrolments.map((e) => e.id),
  };
}

function hashProjectionSnapshot(snapshot: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}
