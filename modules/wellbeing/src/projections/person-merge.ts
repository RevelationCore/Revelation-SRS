import { applyPersonMerge, reversePersonMerge, type ApplyMergeResult, type DomainEventEnvelope, type MergeSqlKit, type PersonMergedV1Payload, type PersonUnmergedV1Payload, type ReverseMergeResult } from '@revelation-srs/domain';
import { sql, type SQLWrapper } from 'drizzle-orm';

import type { WellbeingTx } from '../db/client.js';
import { WELLBEING_PERSON_REFERENCES } from '../person-references.js';
import { appendAudit } from '../repositories/audit-log-repository.js';

/**
 * ADR-031 item 7 (BL-358): re-key this schema's records from the merged person
 * to the survivor, by WELLBEING_PERSON_REFERENCES, once per merge. The moves
 * are recorded in wellbeing.person_merge_move for unmerge (BL-359), and the
 * application in the wellbeing audit log.
 */
export async function handlePersonMerged(tx: WellbeingTx, envelope: DomainEventEnvelope<PersonMergedV1Payload>): Promise<ApplyMergeResult> {
  const p = envelope.payload;
  const kit: MergeSqlKit<SQLWrapper> = { sql: sql, execute: (q) => tx.execute(q),
    savepoint: (fn) => tx.transaction((sp) => fn((q) => sp.execute(q))),
  };
  const result = await applyPersonMerge(kit, {
    schema: 'wellbeing', registry: WELLBEING_PERSON_REFERENCES, tenantId: envelope.tenantId,
    mergeId: p.mergeId, survivorPersonId: p.survivorPersonId, mergedPersonId: p.mergedPersonId, now: new Date(),
  });
  if (!result.alreadyApplied) {
    await appendAudit(tx, {
      tenantId: envelope.tenantId, actorId: 'system:person-merge', actionCode: 'write', resourceType: 'identity-merge',
      resourceId: p.mergeId, personId: p.survivorPersonId,
      context: { mergedPersonId: p.mergedPersonId, moved: result.moved, kept: result.kept, eventId: envelope.id },
    });
  }
  return result;
}

/**
 * ADR-031 item 10 (BL-359): srs.person.unmerged reverses the moves recorded
 * for the merge, and gives the restored person this schema's rows for the
 * enrolments the decision reallocated to them.
 */
export async function handlePersonUnmerged(tx: WellbeingTx, envelope: DomainEventEnvelope<PersonUnmergedV1Payload>): Promise<ReverseMergeResult> {
  const p = envelope.payload;
  const kit: MergeSqlKit<SQLWrapper> = {
    sql: sql as unknown as MergeSqlKit<SQLWrapper>['sql'],
    execute: (q) => tx.execute(q),
    savepoint: (fn) => tx.transaction((sp) => fn((q) => sp.execute(q))),
  };
  const result = await reversePersonMerge(kit, {
    schema: 'wellbeing', registry: WELLBEING_PERSON_REFERENCES, tenantId: envelope.tenantId, mergeId: p.mergeId,
    survivorPersonId: p.survivorPersonId, restoredPersonId: p.restoredPersonId, reallocatedToRestored: p.reallocatedToRestored ?? {}, now: new Date(),
  });
  if (!result.skipped) {
    await appendAudit(tx, {
      tenantId: envelope.tenantId, actorId: 'system:person-merge', actionCode: 'write', resourceType: 'identity-merge',
      resourceId: p.mergeId, personId: p.restoredPersonId,
      context: { unmerged: true, survivorPersonId: p.survivorPersonId, reversed: result.reversed, reallocated: result.reallocated, eventId: envelope.id },
    });
  }
  return result;
}
