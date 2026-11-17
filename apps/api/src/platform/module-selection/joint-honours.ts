import { randomUUID } from 'node:crypto';

import {
  academicPeriods,
  moduleGroupMembers,
  moduleGroups,
  moduleOfferings,
  moduleRegistrations,
  modules,
  moduleSubjects,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError, ValidationError } from '@revelation-srs/domain';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';

import { clockNow } from '../clock.js';
import type { ValueSetService } from '../value-sets/service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export interface ModuleSubjectShare { subjectAreaCode: string; proportionPercent: number }

/** The `joint-honours-balance` rule value (Phase 4 D-27). */
export interface JointHonoursRule {
  components: Array<{ subjectAreaCode: string; minPercent?: number | null; maxPercent?: number | null }>;
  countExemptions?: boolean;
  unassigned?: 'count-in-total' | 'ignore';
  tolerancePercent?: number;
}

export interface BalanceMessage { ruleTypeCode: 'joint-honours-balance'; severity: 'error' | 'warning'; message: string; moduleId?: string }

/**
 * Subject areas of modules (D-27). A module's subjects are held at module
 * level with a proportion, as HESA's ModuleSubject does; its current rows
 * always sum to 100. Replacing them closes the current rows and records new
 * ones, so earlier versions stay readable.
 */
export class ModuleSubjectService {
  constructor(private readonly db: Db, private readonly valueSets: ValueSetService) {}

  async list(tenantId: string, moduleId: string): Promise<ModuleSubjectShare[]> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(moduleSubjects).where(and(
      eq(moduleSubjects.tenantId, tenantId as Uuid), eq(moduleSubjects.moduleId, moduleId as Uuid), isNull(moduleSubjects.recordedUntil),
    )));
    return rows.map((r) => ({ subjectAreaCode: r.subjectAreaCode, proportionPercent: r.proportionPercent }))
      .sort((a, b) => b.proportionPercent - a.proportionPercent || a.subjectAreaCode.localeCompare(b.subjectAreaCode));
  }

  async replace(tenantId: string, moduleId: string, shares: ModuleSubjectShare[]): Promise<ModuleSubjectShare[]> {
    const [module] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ id: modules.id }).from(modules)
      .where(and(eq(modules.tenantId, tenantId as Uuid), eq(modules.id, moduleId as Uuid), isNull(modules.recordedUntil))).limit(1));
    if (!module) throw new NotFoundError('Module', moduleId);
    if (shares.length > 0) {
      const total = shares.reduce((s, x) => s + x.proportionPercent, 0);
      if (total !== 100) throw new ValidationError(`A module's subject proportions must sum to 100 (they sum to ${total})`);
      if (new Set(shares.map((s) => s.subjectAreaCode)).size !== shares.length) throw new ValidationError('Each subject area may appear once');
      for (const s of shares) {
        if (!Number.isInteger(s.proportionPercent) || s.proportionPercent < 1 || s.proportionPercent > 100) throw new ValidationError('Each proportion must be a whole number from 1 to 100');
        if ((await this.valueSets.validateFieldValue('module_subject', 'subject_area_code', s.subjectAreaCode, tenantId)) === false) {
          throw new ValidationError(`Unknown subject area '${s.subjectAreaCode}': add it to the subject-area-code value set first`);
        }
      }
    }
    const now = clockNow();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.update(moduleSubjects).set({ recordedUntil: now, validTo: now }).where(and(
        eq(moduleSubjects.tenantId, tenantId as Uuid), eq(moduleSubjects.moduleId, moduleId as Uuid), isNull(moduleSubjects.recordedUntil),
      ));
      for (const s of shares) {
        await tx.insert(moduleSubjects).values({
          versionId: randomUUID() as Uuid, id: randomUUID() as Uuid, tenantId: tenantId as Uuid, moduleId: moduleId as Uuid,
          subjectAreaCode: s.subjectAreaCode, proportionPercent: s.proportionPercent, validFrom: now, validTo: null, recordedAt: now, recordedUntil: null,
        });
      }
    });
    return this.list(tenantId, moduleId);
  }
}

/**
 * Evaluates joint-honours balance for a year (D-27): the share of credit
 * in each subject component, over the proposal's items, the student's
 * registrations in the year's other periods and, by default, approved
 * exemptions for the year. A diet may count a cross-listed module wholly
 * towards one subject. A module with no subjects draws a warning.
 */
export async function evaluateJointHonours(
  db: Db,
  tenantId: string,
  input: {
    rule: JointHonoursRule;
    enrolmentId: string;
    academicPeriodId: string;
    programmeRuleSetId: string;
    items: Array<{ moduleId: string; moduleCode: string; creditValue: number | null }>;
    exemptions: Array<{ moduleId: string; creditValue: number }>;
  },
): Promise<BalanceMessage[]> {
  const t = tenantId as Uuid;
  const rule = input.rule;
  if (!Array.isArray(rule.components) || rule.components.length === 0) return [];
  const tolerance = rule.tolerancePercent ?? 0;

  const contributions: Array<{ moduleId: string; code: string; credit: number }> = input.items
    .map((i) => ({ moduleId: i.moduleId, code: i.moduleCode, credit: i.creditValue ?? 0 }));

  // Registrations in the year's other periods.
  const others = await withTenantContext(db, tenantId, async (tx) => {
    const [period] = await tx.select({ year: academicPeriods.academicYear }).from(academicPeriods).where(and(eq(academicPeriods.tenantId, t), eq(academicPeriods.id, input.academicPeriodId as Uuid))).limit(1);
    if (!period) return [];
    return tx.select({ moduleId: modules.id, code: modules.code, credit: modules.creditValue }).from(moduleRegistrations)
      .innerJoin(moduleOfferings, eq(moduleOfferings.id, moduleRegistrations.moduleOfferingId))
      .innerJoin(academicPeriods, eq(academicPeriods.id, moduleOfferings.academicPeriodId))
      .innerJoin(modules, and(eq(modules.id, moduleOfferings.moduleId), isNull(modules.recordedUntil)))
      .where(and(
        eq(moduleRegistrations.tenantId, t), eq(moduleRegistrations.enrolmentId, input.enrolmentId as Uuid), isNull(moduleRegistrations.recordedUntil),
        inArray(moduleRegistrations.statusCode, ['registered', 'completed']),
        eq(academicPeriods.academicYear, period.year), ne(academicPeriods.id, input.academicPeriodId as Uuid),
      ));
  });
  for (const o of others) contributions.push({ moduleId: o.moduleId, code: o.code, credit: o.credit ?? 0 });

  if (rule.countExemptions !== false) {
    const codes = input.exemptions.length === 0 ? [] : await withTenantContext(db, tenantId, (tx) => tx.select({ id: modules.id, code: modules.code }).from(modules)
      .where(and(eq(modules.tenantId, t), inArray(modules.id, input.exemptions.map((e) => e.moduleId) as Uuid[]), isNull(modules.recordedUntil))));
    for (const e of input.exemptions) {
      if (contributions.some((c) => c.moduleId === e.moduleId)) continue;
      contributions.push({ moduleId: e.moduleId, code: codes.find((c) => c.id === e.moduleId)?.code ?? 'exempt module', credit: e.creditValue });
    }
  }

  const moduleIds = [...new Set(contributions.map((c) => c.moduleId))];
  if (moduleIds.length === 0) return [];
  const [subjects, overrides] = await withTenantContext(db, tenantId, async (tx) => [
    await tx.select().from(moduleSubjects).where(and(eq(moduleSubjects.tenantId, t), inArray(moduleSubjects.moduleId, moduleIds as Uuid[]), isNull(moduleSubjects.recordedUntil))),
    await tx.select({ moduleId: moduleGroupMembers.moduleId, code: moduleGroupMembers.countsTowardsSubjectAreaCode }).from(moduleGroupMembers)
      .innerJoin(moduleGroups, and(eq(moduleGroups.id, moduleGroupMembers.moduleGroupId), isNull(moduleGroups.recordedUntil)))
      .where(and(eq(moduleGroupMembers.tenantId, t), isNull(moduleGroupMembers.recordedUntil), eq(moduleGroups.programmeRuleSetId, input.programmeRuleSetId as Uuid), inArray(moduleGroupMembers.moduleId, moduleIds as Uuid[]))),
  ] as const);

  const messages: BalanceMessage[] = [];
  const bySubject = new Map<string, number>();
  let total = 0;
  for (const c of contributions) {
    const override = overrides.find((o) => o.moduleId === c.moduleId && o.code)?.code;
    const shares = override ? [{ subjectAreaCode: override, proportionPercent: 100 }] : subjects.filter((s) => s.moduleId === c.moduleId);
    if (shares.length === 0) {
      messages.push({ ruleTypeCode: 'joint-honours-balance', severity: 'warning', moduleId: c.moduleId, message: `${c.code} has no subject area, so it is not counted towards either subject` });
      if (rule.unassigned !== 'ignore') total += c.credit;
      continue;
    }
    total += c.credit;
    for (const s of shares) bySubject.set(s.subjectAreaCode, (bySubject.get(s.subjectAreaCode) ?? 0) + (c.credit * s.proportionPercent) / 100);
  }
  if (total === 0) return messages;

  for (const comp of rule.components) {
    const credit = bySubject.get(comp.subjectAreaCode) ?? 0;
    const share = (credit / total) * 100;
    const shown = `${Math.round(share * 10) / 10}% (${Math.round(credit * 10) / 10} of ${total} credits)`;
    if (comp.minPercent != null && share < comp.minPercent - tolerance) {
      messages.push({ ruleTypeCode: 'joint-honours-balance', severity: 'error', message: `${comp.subjectAreaCode} makes up ${shown}; at least ${comp.minPercent}% is required` });
    }
    if (comp.maxPercent != null && share > comp.maxPercent + tolerance) {
      messages.push({ ruleTypeCode: 'joint-honours-balance', severity: 'error', message: `${comp.subjectAreaCode} makes up ${shown}; at most ${comp.maxPercent}% is allowed` });
    }
  }
  return messages;
}
