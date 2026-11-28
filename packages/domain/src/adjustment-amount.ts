/**
 * Which amounts each reasonable-adjustment type accepts, shared by every path
 * that records an adjustment (the SRS's own write path and the migration
 * importer), so an amount the API refuses cannot arrive by migration.
 */

/**
 * Which amount units each platform adjustment type accepts. null means the
 * type takes no amount (it is a provision, not a quantity). Types a tenant
 * adds to the extensible adjustment-type-code value set are not listed and
 * accept any unit in the adjustment-amount-unit-code value set.
 *
 * An amount stays optional for every type: it may be recorded in an outcome
 * document instead, in which case target systems that need a number (a VLE
 * computing per-quiz extra time) report that they cannot apply it.
 */
export const AMOUNT_UNITS_BY_TYPE: Readonly<Record<string, readonly string[] | null>> = {
  'extra-time':         ['percent-of-duration', 'minutes-per-hour'],
  'rest-breaks':        ['minutes-per-hour'],
  'deadline-extension': ['days'],
  'separate-room':      null,
  'reader':             null,
  'scribe':             null,
};

/** The largest value the amount column (numeric(8,2)) holds. */
export const MAX_AMOUNT_VALUE = 999_999.99;

export interface AdjustmentAmountProblem {
  field:   'amount' | 'amount.value' | 'amount.unitCode';
  /** The problem's title. */
  message: string;
  /** What would be accepted. */
  hint:    string;
}

/**
 * Why this amount cannot be recorded for this adjustment type, or null when
 * it can. Whether the unit is in the tenant's value set is checked separately.
 */
export function adjustmentAmountProblem(
  adjustmentTypeCode: string,
  amount: { value: number; unitCode: string },
): AdjustmentAmountProblem | null {
  if (!Number.isFinite(amount.value) || amount.value <= 0 || amount.value > MAX_AMOUNT_VALUE
      || Math.abs(Math.round(amount.value * 100) - amount.value * 100) > 1e-6) {
    return {
      field: 'amount.value',
      message: 'Adjustment amount must be a positive number with at most two decimal places',
      hint: `Must be greater than 0, at most ${MAX_AMOUNT_VALUE}, with at most two decimal places`,
    };
  }

  if (!(adjustmentTypeCode in AMOUNT_UNITS_BY_TYPE)) return null;
  const allowed = AMOUNT_UNITS_BY_TYPE[adjustmentTypeCode];
  if (allowed === null || allowed === undefined) {
    return {
      field: 'amount',
      message: `A '${adjustmentTypeCode}' adjustment does not take an amount`,
      hint: 'Omit amount for this adjustment type',
    };
  }
  if (!allowed.includes(amount.unitCode)) {
    return {
      field: 'amount.unitCode',
      message: `A '${adjustmentTypeCode}' adjustment's amount must be in ${allowed.join(' or ')}`,
      hint: `Must be one of: ${allowed.join(', ')}`,
    };
  }
  return null;
}
