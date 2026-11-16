import {
  academicPeriods,
  curriculumBindingChanges,
  moduleOfferings,
  moduleRegistrations,
  moduleSelectionProposals,
  programmeRuleSets,
  type CurriculumBindingChange,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, NotFoundError, ValidationError } from '@revelation-srs/domain';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { clockNow } from '../clock.js';
import type { EnrolmentService } from '../enrolment/service.js';
import type { ValueSetService } from '../value-sets/service.js';

import type { ModuleSelectionService } from './service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

/**
 * Changes to one student's curriculum binding (BP-03-002; D-11): proposed by
 * the registry, applied at once when nothing depends on the binding yet,
 * otherwise decided by a programme approver who did not propose it.
 */
export class BindingChangeService {
  constructor(
    private readonly db: Db,
    private readonly valueSets: ValueSetService,
    private readonly enrolments: EnrolmentService,
    private readonly moduleSelection: ModuleSelectionService,
  ) {}

  /**
   * Proposes a change to one student's route or rule set within their
   * programme (BP-03-002; D-11). A different programme or mode goes through a
   * transfer status case. If nothing depends on the binding yet (no current
   * module registration, live selection proposal or mark), the registry
   * applies it at once; otherwise a programme approver decides it.
   */
  async proposeBindingChange(tenantId: string, enrolmentId: string, input: {
    programmeRouteId?: string; programmeRuleSetId: string; changeReasonCode: string; reason: string; effectiveDate: string;
  }, actorId: string): Promise<{ change: CurriculumBindingChange; applied: boolean }> {
    if (!(await this.valueSets.validateFieldValue('enrolment_curriculum_binding', 'change_reason_code', input.changeReasonCode, tenantId))) {
      throw new ValidationError(`Invalid change reason '${input.changeReasonCode}'`);
    }
    const enrolment = await this.enrolments.getEnrolment(enrolmentId, tenantId);
    if (!enrolment) throw new NotFoundError('Enrolment', enrolmentId);
    const [ruleSet] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ programmeId: programmeRuleSets.programmeId })
      .from(programmeRuleSets).where(and(eq(programmeRuleSets.id, input.programmeRuleSetId as Uuid), eq(programmeRuleSets.tenantId, tenantId as Uuid))).limit(1));
    if (!ruleSet) throw new NotFoundError('ProgrammeRuleSet', input.programmeRuleSetId);
    if (ruleSet.programmeId !== enrolment.programmeId) {
      throw new ValidationError('That rule set belongs to another programme: a change of programme goes through a transfer status case');
    }

    const dependent = await this.#bindingHasDependents(tenantId, enrolmentId, input.effectiveDate);
    const [change] = await withTenantContext(this.db, tenantId, (tx) => tx.insert(curriculumBindingChanges).values({
      tenantId: tenantId as Uuid, enrolmentId: enrolmentId as Uuid, programmeRouteId: (input.programmeRouteId ?? null) as Uuid | null,
      programmeRuleSetId: input.programmeRuleSetId as Uuid, changeReasonCode: input.changeReasonCode, reason: input.reason,
      effectiveDate: input.effectiveDate, statusCode: dependent ? 'proposed' : 'applied-directly', proposedBy: actorId,
      ...(dependent ? {} : { decidedBy: actorId, decidedAt: clockNow() }),
    }).returning()).catch((error: unknown) => {
      if (isUniqueViolation(error)) throw new ConflictError('This enrolment already has a binding change awaiting a decision');
      throw error;
    });
    if (!dependent) {
      await this.moduleSelection.setCurriculumBinding(tenantId, enrolmentId, {
        programmeRouteId: input.programmeRouteId ?? null, programmeRuleSetId: input.programmeRuleSetId, decisionAuthorityCode: 'registry-administrator',
        decisionReason: input.reason, changeReasonCode: input.changeReasonCode, validFrom: new Date(`${input.effectiveDate}T00:00:00Z`),
      });
    }
    return { change: change!, applied: !dependent };
  }

  /** A programme approver decides a proposed binding change; never the person who proposed it (D-11). */
  async decideBindingChange(tenantId: string, changeId: string, input: { decisionCode: 'approved' | 'rejected'; reason: string }, actorId: string): Promise<CurriculumBindingChange> {
    const [change] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(curriculumBindingChanges)
      .where(and(eq(curriculumBindingChanges.id, changeId as Uuid), eq(curriculumBindingChanges.tenantId, tenantId as Uuid))).limit(1));
    if (!change) throw new NotFoundError('CurriculumBindingChange', changeId);
    if (change.statusCode !== 'proposed') throw new ConflictError(`This change is already ${change.statusCode}`);
    if (change.proposedBy === actorId) throw new ConflictError('The person who proposed this change cannot decide it');
    if (input.decisionCode === 'approved') {
      await this.moduleSelection.setCurriculumBinding(tenantId, change.enrolmentId, {
        programmeRouteId: change.programmeRouteId, programmeRuleSetId: change.programmeRuleSetId, decisionAuthorityCode: 'academic-approver',
        decisionReason: change.reason, changeReasonCode: change.changeReasonCode, validFrom: new Date(`${change.effectiveDate}T00:00:00Z`),
      });
    }
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.update(curriculumBindingChanges).set({
      statusCode: input.decisionCode, decidedBy: actorId, decidedAt: clockNow(), decisionReason: input.reason,
    }).where(eq(curriculumBindingChanges.id, change.id)).returning());
    return row!;
  }

  async listBindingChanges(tenantId: string, filter: { enrolmentId?: string; pendingOnly?: boolean }): Promise<CurriculumBindingChange[]> {
    return withTenantContext(this.db, tenantId, (tx) => tx.select().from(curriculumBindingChanges).where(and(
      eq(curriculumBindingChanges.tenantId, tenantId as Uuid),
      ...(filter.enrolmentId ? [eq(curriculumBindingChanges.enrolmentId, filter.enrolmentId as Uuid)] : []),
      ...(filter.pendingOnly ? [eq(curriculumBindingChanges.statusCode, 'proposed')] : []),
    )).orderBy(curriculumBindingChanges.proposedAt));
  }

  /** Whether module registrations, a live selection proposal or marks already rest on the enrolment's binding. */
  async #bindingHasDependents(tenantId: string, enrolmentId: string, effectiveDate: string): Promise<boolean> {
    return withTenantContext(this.db, tenantId, async (tx) => {
      const registrations = await tx.select({ id: moduleRegistrations.id }).from(moduleRegistrations)
        .innerJoin(moduleOfferings, eq(moduleOfferings.id, moduleRegistrations.moduleOfferingId))
        .innerJoin(academicPeriods, eq(academicPeriods.id, moduleOfferings.academicPeriodId))
        .where(and(
          eq(moduleRegistrations.tenantId, tenantId as Uuid), eq(moduleRegistrations.enrolmentId, enrolmentId as Uuid),
          isNull(moduleRegistrations.recordedUntil), sql`${academicPeriods.endDate} >= ${effectiveDate}`,
        ));
      if (registrations.length > 0) return true;
      const [proposal] = await tx.select({ id: moduleSelectionProposals.id }).from(moduleSelectionProposals).where(and(
        eq(moduleSelectionProposals.tenantId, tenantId as Uuid), eq(moduleSelectionProposals.enrolmentId, enrolmentId as Uuid),
        inArray(moduleSelectionProposals.statusCode, ['submitted', 'validated', 'waitlisted', 'approved', 'confirmed']),
      )).limit(1);
      return Boolean(proposal);
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current && typeof current === 'object') {
    if ((current as { code?: string }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
