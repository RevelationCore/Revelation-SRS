import { ValidationError, adjustmentAmountProblem, type AdjustmentAmountV1 } from '@revelation-srs/domain';
import type { reasonableAdjustments } from '@revelation-srs/db';

// The rules are shared with the migration importer (BL-385).
export { AMOUNT_UNITS_BY_TYPE, MAX_AMOUNT_VALUE } from '@revelation-srs/domain';

export function validateAmountForType(adjustmentTypeCode: string, amount: AdjustmentAmountV1 | undefined): void {
  if (!amount) return;
  const problem = adjustmentAmountProblem(adjustmentTypeCode, amount);
  if (problem) throw new ValidationError(problem.message, [{ field: problem.field, message: problem.hint }]);
}

export function amountFromRow(
  row: Pick<typeof reasonableAdjustments.$inferSelect, 'amountValue' | 'amountUnitCode'>,
): AdjustmentAmountV1 | null {
  if (row.amountValue === null || row.amountUnitCode === null) return null;
  return { value: Number(row.amountValue), unitCode: row.amountUnitCode };
}
