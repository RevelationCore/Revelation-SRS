import { academicPeriods, reassessmentPlans, type withTenantContext } from '@revelation-srs/db';
import { and, eq, inArray, ne } from 'drizzle-orm';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;
type Tx = Parameters<Parameters<typeof withTenantContext>[2]>[0];

/** The plan type a failed module gets by default (D-12; an institution may prefer resit-without-attendance). */
export const DEFAULT_MODULE_PLAN_TYPE = 'referral';
/** Used when no resit-mark-cap rule is configured (D-12). */
export const DEFAULT_RESIT_MARK_CAP = 40;

const FAILED = ['fail', 'resit-required'];

export interface RatifiedDecision { progressionDecisionId: string; enrolmentId: string; decisionCode: string; academicYear: string }
export interface RatifiedResult { moduleRegistrationId: string; enrolmentId: string; resultCode: string }

/**
 * Creates the reassessment plans a board's ratified progression decisions
 * call for (BP-06-002; D-12), inside the ratification transaction so
 * ratifying and planning succeed or fail together.
 *
 * A resit decision gets one plan per failed module (`referral` by default;
 * a deferred result gets `deferral`, uncapped). A repeat-year decision gets
 * one `repeat-stage` plan. The due date and period come from the year's
 * reassessment period when the calendar has one; otherwise they are left
 * empty for staff to set. A decision and module that already have a live
 * plan get no second one, so repeating ratification is safe. Staff change a
 * plan by cancelling it and creating a replacement.
 */
export async function planReassessmentsAtRatification(tx: Tx, tenantId: string, input: {
  decisions: RatifiedDecision[];
  results: RatifiedResult[];
  markCapFor: (enrolmentId: string) => number;
  actorId: string;
}): Promise<number> {
  const decisions = input.decisions.filter((d) => d.decisionCode === 'resit' || d.decisionCode === 'repeat-year');
  if (decisions.length === 0) return 0;

  const existing = await tx.select({ decision: reassessmentPlans.progressionDecisionId, module: reassessmentPlans.moduleRegistrationId })
    .from(reassessmentPlans).where(and(
      eq(reassessmentPlans.tenantId, tenantId as Uuid),
      inArray(reassessmentPlans.progressionDecisionId, decisions.map((d) => d.progressionDecisionId as Uuid)),
      ne(reassessmentPlans.statusCode, 'cancelled'),
    ));
  const has = (decision: string, module: string | null) => existing.some((e) => e.decision === decision && (e.module ?? null) === module);

  // Attempt numbering follows createPlan: a deferral keeps first-attempt treatment and does not count.
  const prior = await tx.select({ enrolment: reassessmentPlans.enrolmentId, module: reassessmentPlans.moduleRegistrationId, attempt: reassessmentPlans.attemptNumber, type: reassessmentPlans.planTypeCode })
    .from(reassessmentPlans).where(and(
      eq(reassessmentPlans.tenantId, tenantId as Uuid),
      inArray(reassessmentPlans.enrolmentId, [...new Set(decisions.map((d) => d.enrolmentId as Uuid))]),
    ));
  const used = (enrolment: string, module: string | null) => prior
    .filter((p) => p.enrolment === enrolment && (module === null || p.module === module) && p.type !== 'deferral')
    .reduce((max, p) => Math.max(max, p.attempt), 1);

  const years = [...new Set(decisions.map((d) => d.academicYear))];
  const periods = await tx.select().from(academicPeriods).where(and(
    eq(academicPeriods.tenantId, tenantId as Uuid), inArray(academicPeriods.academicYear, years), eq(academicPeriods.periodTypeCode, 'reassessment'),
  ));

  const rows: Array<typeof reassessmentPlans.$inferInsert> = [];
  for (const d of decisions) {
    const period = periods.find((p) => p.academicYear === d.academicYear) ?? null;
    const timing = { academicPeriodId: (period?.id ?? null) as Uuid | null, dueDate: period?.endDate ?? null };
    const base = { tenantId: tenantId as Uuid, enrolmentId: d.enrolmentId as Uuid, progressionDecisionId: d.progressionDecisionId as Uuid, createdBy: input.actorId, ...timing };
    if (d.decisionCode === 'repeat-year') {
      if (!has(d.progressionDecisionId, null)) rows.push({ ...base, planTypeCode: 'repeat-stage', attemptNumber: used(d.enrolmentId, null) + 1, markCap: input.markCapFor(d.enrolmentId) });
      continue;
    }
    for (const r of input.results.filter((x) => x.enrolmentId === d.enrolmentId)) {
      if (has(d.progressionDecisionId, r.moduleRegistrationId)) continue;
      if (r.resultCode === 'deferred') {
        rows.push({ ...base, planTypeCode: 'deferral', moduleRegistrationId: r.moduleRegistrationId as Uuid, attemptNumber: Math.max(2, used(d.enrolmentId, r.moduleRegistrationId)), markCap: null });
      } else if (FAILED.includes(r.resultCode)) {
        rows.push({ ...base, planTypeCode: DEFAULT_MODULE_PLAN_TYPE, moduleRegistrationId: r.moduleRegistrationId as Uuid, attemptNumber: used(d.enrolmentId, r.moduleRegistrationId) + 1, markCap: input.markCapFor(d.enrolmentId) });
      }
    }
  }
  if (rows.length > 0) await tx.insert(reassessmentPlans).values(rows);
  return rows.length;
}
