import { and, eq, sql } from 'drizzle-orm';

import type { WellbeingTx } from '../db/client.js';
import { srsContextProjections } from '../db/schema/wellbeing-case.js';
import { enrolmentPersonMap, moduleRegPersonMap } from '../db/schema/event-tracking.js';

// ── Projection upsert ─────────────────────────────────────────────────────────

export interface ProjectionPatch {
  personData?:                   Record<string, unknown>;
  activeEnrolmentIds?:           string[];
  activeModuleCodes?:            string[];
  disabilityDeclarationStatus?:  string;
  latestMarks?:                  Record<string, unknown>;
  enrolmentStatus?:              string;
  lastEventOffset?:              string;
}

/**
 * Merge-upsert the projection for (tenantId, personId) using a single raw SQL
 * INSERT … ON CONFLICT DO UPDATE statement.
 *
 * EXCLUDED.* refers to the values in the attempted INSERT row.  For JSONB
 * fields the ON CONFLICT clause merges existing || incoming; for scalar fields
 * COALESCE preserves the existing value when the incoming value is NULL
 * (i.e. the field was absent from the patch).
 */
export async function upsertProjection(
  tx:       WellbeingTx,
  tenantId: string,
  personId: string,
  patch:    ProjectionPatch,
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO wellbeing.srs_context_projection (
      id, tenant_id, person_id,
      person_data, active_enrolment_ids, active_module_codes,
      disability_declaration_status, latest_marks,
      enrolment_status, last_event_offset, last_updated_at
    ) VALUES (
      gen_random_uuid(),
      ${tenantId}::uuid,
      ${personId}::uuid,
      ${JSON.stringify(patch.personData            ?? {})}::jsonb,
      ${JSON.stringify(patch.activeEnrolmentIds    ?? [])}::jsonb,
      ${JSON.stringify(patch.activeModuleCodes     ?? [])}::jsonb,
      ${patch.disabilityDeclarationStatus          ?? null},
      ${JSON.stringify(patch.latestMarks           ?? {})}::jsonb,
      ${patch.enrolmentStatus                      ?? null},
      ${patch.lastEventOffset                      ?? null},
      now()
    )
    ON CONFLICT (tenant_id, person_id) DO UPDATE SET
      person_data = wellbeing.srs_context_projection.person_data
                   || EXCLUDED.person_data,
      active_enrolment_ids = (
        SELECT COALESCE(jsonb_agg(DISTINCT e), '[]'::jsonb)
        FROM jsonb_array_elements(
          wellbeing.srs_context_projection.active_enrolment_ids
          || EXCLUDED.active_enrolment_ids
        ) e
      ),
      active_module_codes = (
        SELECT COALESCE(jsonb_agg(DISTINCT e), '[]'::jsonb)
        FROM jsonb_array_elements(
          wellbeing.srs_context_projection.active_module_codes
          || EXCLUDED.active_module_codes
        ) e
      ),
      disability_declaration_status = COALESCE(
        EXCLUDED.disability_declaration_status,
        wellbeing.srs_context_projection.disability_declaration_status
      ),
      latest_marks = wellbeing.srs_context_projection.latest_marks
                    || EXCLUDED.latest_marks,
      enrolment_status = COALESCE(
        EXCLUDED.enrolment_status,
        wellbeing.srs_context_projection.enrolment_status
      ),
      last_event_offset = COALESCE(
        EXCLUDED.last_event_offset,
        wellbeing.srs_context_projection.last_event_offset
      ),
      last_updated_at = now()
  `);
}

/** Remove a module code from activeModuleCodes. */
export async function removeModuleCode(
  tx:       WellbeingTx,
  tenantId: string,
  personId: string,
  moduleId: string,
): Promise<void> {
  await tx.execute(sql`
    UPDATE wellbeing.srs_context_projection
    SET active_module_codes = (
      SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
      FROM jsonb_array_elements(active_module_codes) elem
      WHERE elem::text != ${JSON.stringify(moduleId)}
    ),
    last_updated_at = now()
    WHERE tenant_id = ${tenantId}::uuid
      AND person_id = ${personId}::uuid
  `);
}

// ── Lookup maps ───────────────────────────────────────────────────────────────

/** Upsert the enrolment → person mapping. */
export async function upsertEnrolmentMap(
  tx:          WellbeingTx,
  tenantId:    string,
  enrolmentId: string,
  personId:    string,
): Promise<void> {
  await tx
    .insert(enrolmentPersonMap)
    .values({ tenantId, enrolmentId, personId })
    .onConflictDoNothing();
}

/** Upsert a module registration → person mapping. */
export async function upsertModuleRegMap(
  tx:                   WellbeingTx,
  tenantId:             string,
  moduleRegistrationId: string,
  enrolmentId:          string,
  personId:             string,
  moduleId:             string,
): Promise<void> {
  await tx
    .insert(moduleRegPersonMap)
    .values({ tenantId, moduleRegistrationId, enrolmentId, personId, moduleId })
    .onConflictDoNothing();
}

/** Resolve personId from enrolmentId using the local lookup map. */
export async function findPersonIdByEnrolmentId(
  tx:          WellbeingTx,
  tenantId:    string,
  enrolmentId: string,
): Promise<string | null> {
  const rows = await tx
    .select({ personId: enrolmentPersonMap.personId })
    .from(enrolmentPersonMap)
    .where(
      and(
        eq(enrolmentPersonMap.tenantId, tenantId),
        eq(enrolmentPersonMap.enrolmentId, enrolmentId),
      ),
    )
    .limit(1);
  return rows[0]?.personId ?? null;
}

/** Resolve personId + moduleId from moduleRegistrationId using the local lookup map. */
export async function findByModuleRegId(
  tx:                   WellbeingTx,
  tenantId:             string,
  moduleRegistrationId: string,
): Promise<{ personId: string; moduleId: string } | null> {
  const rows = await tx
    .select({
      personId: moduleRegPersonMap.personId,
      moduleId: moduleRegPersonMap.moduleId,
    })
    .from(moduleRegPersonMap)
    .where(
      and(
        eq(moduleRegPersonMap.tenantId, tenantId),
        eq(moduleRegPersonMap.moduleRegistrationId, moduleRegistrationId),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? { personId: row.personId, moduleId: row.moduleId } : null;
}

/** Fetch the current projection row for a person. */
export async function getProjection(
  tx:       WellbeingTx,
  tenantId: string,
  personId: string,
) {
  const rows = await tx
    .select()
    .from(srsContextProjections)
    .where(
      and(
        eq(srsContextProjections.tenantId, tenantId),
        eq(srsContextProjections.personId, personId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
