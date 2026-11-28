import { applyPersonMerge, reversePersonMerge, type ApplyMergeResult, type DomainEventEnvelope, type MergeSqlKit, type PersonMergedV1Payload, type PersonUnmergedV1Payload, type ReverseMergeResult } from '@revelation-srs/domain';
import { sql, type SQLWrapper } from 'drizzle-orm';

import type { AttendanceTx } from '../db/client.js';
import { ATTENDANCE_PERSON_REFERENCES } from '../person-references.js';

/**
 * ADR-031 item 7 (BL-358): re-key this schema's records from the merged person
 * to the survivor, by ATTENDANCE_PERSON_REFERENCES, once per merge. The moves
 * are recorded in attendance.person_merge_move for unmerge (BL-359).
 */
export async function handlePersonMerged(tx: AttendanceTx, envelope: DomainEventEnvelope<PersonMergedV1Payload>): Promise<ApplyMergeResult> {
  const p = envelope.payload;
  const kit: MergeSqlKit<SQLWrapper> = { sql: sql, execute: (q) => tx.execute(q),
    savepoint: (fn) => tx.transaction((sp) => fn((q) => sp.execute(q))),
  };
  return applyPersonMerge(kit, {
    schema: 'attendance', registry: ATTENDANCE_PERSON_REFERENCES, tenantId: envelope.tenantId,
    mergeId: p.mergeId, survivorPersonId: p.survivorPersonId, mergedPersonId: p.mergedPersonId, now: new Date(),
  });
}

/**
 * ADR-031 item 10 (BL-359): srs.person.unmerged reverses the moves recorded
 * for the merge, and gives the restored person this schema's rows for the
 * enrolments the decision reallocated to them.
 */
export async function handlePersonUnmerged(tx: AttendanceTx, envelope: DomainEventEnvelope<PersonUnmergedV1Payload>): Promise<ReverseMergeResult> {
  const p = envelope.payload;
  const kit: MergeSqlKit<SQLWrapper> = {
    sql,
    execute: (q) => tx.execute(q),
    savepoint: (fn) => tx.transaction((sp) => fn((q) => sp.execute(q))),
  };
  const result = await reversePersonMerge(kit, {
    schema: 'attendance', registry: ATTENDANCE_PERSON_REFERENCES, tenantId: envelope.tenantId, mergeId: p.mergeId,
    survivorPersonId: p.survivorPersonId, restoredPersonId: p.restoredPersonId, reallocatedToRestored: p.reallocatedToRestored ?? {}, now: new Date(),
  });
  return result;
}
