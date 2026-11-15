/**
 * Platform-neutral time-accommodation arithmetic.
 *
 * VLEs hold extra time per assessment (Canvas: extra minutes per quiz;
 * Moodle: an override time limit per quiz, set per group), not per student, so
 * the connector reduces a student's active time adjustments to ONE figure per
 * enrolment — additional time as a percentage of an assessment's duration —
 * and each platform driver turns that into whatever the platform stores.
 *
 * Several adjustments combine additively: 25% extra time plus 10 minutes per
 * hour of rest breaks is 25 + 16.67 = 41.67% of the duration. A single VLE
 * value per student per quiz cannot hold them separately, and applying only
 * one would silently drop the other.
 */

export interface AdjustmentAmount {
  value:    number;
  unitCode: string;
}

/** Adjustment types a VLE applies as additional time on timed assessments. */
export const TIME_ADJUSTMENT_TYPES: readonly string[] = ['extra-time', 'rest-breaks'];

export function isTimeAdjustment(adjustmentTypeCode: string): boolean {
  return TIME_ADJUSTMENT_TYPES.includes(adjustmentTypeCode);
}

/**
 * The amount as a percentage of duration, or null when the unit is not a
 * time-on-duration unit (e.g. 'days', which a VLE quiz cannot use).
 */
export function percentOfDuration(amount: AdjustmentAmount): number | null {
  switch (amount.unitCode) {
    case 'percent-of-duration': return amount.value;
    case 'minutes-per-hour':    return (amount.value * 100) / 60;
    default:                    return null;
  }
}

export interface ActiveTimeAdjustment {
  distributionId:     string;
  adjustmentTypeCode: string;
  amount:             AdjustmentAmount | null;
}

/** Combined additional time, rounded to two decimal places. */
export function combinedExtraTimePercent(adjustments: readonly ActiveTimeAdjustment[]): number {
  let total = 0;
  for (const a of adjustments) {
    if (!isTimeAdjustment(a.adjustmentTypeCode) || !a.amount) continue;
    const pct = percentOfDuration(a.amount);
    if (pct !== null) total += pct;
  }
  return Math.round(total * 100) / 100;
}

/**
 * Additional whole minutes for an assessment of `limitMinutes`, rounded up so
 * the student never receives less than their entitlement (25% of 45 minutes
 * is 11.25, so 12). Zero when there is no accommodation.
 */
export function extraMinutesFor(limitMinutes: number, extraTimePercent: number): number {
  if (extraTimePercent <= 0 || limitMinutes <= 0) return 0;
  return Math.ceil((limitMinutes * extraTimePercent) / 100 - 1e-9);
}

/** A stable label for a percentage: 25, 16.67 — no trailing zeros. */
export function formatPercent(extraTimePercent: number): string {
  return String(Math.round(extraTimePercent * 100) / 100);
}
