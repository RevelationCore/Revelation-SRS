import { and, eq } from 'drizzle-orm';
import { persons, type Db, withTenantContext } from '@revelation-srs/db';

import type { DeliveryService } from '../delivery-service.js';

/**
 * F-SIS-LIB-01 — library access from enrolment status.
 *
 * Each enrolment creation or status change tells the library what the
 * student's access should now be. The payload is the minimum a library
 * needs to act: who (student number, the usual borrower id), which
 * enrolment, the action and from when. A later change supersedes an
 * undelivered earlier one (state sync).
 */
export const LIBRARY_FLOW = 'F-SIS-LIB-01';

export type LibraryAccessAction = 'grant' | 'suspend' | 'revoke';

export function libraryAccessFor(enrolmentStatus: string): LibraryAccessAction {
  switch (enrolmentStatus) {
    case 'enrolled':     return 'grant';
    case 'intermitting':
    case 'suspended':    return 'suspend';
    default:             return 'revoke'; // withdrawn, graduated
  }
}

const ACTION_TEXT: Record<LibraryAccessAction, string> = {
  grant: 'Grant library access',
  suspend: 'Suspend library access',
  revoke: 'Revoke library access',
};

export async function requestLibraryAccess(
  delivery: DeliveryService,
  db: Db,
  tenantId: string,
  change: { personId: string; enrolmentId: string; statusCode: string; effectiveFrom: Date; changeKey: string },
): Promise<void> {
  const [person] = await withTenantContext(db, tenantId, (tx) =>
    tx.select({ studentNumber: persons.studentNumber }).from(persons).where(and(
      eq(persons.id, change.personId as `${string}-${string}-${string}-${string}-${string}`),
      eq(persons.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
    )).limit(1),
  );
  const action = libraryAccessFor(change.statusCode);
  const effective = change.effectiveFrom.toISOString().slice(0, 10);
  await delivery.request(tenantId, {
    flowCode: LIBRARY_FLOW,
    subjectType: 'enrolment',
    subjectId: change.enrolmentId,
    personId: change.personId,
    idempotencyKey: change.changeKey,
    payload: {
      personId: change.personId,
      studentNumber: person?.studentNumber ?? null,
      enrolmentId: change.enrolmentId,
      enrolmentStatus: change.statusCode,
      accessAction: action,
      effectiveFrom: effective,
    },
    summary: `${ACTION_TEXT[action]} from ${effective} (enrolment ${change.statusCode})`,
  });
}
