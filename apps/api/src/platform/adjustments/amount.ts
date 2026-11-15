import { ValidationError, type AdjustmentAmountV1 } from '@revelation-srs/domain';
import type { reasonableAdjustments } from '@revelation-srs/db';

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

export const MAX_AMOUNT_VALUE = 999_999.99;

export function validateAmountForType(adjustmentTypeCode: string, amount: AdjustmentAmountV1 | undefined): void {
  if (!amount) return;

  if (!Number.isFinite(amount.value) || amount.value <= 0 || amount.value > MAX_AMOUNT_VALUE
      || Math.abs(Math.round(amount.value * 100) - amount.value * 100) > 1e-6) {
    throw new ValidationError('Adjustment amount must be a positive number with at most two decimal places', [
      { field: 'amount.value', message: `Must be greater than 0, at most ${MAX_AMOUNT_VALUE}, with at most two decimal places` },
    ]);
  }

  if (!(adjustmentTypeCode in AMOUNT_UNITS_BY_TYPE)) return;
  const allowed = AMOUNT_UNITS_BY_TYPE[adjustmentTypeCode];
  if (allowed === null || allowed === undefined) {
    throw new ValidationError(`A '${adjustmentTypeCode}' adjustment does not take an amount`, [
      { field: 'amount', message: 'Omit amount for this adjustment type' },
    ]);
  }
  if (!allowed.includes(amount.unitCode)) {
    throw new ValidationError(
      `A '${adjustmentTypeCode}' adjustment's amount must be in ${allowed.join(' or ')}`,
      [{ field: 'amount.unitCode', message: `Must be one of: ${allowed.join(', ')}` }],
    );
  }
}

export function amountFromRow(
  row: Pick<typeof reasonableAdjustments.$inferSelect, 'amountValue' | 'amountUnitCode'>,
): AdjustmentAmountV1 | null {
  if (row.amountValue === null || row.amountUnitCode === null) return null;
  return { value: Number(row.amountValue), unitCode: row.amountUnitCode };
}
