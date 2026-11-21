import {
  combinedExtraTimePercent,
  extraMinutesFor,
  isTimeAdjustment,
  percentOfDuration,
  type AdjustmentAmountV1,
} from '@revelation-srs/domain';

/**
 * What an exam entry tells the scheduling system about a candidate's
 * reasonable adjustments (the SRS is the 'exams' distribution target; the
 * entry batch is its delivery, exam-scheduling.v1).
 *
 * The time a candidate is entitled to is stated, not left to be worked out:
 * a 120-minute exam with 25% extra time is 30 extra minutes, 150 in total
 * (AJ-21). Several time adjustments combine (see adjustment-time.ts).
 */
export interface ExamAccommodations {
  adjustments:      ExamAdjustment[];
  /** Combined additional time from the applied time adjustments. */
  extraTimePercent: number;
  /** The offering's exam components, with this candidate's timings. */
  components:       ExamComponentTiming[];
}

export interface ExamAdjustment {
  adjustmentId:       string;
  /** The 'exams' distribution this entry delivers; null if none exists. */
  distributionId:     string | null;
  adjustmentTypeCode: string;
  scopeCode:          string;
  amount:             AdjustmentAmountV1 | null;
  /** False when the entry cannot carry it (reason says why). */
  applied:            boolean;
  reason?:            string;
}

export interface ExamComponentTiming {
  assessmentComponentId: string;
  title:                 string;
  durationMinutes:       number | null;
  extraMinutes:          number | null;
  totalMinutes:          number | null;
}

export interface InForceAdjustment {
  adjustmentId:       string;
  distributionId:     string | null;
  adjustmentTypeCode: string;
  scopeCode:          string;
  amount:             AdjustmentAmountV1 | null;
}

export interface ExamComponent {
  assessmentComponentId: string;
  title:                 string;
  durationMinutes:       number | null;
}

/** Types an exam timetable has nothing to do with. */
const NOT_FOR_EXAMS = new Set(['deadline-extension']);

export const NO_AMOUNT_REASON =
  'No structured amount was recorded, so the extra time for this exam cannot be stated; record the amount on the adjustment';
export const NO_DURATION_REASON =
  'An exam component of this module has no recorded duration, so the extra minutes cannot be stated';

export function buildExamAccommodations(
  inForce: readonly InForceAdjustment[],
  components: readonly ExamComponent[],
): ExamAccommodations {
  const allTimed = components.length > 0 && components.every((c) => c.durationMinutes !== null);

  const adjustments: ExamAdjustment[] = inForce
    .filter((a) => (a.scopeCode === 'exam' || a.scopeCode === 'all') && !NOT_FOR_EXAMS.has(a.adjustmentTypeCode))
    .map((a) => {
      if (!isTimeAdjustment(a.adjustmentTypeCode)) return { ...a, applied: true };
      if (!a.amount || percentOfDuration(a.amount) === null) return { ...a, applied: false, reason: NO_AMOUNT_REASON };
      if (!allTimed) return { ...a, applied: false, reason: NO_DURATION_REASON };
      return { ...a, applied: true };
    });

  const extraTimePercent = combinedExtraTimePercent(
    adjustments.filter((a) => a.applied && isTimeAdjustment(a.adjustmentTypeCode)),
  );

  return {
    adjustments,
    extraTimePercent,
    components: components.map((c) => {
      if (c.durationMinutes === null) {
        return { ...c, extraMinutes: null, totalMinutes: null };
      }
      const extraMinutes = extraMinutesFor(c.durationMinutes, extraTimePercent);
      return { ...c, extraMinutes, totalMinutes: c.durationMinutes + extraMinutes };
    }),
  };
}

/** Recompute without one adjustment (its withdrawal), keeping the rest. */
export function withoutAdjustment(current: ExamAccommodations, adjustmentId: string): ExamAccommodations {
  return buildExamAccommodations(
    current.adjustments
      .filter((a) => a.adjustmentId !== adjustmentId)
      .map(({ adjustmentId: id, distributionId, adjustmentTypeCode, scopeCode, amount }) => ({
        adjustmentId: id, distributionId, adjustmentTypeCode, scopeCode, amount,
      })),
    current.components.map(({ assessmentComponentId, title, durationMinutes }) => ({ assessmentComponentId, title, durationMinutes })),
  );
}

/** Recompute with one more adjustment (approved after the entry was made, BL-058), keeping the rest. */
export function withAdjustment(current: ExamAccommodations, added: InForceAdjustment): ExamAccommodations {
  return buildExamAccommodations(
    [
      ...current.adjustments
        .filter((a) => a.adjustmentId !== added.adjustmentId)
        .map(({ adjustmentId: id, distributionId, adjustmentTypeCode, scopeCode, amount }) => ({
          adjustmentId: id, distributionId, adjustmentTypeCode, scopeCode, amount,
        })),
      added,
    ],
    current.components.map(({ assessmentComponentId, title, durationMinutes }) => ({ assessmentComponentId, title, durationMinutes })),
  );
}

export function isExamAccommodations(value: unknown): value is ExamAccommodations {
  return typeof value === 'object' && value !== null
    && Array.isArray((value as { adjustments?: unknown }).adjustments)
    && Array.isArray((value as { components?: unknown }).components);
}
