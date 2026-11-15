/**
 * Reasonable-adjustment time arithmetic, shared by every target that turns an
 * approved adjustment into additional time on an assessment (the SRS's own
 * exam entries, the VLE connector), so they compute the same minutes.
 *
 * A student's time adjustments combine additively into one percentage of the
 * assessment's duration: 25% extra time plus 10 minutes per hour of rest
 * breaks is 25 + 16.67 = 41.67%. A target holds one value per student per
 * assessment, so applying only one adjustment would silently drop the other.
 */

export interface AdjustmentTimeAmount {
  value:    number;
  unitCode: string;
}

/** Adjustment types applied as additional time on timed assessments. */
export const TIME_ADJUSTMENT_TYPES: readonly string[] = ['extra-time', 'rest-breaks'];

export function isTimeAdjustment(adjustmentTypeCode: string): boolean {
  return TIME_ADJUSTMENT_TYPES.includes(adjustmentTypeCode);
}

/**
 * The amount as a percentage of duration, or null when the unit is not a
 * time-on-duration unit (e.g. 'days', which a timed assessment cannot use).
 */
export function percentOfDuration(amount: AdjustmentTimeAmount): number | null {
  switch (amount.unitCode) {
    case 'percent-of-duration': return amount.value;
    case 'minutes-per-hour':    return (amount.value * 100) / 60;
    default:                    return null;
  }
}

export interface TimeAdjustmentInput {
  adjustmentTypeCode: string;
  amount:             AdjustmentTimeAmount | null;
}

/** Combined additional time, rounded to two decimal places. */
export function combinedExtraTimePercent(adjustments: readonly TimeAdjustmentInput[]): number {
  let total = 0;
  for (const a of adjustments) {
    if (!isTimeAdjustment(a.adjustmentTypeCode) || !a.amount) continue;
    const pct = percentOfDuration(a.amount);
    if (pct !== null) total += pct;
  }
  return Math.round(total * 100) / 100;
}

/**
 * Additional whole minutes for an assessment of `durationMinutes`, rounded up
 * so the student never receives less than their entitlement (25% of 45
 * minutes is 11.25, so 12; 25% of 120 is 30). Zero when there is none.
 */
export function extraMinutesFor(durationMinutes: number, extraTimePercent: number): number {
  if (extraTimePercent <= 0 || durationMinutes <= 0) return 0;
  return Math.ceil((durationMinutes * extraTimePercent) / 100 - 1e-9);
}

/** A stable label for a percentage: 25, 16.67 — no trailing zeros. */
export function formatPercent(extraTimePercent: number): string {
  return String(Math.round(extraTimePercent * 100) / 100);
}
