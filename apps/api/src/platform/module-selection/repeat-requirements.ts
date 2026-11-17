import {
  academicPeriods,
  moduleGroupMembers,
  moduleGroups,
  moduleOfferings,
  moduleRegistrations,
  moduleResults,
  modules,
  progressionDecisions,
  reassessmentPlans,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

/** The `repeat-module-requirement` rule value (Phase 4 D-28), with its defaults. */
export interface RepeatRule {
  maxRepeatCredits: number | null;
  allowReplacement: 'optional-only' | 'never' | 'any';
  countTowardsCreditLoad: boolean;
  repeatStageScope: 'failed-modules' | 'all-modules';
}

export const DEFAULT_REPEAT_RULE: RepeatRule = {
  maxRepeatCredits: null, allowReplacement: 'optional-only', countTowardsCreditLoad: true, repeatStageScope: 'failed-modules',
};

export function repeatRuleFrom(value: Record<string, unknown> | null | undefined): RepeatRule {
  const v = value ?? {};
  return {
    maxRepeatCredits: typeof v['maxRepeatCredits'] === 'number' ? v['maxRepeatCredits'] : null,
    allowReplacement: v['allowReplacement'] === 'never' || v['allowReplacement'] === 'any' ? v['allowReplacement'] : 'optional-only',
    countTowardsCreditLoad: v['countTowardsCreditLoad'] !== false,
    repeatStageScope: v['repeatStageScope'] === 'all-modules' ? 'all-modules' : 'failed-modules',
  };
}

/** One module the board requires the student to repeat with attendance. */
export interface RepeatRequirement {
  planId: string;
  planTypeCode: 'repeat-module' | 'repeat-stage';
  failedRegistrationId: string;
  moduleId: string;
  moduleCode: string;
  creditValue: number;
}

const FAILED_RESULTS = ['fail', 'resit-required'];

/**
 * The repeat requirements for a proposal (D-28): only ratified board
 * outcomes count, as planned `repeat-module` plans, and `repeat-stage` plans
 * expanded to the modules failed in that stage. A plan applies to its
 * academic period's year, or, with no period, to proposals for periods that
 * start after it was made. A plan that already produced a repeat
 * registration is satisfied. Plans needing no teaching registration (resit
 * without attendance, referral, deferral) are not requirements.
 */
export async function repeatRequirements(
  db: Db, tenantId: string, enrolmentId: string, proposalPeriodId: string, rule: RepeatRule,
): Promise<RepeatRequirement[]> {
  const t = tenantId as Uuid;
  return withTenantContext(db, tenantId, async (tx) => {
    const [period] = await tx.select().from(academicPeriods).where(and(eq(academicPeriods.tenantId, t), eq(academicPeriods.id, proposalPeriodId as Uuid))).limit(1);
    if (!period) return [];
    const plans = await tx.select().from(reassessmentPlans).where(and(
      eq(reassessmentPlans.tenantId, t), eq(reassessmentPlans.enrolmentId, enrolmentId as Uuid),
      eq(reassessmentPlans.statusCode, 'planned'), inArray(reassessmentPlans.planTypeCode, ['repeat-module', 'repeat-stage']),
      isNull(reassessmentPlans.repeatModuleRegistrationId),
    ));
    const out: RepeatRequirement[] = [];
    for (const plan of plans) {
      if (plan.academicPeriodId) {
        const [planPeriod] = await tx.select({ year: academicPeriods.academicYear }).from(academicPeriods).where(eq(academicPeriods.id, plan.academicPeriodId)).limit(1);
        if (planPeriod?.year !== period.academicYear) continue;
      } else if (plan.createdAt.toISOString().slice(0, 10) >= period.startDate) {
        continue;
      }

      let failedRegistrationIds: string[] = [];
      if (plan.planTypeCode === 'repeat-module') {
        if (plan.moduleRegistrationId) failedRegistrationIds = [plan.moduleRegistrationId];
      } else if (rule.repeatStageScope === 'failed-modules') {
        const [decision] = await tx.select({ year: progressionDecisions.academicYear }).from(progressionDecisions)
          .where(and(eq(progressionDecisions.tenantId, t), eq(progressionDecisions.id, plan.progressionDecisionId))).limit(1);
        if (!decision) continue;
        const failed = await tx.select({ id: moduleRegistrations.id }).from(moduleResults)
          .innerJoin(moduleRegistrations, and(eq(moduleRegistrations.id, moduleResults.moduleRegistrationId), isNull(moduleRegistrations.recordedUntil)))
          .innerJoin(moduleOfferings, eq(moduleOfferings.id, moduleRegistrations.moduleOfferingId))
          .innerJoin(academicPeriods, eq(academicPeriods.id, moduleOfferings.academicPeriodId))
          .where(and(
            eq(moduleResults.tenantId, t), isNull(moduleResults.recordedUntil), inArray(moduleResults.resultCode, FAILED_RESULTS),
            eq(moduleRegistrations.enrolmentId, enrolmentId as Uuid), eq(academicPeriods.academicYear, decision.year),
          ));
        failedRegistrationIds = failed.map((f) => f.id);
      }

      for (const registrationId of failedRegistrationIds) {
        const [m] = await tx.select({ moduleId: modules.id, code: modules.code, credit: modules.creditValue })
          .from(moduleRegistrations)
          .innerJoin(moduleOfferings, eq(moduleOfferings.id, moduleRegistrations.moduleOfferingId))
          .innerJoin(modules, and(eq(modules.id, moduleOfferings.moduleId), isNull(modules.recordedUntil)))
          .where(and(eq(moduleRegistrations.tenantId, t), eq(moduleRegistrations.id, registrationId as Uuid))).limit(1);
        if (!m) continue;
        out.push({
          planId: plan.id, planTypeCode: plan.planTypeCode as 'repeat-module' | 'repeat-stage', failedRegistrationId: registrationId,
          moduleId: m.moduleId, moduleCode: m.code, creditValue: m.credit ?? 0,
        });
      }
    }
    return out;
  });
}

/** Modules the student has failed on this enrolment (a replacement cannot be one of them). */
export async function failedModuleIds(db: Db, tenantId: string, enrolmentId: string): Promise<Set<string>> {
  const rows = await withTenantContext(db, tenantId, (tx) => tx.select({ moduleId: moduleOfferings.moduleId }).from(moduleResults)
    .innerJoin(moduleRegistrations, and(eq(moduleRegistrations.id, moduleResults.moduleRegistrationId), isNull(moduleRegistrations.recordedUntil)))
    .innerJoin(moduleOfferings, eq(moduleOfferings.id, moduleRegistrations.moduleOfferingId))
    .where(and(
      eq(moduleResults.tenantId, tenantId as Uuid), isNull(moduleResults.recordedUntil), inArray(moduleResults.resultCode, FAILED_RESULTS),
      eq(moduleRegistrations.enrolmentId, enrolmentId as Uuid),
    )));
  return new Set(rows.map((r) => r.moduleId));
}

/** The diet groups of a rule set each module belongs to, with each group's type and the member's non-condonable flag. */
export async function groupMembership(db: Db, tenantId: string, programmeRuleSetId: string): Promise<Map<string, Array<{ groupId: string; groupTypeCode: string; isNonCondonable: boolean }>>> {
  const rows = await withTenantContext(db, tenantId, (tx) => tx.select({
    moduleId: moduleGroupMembers.moduleId, groupId: moduleGroups.id, groupTypeCode: moduleGroups.groupTypeCode, isNonCondonable: moduleGroupMembers.isNonCondonable,
  }).from(moduleGroupMembers)
    .innerJoin(moduleGroups, and(eq(moduleGroups.id, moduleGroupMembers.moduleGroupId), isNull(moduleGroups.recordedUntil)))
    .where(and(
      eq(moduleGroupMembers.tenantId, tenantId as Uuid), isNull(moduleGroupMembers.recordedUntil),
      eq(moduleGroups.programmeRuleSetId, programmeRuleSetId as Uuid),
    )));
  const map = new Map<string, Array<{ groupId: string; groupTypeCode: string; isNonCondonable: boolean }>>();
  for (const r of rows) {
    const list = map.get(r.moduleId) ?? [];
    list.push({ groupId: r.groupId, groupTypeCode: r.groupTypeCode, isNonCondonable: r.isNonCondonable });
    map.set(r.moduleId, list);
  }
  return map;
}
