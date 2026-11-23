import { applyPersonMerge, type DomainEventEnvelope, type MergeSqlKit, type PersonMergedV1Payload } from '@revelation-srs/domain';
import { sql, type SQLWrapper } from 'drizzle-orm';

import { VLE_CONNECTOR_PERSON_REFERENCES } from '../person-references.js';

import type { HandlerContext } from './handlers.js';

/**
 * ADR-031 item 7 (BL-358): moves the connector's person-to-VLE mappings from
 * the merged person to the survivor, once per merge. Memberships in the VLE
 * itself follow on the next provisioning snapshot. A mapping the survivor
 * already has is kept, and reported.
 */
export async function handlePersonMerged(envelope: DomainEventEnvelope<PersonMergedV1Payload>, ctx: HandlerContext): Promise<void> {
  const p = envelope.payload;
  const tx = ctx.tx;
  const kit: MergeSqlKit<SQLWrapper> = {
    sql: sql,
    execute: (q) => tx.execute(q),
    savepoint: (fn) => tx.transaction((sp) => fn((q) => sp.execute(q))),
  };
  const result = await applyPersonMerge(kit, {
    schema: 'vle_connector', registry: VLE_CONNECTOR_PERSON_REFERENCES, tenantId: envelope.tenantId,
    mergeId: p.mergeId, survivorPersonId: p.survivorPersonId, mergedPersonId: p.mergedPersonId, now: new Date(),
  });
  ctx.log.info({ eventId: envelope.id, mergeId: p.mergeId, alreadyApplied: result.alreadyApplied, moved: result.moved, kept: result.kept }, 'Applied identity merge to VLE mappings');
}
