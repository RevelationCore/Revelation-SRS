/**
 * Structured amount of a reasonable adjustment, carried on adjustment events
 * so a target's integration layer can compute a concrete value per assessment.
 *
 * unitCode (value set adjustment-amount-unit-code):
 *   percent-of-duration — additional time as a percentage of the assessment's
 *                         duration (25 on a 120-minute exam = 30 minutes)
 *   minutes-per-hour    — additional minutes per hour of duration
 *   days                — calendar days (e.g. a deadline-extension ceiling)
 */
export interface AdjustmentAmountV1 {
  value:    number;
  unitCode: string;
}
