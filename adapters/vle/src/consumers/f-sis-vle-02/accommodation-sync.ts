import type { VleTx } from '../../db/client.js';
import type { VlePlatformDriver } from '../../vle-platforms/driver.js';
import { combinedExtraTimePercent } from '../../vle-platforms/time-accommodation.js';

import { findActiveCoursesForPerson, findInForceAdjustments, type AdjustmentMapRow } from './adjustment-map-repository.js';

export interface SyncSummary {
  courses: number;
  changes: number;
}

/**
 * Make the VLE match what a student's adjustments entitle them to, in every
 * active course: one combined extra-time percentage per SRS enrolment (an
 * adjustment applies to the enrolment it was recorded on), 0 where none is in
 * force today. Called whenever an input changes — an instruction or
 * withdrawal arrives, the student joins a course — and by the coverage
 * reconciliation, which also picks up assessments added in the VLE since,
 * adjustments whose valid period has started, and ones whose period ended
 * without a withdrawal arriving.
 *
 * Desired state, not deltas: every call states the full value, so repeats are
 * harmless and removal is the same operation with 0.
 */
export async function syncPersonAccommodations(
  tx:       VleTx,
  tenantId: string,
  personId: string,
  driver:   VlePlatformDriver,
  now:      Date = new Date(),
  onlyVleCourseId?: string,
): Promise<SyncSummary> {
  const adjustments = (await findInForceAdjustments(tx, tenantId, personId)).filter((a) => inValidPeriod(a, now));
  const courses = await findActiveCoursesForPerson(tx, tenantId, personId);

  let changes = 0;
  let synced = 0;
  for (const course of courses) {
    if (onlyVleCourseId && course.vleCourseId !== onlyVleCourseId) continue;
    const percent = combinedExtraTimePercent(adjustments.filter((a) => a.enrolmentId === course.enrolmentId));
    const result = await driver.setTimeAccommodation({ vleCourseId: course.vleCourseId, personId }, percent);
    changes += result.changes;
    synced += 1;
  }
  return { courses: synced, changes };
}

function inValidPeriod(a: AdjustmentMapRow, now: Date): boolean {
  return a.validFrom <= now && (a.validTo === null || a.validTo > now);
}
