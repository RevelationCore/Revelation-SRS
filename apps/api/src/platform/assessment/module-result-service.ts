import { randomUUID } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';
import {
  assessmentComponents,
  enrolments,
  marks,
  moduleRegistrations,
  moduleResults,
  reassessmentPlans,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import {
  EVENT_TYPES,
  NotFoundError,
  RuleNotConfiguredError,
} from '@revelation-srs/domain';
import type { AssessmentModuleResultCalculatedV1Payload } from '@revelation-srs/domain';

import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';
import { RuleTrace, type RuleVersionCitation, type RulesEngine } from '../rules-engine/engine.js';
import { clockNow } from '../clock.js';

import { assertNotLocked } from './lock.js';

export interface ModuleResultDto {
  moduleResultId: string;
  moduleRegistrationId: string;
  aggregateMark: number;
  resultCode: string;
  locked: boolean;
  calculatedAt: Date;
  /** The rules this result used (D-35); empty for results calculated before that was recorded. */
  ruleVersions: RuleVersionCitation[];
  validFrom: Date;
  validTo: Date | null;
  recordedAt: Date;
  recordedUntil: Date | null;
}

interface RegistrationContext {
  moduleRegistrationId: string;
  moduleOfferingId: string;
  programmeId: string | null;
}

interface ComponentMark {
  assessmentComponentId: string;
  weighting: number;
  passMarkOverride: number | null;
  adjustedMark: number | null;
}

export class ModuleResultService {
  constructor(
    private readonly db: Db,
    private readonly eventBus: IntegrationBusPublisher,
    private readonly rules: RulesEngine,
  ) {}

  async recalculate(moduleRegistrationId: string, tenantId: string): Promise<string | null> {
    const registration = await this.#getRegistrationContext(moduleRegistrationId, tenantId);
    const components = await this.#getComponentMarks(registration.moduleOfferingId, moduleRegistrationId, tenantId);

    if (components.every((component) => component.adjustedMark === null)) {
      return null;
    }

    const current = await this.#getCurrentResult(moduleRegistrationId, tenantId);
    if (current) assertNotLocked(current, 'ModuleResult', current.moduleResultId);

    const trace = new RuleTrace();
    const uncapped = roundMark(
      components.reduce(
        (total, component) => total + ((component.adjustedMark ?? 0) * component.weighting) / 100,
        0,
      ),
    );
    // A repeat registration's result is capped by its reassessment plan (D-43b).
    const plan = await this.#reassessmentCap(tenantId, moduleRegistrationId);
    let aggregateMark = uncapped;
    if (plan) {
      trace.cite({
        ruleTypeCode: 'resit-mark-cap', ruleKey: null, ruleId: null, versionId: null, programmeId: null, validFrom: null,
        source: 'reassessment-plan', planId: plan.id, value: { cap: plan.markCap, uncappedMark: uncapped },
      });
      aggregateMark = Math.min(uncapped, plan.markCap);
    }
    const resultCode = await this.#deriveResultCode(tenantId, registration, components, aggregateMark, trace);
    const moduleResultId = current?.moduleResultId ?? randomUUID();
    const now = clockNow();

    await withTenantContext(this.db, tenantId, async (tx) => {
      if (current) {
        await tx
          .update(moduleResults)
          .set({ recordedUntil: now, validTo: now })
          .where(
            and(
              eq(moduleResults.id, moduleResultId as `${string}-${string}-${string}-${string}-${string}`),
              eq(moduleResults.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
              isNull(moduleResults.recordedUntil),
            ),
          );
      }

      await tx.insert(moduleResults).values({
        versionId: randomUUID(),
        id: moduleResultId as `${string}-${string}-${string}-${string}-${string}`,
        tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`,
        moduleRegistrationId: moduleRegistrationId as `${string}-${string}-${string}-${string}-${string}`,
        aggregateMark: aggregateMark.toFixed(2),
        resultCode,
        locked: current?.locked ?? false,
        calculatedAt: now,
        ruleVersions: trace.entries,
        validFrom: now,
        validTo: null,
        recordedAt: now,
        recordedUntil: null,
      });
    });

    if (this.eventBus.isConnected()) {
      const payload: AssessmentModuleResultCalculatedV1Payload = {
        moduleResultId,
        moduleRegistrationId,
        aggregateMark,
        resultCode,
      };
      await this.eventBus.publish(
        EVENT_TYPES.ASSESSMENT_MODULE_RESULT_CALCULATED,
        '1.0.0',
        tenantId,
        moduleResultId,
        'personal',
        payload,
      );
    }

    return moduleResultId;
  }

  /**
   * Bypasses assertNotLocked to apply an authorised post-ratification amendment.
   * Only callable from CorrectionService.applyAmendment — not exposed via any route.
   * Returns the before-value snapshot for the amendment ledger.
   */
  async applyLockedAmendment(
    moduleResultId: string,
    tenantId: string,
    patch: { aggregateMark?: number; resultCode?: string },
    _actorId: string,
  ): Promise<ModuleResultDto> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(moduleResults).where(and(
        eq(moduleResults.id,       moduleResultId as `${string}-${string}-${string}-${string}-${string}`),
        eq(moduleResults.tenantId, tenantId       as `${string}-${string}-${string}-${string}-${string}`),
        isNull(moduleResults.recordedUntil),
      )).limit(1),
    );
    const current = rows[0] ? moduleResultToDto(rows[0]) : null;
    if (!current) throw new NotFoundError('ModuleResult', moduleResultId);

    const now = clockNow();
    const aggregateMark = patch.aggregateMark ?? current.aggregateMark;
    const resultCode    = patch.resultCode    ?? current.resultCode;

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.update(moduleResults)
        .set({ recordedUntil: now, validTo: now })
        .where(and(
          eq(moduleResults.id,       moduleResultId as `${string}-${string}-${string}-${string}-${string}`),
          eq(moduleResults.tenantId, tenantId       as `${string}-${string}-${string}-${string}-${string}`),
          isNull(moduleResults.recordedUntil),
        ));

      await tx.insert(moduleResults).values({
        versionId:            randomUUID(),
        id:                   moduleResultId as `${string}-${string}-${string}-${string}-${string}`,
        tenantId:             tenantId as `${string}-${string}-${string}-${string}-${string}`,
        moduleRegistrationId: current.moduleRegistrationId as `${string}-${string}-${string}-${string}-${string}`,
        aggregateMark:        aggregateMark.toFixed(2),
        resultCode,
        locked:               true,
        calculatedAt:         now,
        validFrom:            now,
        validTo:              null,
        recordedAt:           now,
        recordedUntil:        null,
      });
    });

    return current;
  }

  async getResult(moduleRegistrationId: string, tenantId: string): Promise<ModuleResultDto> {
    await this.#getRegistrationContext(moduleRegistrationId, tenantId);
    const current = await this.#getCurrentResult(moduleRegistrationId, tenantId);
    if (!current) throw new NotFoundError('ModuleResult', moduleRegistrationId);
    return current;
  }

  async getResultHistory(moduleRegistrationId: string, tenantId: string): Promise<ModuleResultDto[]> {
    await this.#getRegistrationContext(moduleRegistrationId, tenantId);
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(moduleResults)
        .where(
          and(
            eq(moduleResults.moduleRegistrationId, moduleRegistrationId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleResults.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        )
        .orderBy(moduleResults.recordedAt),
    );

    return rows.map(moduleResultToDto);
  }

  async #getRegistrationContext(
    moduleRegistrationId: string,
    tenantId: string,
  ): Promise<RegistrationContext> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({
          moduleRegistrationId: moduleRegistrations.id,
          moduleOfferingId: moduleRegistrations.moduleOfferingId,
          programmeId: enrolments.programmeId,
        })
        .from(moduleRegistrations)
        .innerJoin(enrolments, eq(moduleRegistrations.enrolmentId, enrolments.id))
        .where(
          and(
            eq(moduleRegistrations.id, moduleRegistrationId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleRegistrations.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            eq(enrolments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(moduleRegistrations.recordedUntil),
            isNull(enrolments.recordedUntil),
          ),
        )
        .limit(1),
    );

    const row = rows[0];
    if (!row) throw new NotFoundError('ModuleRegistration', moduleRegistrationId);
    return row;
  }

  async #getComponentMarks(
    moduleOfferingId: string,
    moduleRegistrationId: string,
    tenantId: string,
  ): Promise<ComponentMark[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({
          assessmentComponentId: assessmentComponents.id,
          weighting: assessmentComponents.weighting,
          passMarkOverride: assessmentComponents.passMarkOverride,
          adjustedMark: marks.adjustedMark,
          attemptNumber: marks.attemptNumber,
        })
        .from(assessmentComponents)
        .leftJoin(
          marks,
          and(
            eq(marks.assessmentComponentId, assessmentComponents.id),
            eq(marks.moduleRegistrationId, moduleRegistrationId as `${string}-${string}-${string}-${string}-${string}`),
            eq(marks.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(marks.recordedUntil),
          ),
        )
        .where(
          and(
            eq(assessmentComponents.moduleOfferingId, moduleOfferingId as `${string}-${string}-${string}-${string}-${string}`),
            eq(assessmentComponents.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        ),
    );

    const bestByComponent = new Map<string, ComponentMark & { attemptNumber: number }>();
    for (const row of rows) {
      const candidate = {
        assessmentComponentId: row.assessmentComponentId,
        weighting: row.weighting,
        passMarkOverride: row.passMarkOverride === null ? null : Number(row.passMarkOverride),
        adjustedMark: row.adjustedMark === null ? null : Number(row.adjustedMark),
        attemptNumber: row.attemptNumber ?? 0,
      };
      const current = bestByComponent.get(candidate.assessmentComponentId);
      if (!current || candidate.attemptNumber >= current.attemptNumber) {
        bestByComponent.set(candidate.assessmentComponentId, candidate);
      }
    }

    return [...bestByComponent.values()].map(({ attemptNumber: _attemptNumber, ...component }) => component);
  }

  async #getCurrentResult(moduleRegistrationId: string, tenantId: string): Promise<ModuleResultDto | null> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(moduleResults)
        .where(
          and(
            eq(moduleResults.moduleRegistrationId, moduleRegistrationId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleResults.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(moduleResults.recordedUntil),
          ),
        )
        .limit(1),
    );

    return rows[0] ? moduleResultToDto(rows[0]) : null;
  }

  async #deriveResultCode(
    tenantId: string,
    registration: RegistrationContext,
    components: ComponentMark[],
    aggregateMark: number,
    trace: RuleTrace,
  ): Promise<string> {
    if (components.some((component) => component.adjustedMark === null)) {
      return 'deferred';
    }

    const defaultPassMark = await this.#getDefaultPassMark(tenantId, registration.programmeId, trace);
    for (const component of components) {
      if (component.passMarkOverride === null) continue;
      trace.cite({
        ruleTypeCode: 'pass-mark', ruleKey: null, ruleId: null, versionId: null, programmeId: null, validFrom: null,
        source: 'component-override', componentId: component.assessmentComponentId, value: { mark: component.passMarkOverride },
      });
    }
    const componentFailed = components.some((component) =>
      component.adjustedMark !== null
      && component.adjustedMark < (component.passMarkOverride ?? defaultPassMark),
    );

    if (componentFailed) return 'fail';
    return aggregateMark >= defaultPassMark ? 'pass' : 'fail';
  }

  async #getDefaultPassMark(tenantId: string, programmeId: string | null, trace: RuleTrace): Promise<number> {
    const ctx = { tenantId, programmeId: programmeId ?? '' };
    try {
      return await this.rules.getPassMark(ctx, trace);
    } catch (err) {
      if (!(err instanceof RuleNotConfiguredError)) throw err;
      return (await this.rules.builtInDefault(ctx, 'pass-mark', 'undergraduate-default', { mark: 40 }, trace)).mark;
    }
  }

  /** The cap of an open reassessment plan this registration repeats, if it has one. */
  async #reassessmentCap(tenantId: string, moduleRegistrationId: string): Promise<{ id: string; markCap: number } | null> {
    const [plan] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ id: reassessmentPlans.id, markCap: reassessmentPlans.markCap })
      .from(reassessmentPlans)
      .where(and(
        eq(reassessmentPlans.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
        eq(reassessmentPlans.repeatModuleRegistrationId, moduleRegistrationId as `${string}-${string}-${string}-${string}-${string}`),
      ))
      .limit(1));
    return plan && plan.markCap !== null ? { id: plan.id, markCap: plan.markCap } : null;
  }

  /** How a result was calculated (D-35): the version's rule citations and the marks it aggregated. */
  async getEvidence(tenantId: string, moduleResultId: string): Promise<ModuleResultDto & { versionId: string }> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(moduleResults).where(and(
      eq(moduleResults.id, moduleResultId as `${string}-${string}-${string}-${string}-${string}`),
      eq(moduleResults.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
      isNull(moduleResults.recordedUntil),
    )).limit(1));
    if (!row) throw new NotFoundError('ModuleResult', moduleResultId);
    return { ...moduleResultToDto(row), versionId: row.versionId };
  }
}

function moduleResultToDto(row: typeof moduleResults.$inferSelect): ModuleResultDto {
  return {
    moduleResultId: row.id,
    moduleRegistrationId: row.moduleRegistrationId,
    aggregateMark: Number(row.aggregateMark),
    resultCode: row.resultCode,
    locked: row.locked,
    calculatedAt: row.calculatedAt,
    ruleVersions: (row.ruleVersions ?? []) as RuleVersionCitation[],
    validFrom: row.validFrom,
    validTo: row.validTo,
    recordedAt: row.recordedAt,
    recordedUntil: row.recordedUntil,
  };
}

function roundMark(value: number): number {
  return Math.round(value * 100) / 100;
}
