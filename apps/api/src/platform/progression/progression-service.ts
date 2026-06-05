import { randomUUID } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';
import {
  academicPeriods,
  enrolments,
  moduleOfferings,
  moduleRegistrations,
  moduleResults,
  modules,
  progressionDecisions,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { EVENT_TYPES, NotFoundError, RuleNotConfiguredError } from '@revelation-srs/domain';
import type { ProgressionDecidedV1Payload } from '@revelation-srs/domain';

import { assertNotLocked } from '../assessment/lock.js';
import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';
import type { RulesEngine } from '../rules-engine/engine.js';

export interface EvaluateProgressionInput {
  academicYear: string;
}

export interface ProgressionDecisionDto {
  progressionDecisionId: string;
  enrolmentId: string;
  academicYear: string;
  yearOfStudy: string;
  decisionCode: string;
  examBoardId: string | null;
  locked: boolean;
  actorId: string;
  validFrom: Date;
  validTo: Date | null;
  recordedAt: Date;
  recordedUntil: Date | null;
}

interface EnrolmentContext {
  enrolmentId: string;
  personId: string;
  programmeId: string | null;
  academicYearOfEntry: string;
}

interface ModuleOutcome {
  moduleRegistrationId: string;
  aggregateMark: number;
  resultCode: string;
  creditValue: number;
}

interface ProgressionRules {
  requiredCredits: number;
  compensationThreshold: number | null;
  compensationCreditLimit: number;
  condonementThreshold: number | null;
}

export class ProgressionService {
  constructor(
    private readonly db: Db,
    private readonly eventBus: IntegrationBusPublisher,
    private readonly rules: RulesEngine,
  ) {}

  async evaluateProgression(
    enrolmentId: string,
    tenantId: string,
    academicYear: string,
    actorId: string,
  ): Promise<string> {
    const enrolment = await this.#getEnrolment(enrolmentId, tenantId);
    const outcomes = await this.#getModuleOutcomes(enrolmentId, tenantId, academicYear);
    const rules = await this.#getProgressionRules(tenantId, enrolment.programmeId, academicYear, outcomes);
    const decisionCode = this.#decide(outcomes, rules);
    const current = await this.#getCurrentDecision(enrolmentId, tenantId, academicYear);
    if (current) assertNotLocked(current, 'ProgressionDecision', current.progressionDecisionId);

    const now = new Date();
    const progressionDecisionId = current?.progressionDecisionId ?? randomUUID();
    const yearOfStudy = inferYearOfStudy(enrolment.academicYearOfEntry, academicYear);

    await withTenantContext(this.db, tenantId, async (tx) => {
      if (current) {
        await tx.update(progressionDecisions)
          .set({ validTo: now, recordedUntil: now })
          .where(and(
            eq(progressionDecisions.id, progressionDecisionId as `${string}-${string}-${string}-${string}-${string}`),
            eq(progressionDecisions.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(progressionDecisions.recordedUntil),
          ));
      }

      await tx.insert(progressionDecisions).values({
        versionId: randomUUID(),
        id: progressionDecisionId as `${string}-${string}-${string}-${string}-${string}`,
        tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`,
        enrolmentId: enrolmentId as `${string}-${string}-${string}-${string}-${string}`,
        academicYear,
        yearOfStudy,
        decisionCode,
        examBoardId: current?.examBoardId as `${string}-${string}-${string}-${string}-${string}` | null | undefined ?? null,
        locked: current?.locked ?? false,
        actorId,
        validFrom: now,
        validTo: null,
        recordedAt: now,
        recordedUntil: null,
      });
    });

    if (this.eventBus.isConnected()) {
      const payload: ProgressionDecidedV1Payload = {
        progressionDecisionId,
        enrolmentId,
        personId: enrolment.personId,
        academicYear,
        yearOfStudy,
        decisionCode,
        ...(current?.examBoardId ? { examBoardId: current.examBoardId } : {}),
      };
      await this.eventBus.publish(
        EVENT_TYPES.PROGRESSION_DECIDED,
        '1.0.0',
        tenantId,
        actorId,
        'personal',
        payload,
      );
    }

    return progressionDecisionId;
  }

  /**
   * Bypasses assertNotLocked to apply an authorised post-ratification amendment.
   * Only callable from CorrectionService.applyAmendment — not exposed via any route.
   * Returns the before-value snapshot for the amendment ledger.
   */
  async applyLockedAmendment(
    progressionDecisionId: string,
    tenantId: string,
    patch: { decisionCode?: string },
    actorId: string,
  ): Promise<ProgressionDecisionDto> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(progressionDecisions).where(and(
        eq(progressionDecisions.id,       progressionDecisionId as `${string}-${string}-${string}-${string}-${string}`),
        eq(progressionDecisions.tenantId, tenantId              as `${string}-${string}-${string}-${string}-${string}`),
        isNull(progressionDecisions.recordedUntil),
      )).limit(1),
    );
    const current = rows[0] ? decisionToDto(rows[0]) : null;
    if (!current) throw new NotFoundError('ProgressionDecision', progressionDecisionId);

    const now         = new Date();
    const decisionCode = patch.decisionCode ?? current.decisionCode;

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.update(progressionDecisions)
        .set({ recordedUntil: now, validTo: now })
        .where(and(
          eq(progressionDecisions.id,       progressionDecisionId as `${string}-${string}-${string}-${string}-${string}`),
          eq(progressionDecisions.tenantId, tenantId              as `${string}-${string}-${string}-${string}-${string}`),
          isNull(progressionDecisions.recordedUntil),
        ));

      await tx.insert(progressionDecisions).values({
        versionId:    randomUUID(),
        id:           progressionDecisionId as `${string}-${string}-${string}-${string}-${string}`,
        tenantId:     tenantId as `${string}-${string}-${string}-${string}-${string}`,
        enrolmentId:  current.enrolmentId as `${string}-${string}-${string}-${string}-${string}`,
        academicYear: current.academicYear,
        yearOfStudy:  current.yearOfStudy,
        decisionCode,
        examBoardId:  current.examBoardId as `${string}-${string}-${string}-${string}-${string}` | null | undefined ?? null,
        locked:       true,
        actorId,
        validFrom:    now,
        validTo:      null,
        recordedAt:   now,
        recordedUntil: null,
      });
    });

    return current;
  }

  async getProgressionDecision(enrolmentId: string, tenantId: string, academicYear: string): Promise<ProgressionDecisionDto> {
    await this.#getEnrolment(enrolmentId, tenantId);
    const current = await this.#getCurrentDecision(enrolmentId, tenantId, academicYear);
    if (!current) throw new NotFoundError('ProgressionDecision', `${enrolmentId}:${academicYear}`);
    return current;
  }

  async getProgressionHistory(enrolmentId: string, tenantId: string): Promise<ProgressionDecisionDto[]> {
    await this.#getEnrolment(enrolmentId, tenantId);
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(progressionDecisions).where(and(
        eq(progressionDecisions.enrolmentId, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
        eq(progressionDecisions.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
      )).orderBy(progressionDecisions.academicYear, progressionDecisions.recordedAt),
    );
    return rows.map(decisionToDto);
  }

  async #getEnrolment(enrolmentId: string, tenantId: string): Promise<EnrolmentContext> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({
        enrolmentId: enrolments.id,
        personId: enrolments.personId,
        programmeId: enrolments.programmeId,
        academicYearOfEntry: enrolments.academicYearOfEntry,
      }).from(enrolments).where(and(
        eq(enrolments.id, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
        eq(enrolments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
        isNull(enrolments.recordedUntil),
      )).limit(1),
    );
    if (!rows[0]) throw new NotFoundError('Enrolment', enrolmentId);
    return rows[0];
  }

  async #getModuleOutcomes(enrolmentId: string, tenantId: string, academicYear: string): Promise<ModuleOutcome[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({
        moduleRegistrationId: moduleRegistrations.id,
        aggregateMark: moduleResults.aggregateMark,
        resultCode: moduleResults.resultCode,
        creditValue: modules.creditValue,
      })
        .from(moduleResults)
        .innerJoin(moduleRegistrations, eq(moduleResults.moduleRegistrationId, moduleRegistrations.id))
        .innerJoin(moduleOfferings, eq(moduleRegistrations.moduleOfferingId, moduleOfferings.id))
        .innerJoin(academicPeriods, eq(moduleOfferings.academicPeriodId, academicPeriods.id))
        .innerJoin(modules, eq(moduleOfferings.moduleId, modules.id))
        .where(and(
          eq(moduleResults.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(moduleRegistrations.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(moduleRegistrations.enrolmentId, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
          eq(moduleOfferings.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(academicPeriods.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(modules.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(academicPeriods.academicYear, academicYear),
          isNull(moduleResults.recordedUntil),
          isNull(moduleRegistrations.recordedUntil),
          isNull(modules.recordedUntil),
        )),
    );
    return rows.map((row) => ({
      moduleRegistrationId: row.moduleRegistrationId,
      aggregateMark: Number(row.aggregateMark),
      resultCode: row.resultCode,
      creditValue: row.creditValue ?? 0,
    }));
  }

  async #getCurrentDecision(enrolmentId: string, tenantId: string, academicYear: string): Promise<ProgressionDecisionDto | null> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(progressionDecisions).where(and(
        eq(progressionDecisions.enrolmentId, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
        eq(progressionDecisions.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
        eq(progressionDecisions.academicYear, academicYear),
        isNull(progressionDecisions.recordedUntil),
      )).limit(1),
    );
    return rows[0] ? decisionToDto(rows[0]) : null;
  }

  async #getProgressionRules(
    tenantId: string,
    programmeId: string | null,
    academicYear: string,
    outcomes: ModuleOutcome[],
  ): Promise<ProgressionRules> {
    const ctx = { tenantId, programmeId: programmeId ?? '', asOfDate: academicYearEndDate(academicYear) };
    const totalCredits = outcomes.reduce((sum, outcome) => sum + outcome.creditValue, 0);
    return {
      requiredCredits: await this.#getNumericRule(ctx, 'progression-credit-requirement', 'default', ['requiredCredits', 'credits', 'minimumCredits'], totalCredits),
      compensationThreshold: await this.#getOptionalNumericRule(ctx, 'compensation-threshold', 'default', ['minimumMark', 'threshold', 'mark']),
      compensationCreditLimit: await this.#getNumericRule(ctx, 'compensation-credit-limit', 'default', ['maxCredits', 'creditLimit', 'credits'], 0),
      condonementThreshold: await this.#getOptionalNumericRule(ctx, 'condonement-threshold', 'default', ['minimumMark', 'threshold', 'mark']),
    };
  }

  async #getNumericRule(
    ctx: { tenantId: string; programmeId: string; asOfDate: Date },
    ruleType: Parameters<RulesEngine['getRule']>[1],
    ruleKey: string,
    fields: string[],
    fallback: number,
  ): Promise<number> {
    try {
      const rule = await this.rules.getRule<Record<string, unknown>>(ctx, ruleType, ruleKey);
      return numberFromRule(rule, fields, fallback);
    } catch (err) {
      if (err instanceof RuleNotConfiguredError) return fallback;
      throw err;
    }
  }

  async #getOptionalNumericRule(
    ctx: { tenantId: string; programmeId: string; asOfDate: Date },
    ruleType: Parameters<RulesEngine['getRule']>[1],
    ruleKey: string,
    fields: string[],
  ): Promise<number | null> {
    try {
      const rule = await this.rules.getRule<Record<string, unknown>>(ctx, ruleType, ruleKey);
      return numberFromRule(rule, fields, 0);
    } catch (err) {
      if (err instanceof RuleNotConfiguredError) return null;
      throw err;
    }
  }

  #decide(outcomes: ModuleOutcome[], rules: ProgressionRules): string {
    let earnedCredits = 0;
    let compensationCredits = 0;
    let unresolvedCredits = 0;

    for (const outcome of outcomes) {
      if (['pass', 'compensated', 'condoned'].includes(outcome.resultCode)) {
        earnedCredits += outcome.creditValue;
        continue;
      }

      if (
        rules.compensationThreshold !== null
        && outcome.aggregateMark >= rules.compensationThreshold
        && compensationCredits + outcome.creditValue <= rules.compensationCreditLimit
      ) {
        earnedCredits += outcome.creditValue;
        compensationCredits += outcome.creditValue;
        continue;
      }

      if (rules.condonementThreshold !== null && outcome.aggregateMark >= rules.condonementThreshold) {
        earnedCredits += outcome.creditValue;
        continue;
      }

      unresolvedCredits += outcome.creditValue;
    }

    if (earnedCredits >= rules.requiredCredits) return 'progress';
    if (unresolvedCredits > 0 || outcomes.length > 0) return 'resit';
    return 'repeat-year';
  }
}

function decisionToDto(row: typeof progressionDecisions.$inferSelect): ProgressionDecisionDto {
  return {
    progressionDecisionId: row.id,
    enrolmentId: row.enrolmentId,
    academicYear: row.academicYear,
    yearOfStudy: row.yearOfStudy,
    decisionCode: row.decisionCode,
    examBoardId: row.examBoardId,
    locked: row.locked,
    actorId: row.actorId,
    validFrom: row.validFrom,
    validTo: row.validTo,
    recordedAt: row.recordedAt,
    recordedUntil: row.recordedUntil,
  };
}

function numberFromRule(rule: Record<string, unknown>, fields: string[], fallback: number): number {
  for (const field of fields) {
    const value = Number(rule[field]);
    if (Number.isFinite(value)) return value;
  }
  return fallback;
}

function inferYearOfStudy(entryAcademicYear: string, academicYear: string): string {
  const entryStart = Number(entryAcademicYear.slice(0, 4));
  const targetStart = Number(academicYear.slice(0, 4));
  if (!Number.isFinite(entryStart) || !Number.isFinite(targetStart)) return '1';
  return String(Math.max(1, targetStart - entryStart + 1));
}

function academicYearEndDate(academicYear: string): Date {
  const endYearSuffix = Number(academicYear.slice(5, 7));
  const startYear = Number(academicYear.slice(0, 4));
  const century = Math.floor(startYear / 100) * 100;
  const endYear = Number.isFinite(endYearSuffix) ? century + endYearSuffix : startYear + 1;
  return new Date(Date.UTC(endYear, 6, 31, 23, 59, 59));
}
