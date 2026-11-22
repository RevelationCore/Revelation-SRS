import { randomUUID } from 'node:crypto';

import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import {
  assessmentComponents,
  assessmentSubmissions,
  enrolments,
  marks,
  moduleRegistrations,
  reasonableAdjustments,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import {
  EVENT_TYPES,
  ForbiddenError,
  NotFoundError,
  RecordLockedError,
  RuleNotConfiguredError,
  ValidationError,
} from '@revelation-srs/domain';
import type {
  AssessmentMarkReceivedV1Payload,
  AssessmentMarkUpdatedV1Payload,
} from '@revelation-srs/domain';

import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';
import type { FeatureFlagService } from '../platform-controls/feature-flag-service.js';
import { RuleTrace, type RulesEngine } from '../rules-engine/engine.js';
import { clockNow } from '../clock.js';

import { assertNotLocked } from './lock.js';
import type { ModuleResultService } from './module-result-service.js';

export interface IngestMarkInput {
  assessmentComponentId: string;
  rawMark: number;
  attemptNumber?: number;
  sourceSystem?: string;
  sourceReference?: string;
  submittedAt?: string;
  dueAt?: string;
  rawPayload?: Record<string, unknown>;
}

export interface UpdateMarkInput {
  rawMark?: number;
  reason?: string;
  submittedAt?: string;
  dueAt?: string;
}

export interface MarkDto {
  markId: string;
  moduleRegistrationId: string;
  assessmentComponentId: string;
  assessmentSubmissionId: string | null;
  attemptNumber: number;
  rawMark: number;
  adjustedMark: number;
  penaltyApplied: boolean;
  penaltyPercent: number | null;
  locked: boolean;
  sourceSystem: string | null;
  actorId: string;
  validFrom: Date;
  validTo: Date | null;
  recordedAt: Date;
  recordedUntil: Date | null;
}

interface RegistrationContext {
  moduleRegistrationId: string;
  moduleOfferingId: string;
  enrolmentId: string;
  personId: string;
  programmeId: string | null;
}

interface PenaltyResult {
  adjustedMark: number;
  penaltyApplied: boolean;
  penaltyPercent: number | null;
  latePenaltyCapApplied: boolean;
  latePenaltyCapPercent: number | null;
  resitCapApplied: boolean;
  resitCapMark: number | null;
  latePenaltyEnabled: boolean;
  /** The rules the penalty and cap used (D-35). */
  trace: RuleTrace;
}

export class MarkService {
  constructor(
    private readonly db: Db,
    private readonly eventBus: IntegrationBusPublisher,
    private readonly rules: RulesEngine,
    private readonly moduleResults?: ModuleResultService,
    private readonly featureFlags?: FeatureFlagService,
  ) {}

  /** The current mark recorded from a source submission, if any (ADR-032 idempotency). */
  async findMarkBySource(tenantId: string, moduleRegistrationId: string, sourceSystem: string, sourceReference: string): Promise<string | null> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx
      .select({ markId: marks.id })
      .from(marks)
      .innerJoin(assessmentSubmissions, and(
        eq(assessmentSubmissions.id, marks.assessmentSubmissionId),
        eq(assessmentSubmissions.tenantId, marks.tenantId),
      ))
      .where(and(
        eq(marks.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
        eq(marks.moduleRegistrationId, moduleRegistrationId as `${string}-${string}-${string}-${string}-${string}`),
        isNull(marks.recordedUntil),
        eq(assessmentSubmissions.sourceSystem, sourceSystem),
        eq(assessmentSubmissions.sourceReference, sourceReference),
      ))
      .limit(1));
    return rows[0]?.markId ?? null;
  }

  async ingestMark(
    tenantId: string,
    moduleRegistrationId: string,
    input: IngestMarkInput,
    actorId: string,
  ): Promise<string> {
    this.#validateMarkInput(input.rawMark, input.attemptNumber);
    const registration = await this.#getRegistrationContext(moduleRegistrationId, tenantId);
    await this.#ensureComponentBelongsToOffering(input.assessmentComponentId, registration.moduleOfferingId, tenantId);

    const penalty = await this.#applyLatePenalty(tenantId, registration, input.rawMark, input.attemptNumber ?? 1, input);
    const markId = randomUUID();
    const now = clockNow();
    let assessmentSubmissionId: string | null = null;

    await withTenantContext(this.db, tenantId, async (tx) => {
      // BL-269 (pre-review BP-05 F7): a ratified registration takes no new mark;
      // a late mark goes through a correction case. Checked under a row lock on
      // the current result, so ratification and this insert cannot interleave.
      const lockedResult = await tx.execute(sql`
        SELECT id FROM module_result
        WHERE tenant_id = ${tenantId}::uuid AND module_registration_id = ${moduleRegistrationId}::uuid
          AND recorded_until IS NULL AND locked
        FOR UPDATE`) as unknown as unknown[];
      const lockedMark = await tx.execute(sql`
        SELECT id FROM mark
        WHERE tenant_id = ${tenantId}::uuid AND module_registration_id = ${moduleRegistrationId}::uuid
          AND recorded_until IS NULL AND locked
        LIMIT 1`) as unknown as unknown[];
      if (lockedResult.length > 0 || lockedMark.length > 0) {
        throw new RecordLockedError('ModuleRegistration', moduleRegistrationId);
      }
      if (input.sourceSystem) {
        assessmentSubmissionId = randomUUID();
        await tx.insert(assessmentSubmissions).values({
          id: assessmentSubmissionId,
          tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`,
          assessmentComponentId: input.assessmentComponentId as `${string}-${string}-${string}-${string}-${string}`,
          moduleRegistrationId: moduleRegistrationId as `${string}-${string}-${string}-${string}-${string}`,
          sourceSystem: input.sourceSystem,
          sourceReference: input.sourceReference ?? null,
          submittedAt: input.submittedAt ? new Date(input.submittedAt) : now,
          supersededAt: null,
          rawPayload: input.rawPayload ?? null,
        });
      }

      await tx.insert(marks).values({
        versionId: randomUUID(),
        id: markId,
        tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`,
        moduleRegistrationId: moduleRegistrationId as `${string}-${string}-${string}-${string}-${string}`,
        assessmentComponentId: input.assessmentComponentId as `${string}-${string}-${string}-${string}-${string}`,
        assessmentSubmissionId: assessmentSubmissionId as `${string}-${string}-${string}-${string}-${string}` | null,
        attemptNumber: input.attemptNumber ?? 1,
        rawMark: input.rawMark.toFixed(2),
        adjustedMark: penalty.adjustedMark.toFixed(2),
        penaltyApplied: penalty.penaltyApplied,
        penaltyPercent: penalty.penaltyPercent?.toFixed(2) ?? null,
        locked: false,
        sourceSystem: input.sourceSystem ?? null,
        actorId,
        ruleVersions: penalty.trace.entries,
        validFrom: now,
        validTo: null,
        recordedAt: now,
        recordedUntil: null,
      });
      await this.#writeMarkEvidence(tx, tenantId, markId, input.attemptNumber ?? 1, input.rawMark, penalty);
    });

    try {
      await this.moduleResults?.recalculate(moduleRegistrationId, tenantId);
    } catch (err) {
      // The result was locked after the mark was written (ratification in
      // between): take the mark back out rather than leave an unlocked mark
      // under a locked result (BL-269), and refuse as a locked record.
      await withTenantContext(this.db, tenantId, async (tx) => {
        await tx.execute(sql`DELETE FROM mark_calculation_evidence WHERE mark_id = ${markId}::uuid AND tenant_id = ${tenantId}::uuid`);
        await tx.execute(sql`DELETE FROM mark WHERE id = ${markId}::uuid AND tenant_id = ${tenantId}::uuid`);
        if (assessmentSubmissionId) await tx.execute(sql`DELETE FROM assessment_submission WHERE id = ${assessmentSubmissionId}::uuid AND tenant_id = ${tenantId}::uuid`);
      });
      if (err instanceof ForbiddenError) throw new RecordLockedError('ModuleRegistration', moduleRegistrationId);
      throw err;
    }

    if (this.eventBus.isConnected()) {
      const payload: AssessmentMarkReceivedV1Payload = {
        markId,
        moduleRegistrationId,
        assessmentComponentId: input.assessmentComponentId,
        ...(assessmentSubmissionId ? { assessmentSubmissionId } : {}),
        rawMark: input.rawMark,
        adjustedMark: penalty.adjustedMark,
        attemptNumber: input.attemptNumber ?? 1,
        penaltyApplied: penalty.penaltyApplied,
        ...(input.sourceSystem ? { sourceSystem: input.sourceSystem } : {}),
      };
      await this.eventBus.publish(
        EVENT_TYPES.ASSESSMENT_MARK_RECEIVED,
        '1.0.0',
        tenantId,
        actorId,
        'personal',
        payload,
      );
    }

    return markId;
  }

  async listMarks(moduleRegistrationId: string, tenantId: string): Promise<MarkDto[]> {
    await this.#getRegistrationContext(moduleRegistrationId, tenantId);

    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(marks)
        .where(
          and(
            eq(marks.moduleRegistrationId, moduleRegistrationId as `${string}-${string}-${string}-${string}-${string}`),
            eq(marks.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(marks.recordedUntil),
          ),
        )
        .orderBy(marks.assessmentComponentId, marks.attemptNumber),
    );

    return rows.map(markToDto);
  }

  async updateMark(
    markId: string,
    tenantId: string,
    input: UpdateMarkInput,
    actorId: string,
  ): Promise<void> {
    const current = await this.#getCurrentMark(markId, tenantId);
    if (!current) throw new NotFoundError('Mark', markId);
    assertNotLocked(current, 'Mark', markId);

    const rawMark = input.rawMark ?? current.rawMark;
    this.#validateMarkInput(rawMark, current.attemptNumber);
    const registration = await this.#getRegistrationContext(current.moduleRegistrationId, tenantId);
    const penalty = await this.#applyLatePenaltyForUpdate(tenantId, registration, current, rawMark, input);
    const now = clockNow();

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx
        .update(marks)
        .set({ recordedUntil: now, validTo: now })
        .where(
          and(
            eq(marks.id, markId as `${string}-${string}-${string}-${string}-${string}`),
            eq(marks.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(marks.recordedUntil),
          ),
        );

      await tx.insert(marks).values({
        versionId: randomUUID(),
        id: markId as `${string}-${string}-${string}-${string}-${string}`,
        tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`,
        moduleRegistrationId: current.moduleRegistrationId as `${string}-${string}-${string}-${string}-${string}`,
        assessmentComponentId: current.assessmentComponentId as `${string}-${string}-${string}-${string}-${string}`,
        assessmentSubmissionId: current.assessmentSubmissionId as `${string}-${string}-${string}-${string}-${string}` | null,
        attemptNumber: current.attemptNumber,
        rawMark: rawMark.toFixed(2),
        adjustedMark: penalty.adjustedMark.toFixed(2),
        penaltyApplied: penalty.penaltyApplied,
        penaltyPercent: penalty.penaltyPercent?.toFixed(2) ?? null,
        locked: current.locked,
        sourceSystem: current.sourceSystem,
        actorId,
        ruleVersions: penalty.trace.entries,
        validFrom: now,
        validTo: null,
        recordedAt: now,
        recordedUntil: null,
      });
    });

    await this.moduleResults?.recalculate(current.moduleRegistrationId, tenantId);

    if (this.eventBus.isConnected()) {
      const payload: AssessmentMarkUpdatedV1Payload = {
        markId,
        moduleRegistrationId: current.moduleRegistrationId,
        previousMark: current.rawMark,
        newMark: rawMark,
        ...(input.reason ? { reason: input.reason } : {}),
        actorId,
      };
      await this.eventBus.publish(
        EVENT_TYPES.ASSESSMENT_MARK_UPDATED,
        '1.0.0',
        tenantId,
        actorId,
        'personal',
        payload,
      );
    }
  }

  /**
   * Bypasses assertNotLocked to apply an authorised post-ratification amendment.
   * Only callable from CorrectionService.applyAmendment — not exposed via any route.
   * Returns the before-value snapshot for the amendment ledger.
   */
  async applyLockedAmendment(
    markId: string,
    tenantId: string,
    patch: { rawMark?: number; adjustedMark?: number; penaltyApplied?: boolean; penaltyPercent?: number | null },
    actorId: string,
  ): Promise<MarkDto> {
    const current = await this.#getCurrentMark(markId, tenantId);
    if (!current) throw new NotFoundError('Mark', markId);

    const now = clockNow();
    const rawMark      = patch.rawMark      ?? current.rawMark;
    const adjustedMark = patch.adjustedMark ?? current.adjustedMark;

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.update(marks)
        .set({ recordedUntil: now })
        .where(and(
          eq(marks.id,       markId    as `${string}-${string}-${string}-${string}-${string}`),
          eq(marks.tenantId, tenantId  as `${string}-${string}-${string}-${string}-${string}`),
          isNull(marks.recordedUntil),
        ));

      await tx.insert(marks).values({
        versionId:             randomUUID(),
        id:                    markId as `${string}-${string}-${string}-${string}-${string}`,
        tenantId:              tenantId as `${string}-${string}-${string}-${string}-${string}`,
        moduleRegistrationId:  current.moduleRegistrationId as `${string}-${string}-${string}-${string}-${string}`,
        assessmentComponentId: current.assessmentComponentId as `${string}-${string}-${string}-${string}-${string}`,
        assessmentSubmissionId: current.assessmentSubmissionId as `${string}-${string}-${string}-${string}-${string}` | null,
        attemptNumber:         current.attemptNumber,
        rawMark:               rawMark.toFixed(2),
        adjustedMark:          adjustedMark.toFixed(2),
        penaltyApplied:        patch.penaltyApplied  ?? current.penaltyApplied,
        penaltyPercent:        (patch.penaltyPercent !== undefined ? patch.penaltyPercent : current.penaltyPercent)?.toFixed(2) ?? null,
        locked:                true,  // re-lock after authorised amendment
        sourceSystem:          current.sourceSystem,
        actorId,
        validFrom:             current.validFrom,
        validTo:               current.validTo,
        recordedAt:            now,
        recordedUntil:         null,
      });
    });

    return current;
  }

  async getMarkHistory(markId: string, tenantId: string): Promise<MarkDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(marks)
        .where(
          and(
            eq(marks.id, markId as `${string}-${string}-${string}-${string}-${string}`),
            eq(marks.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        )
        .orderBy(marks.recordedAt),
    );

    return rows.map(markToDto);
  }

  async #getCurrentMark(markId: string, tenantId: string): Promise<MarkDto | null> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(marks)
        .where(
          and(
            eq(marks.id, markId as `${string}-${string}-${string}-${string}-${string}`),
            eq(marks.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(marks.recordedUntil),
          ),
        )
        .limit(1),
    );

    return rows[0] ? markToDto(rows[0]) : null;
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
          enrolmentId: moduleRegistrations.enrolmentId,
          personId: enrolments.personId,
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

  async #ensureComponentBelongsToOffering(
    assessmentComponentId: string,
    moduleOfferingId: string,
    tenantId: string,
  ): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({ id: assessmentComponents.id })
        .from(assessmentComponents)
        .where(
          and(
            eq(assessmentComponents.id, assessmentComponentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(assessmentComponents.moduleOfferingId, moduleOfferingId as `${string}-${string}-${string}-${string}-${string}`),
            eq(assessmentComponents.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        )
        .limit(1),
    );

    if (rows.length === 0) throw new NotFoundError('AssessmentComponent', assessmentComponentId);
  }

  #validateMarkInput(rawMark: number, attemptNumber = 1): void {
    if (rawMark < 0 || rawMark > 100) {
      throw new ValidationError(
        'Mark must be between 0 and 100',
        [{ field: 'rawMark', message: 'Mark must be between 0 and 100' }],
      );
    }
    if (attemptNumber < 1) {
      throw new ValidationError(
        'Attempt number must be at least 1',
        [{ field: 'attemptNumber', message: 'Attempt number must be at least 1' }],
      );
    }
  }

  async #applyLatePenalty(
    tenantId: string,
    registration: RegistrationContext,
    rawMark: number,
    attemptNumber: number,
    input: { submittedAt?: string; dueAt?: string },
  ): Promise<PenaltyResult> {
    const noPenalty: PenaltyResult = {
      adjustedMark: rawMark,
      penaltyApplied: false,
      penaltyPercent: null,
      latePenaltyCapApplied: false,
      latePenaltyCapPercent: null,
      resitCapApplied: false,
      resitCapMark: null,
      latePenaltyEnabled: true,
      trace: new RuleTrace(),
    };

    // Stage 3: honour assessment.late-penalty.enabled flag
    const latePenaltyEnabled = await this.#evaluateBooleanFlag(tenantId, 'assessment.late-penalty.enabled', true);
    if (!latePenaltyEnabled) {
      // Apply resit cap even when late penalty is disabled, if configured
      return this.#applyResitCap(tenantId, registration, rawMark, attemptNumber, {
        ...noPenalty, latePenaltyEnabled: false,
      });
    }

    if (!input.submittedAt || !input.dueAt) {
      return this.#applyResitCap(tenantId, registration, rawMark, attemptNumber, noPenalty);
    }

    const submittedAt = new Date(input.submittedAt);
    const dueAt = new Date(input.dueAt);
    if (submittedAt <= dueAt) {
      return this.#applyResitCap(tenantId, registration, rawMark, attemptNumber, noPenalty);
    }

    const suppressed = await this.#hasActiveDeadlineExtension(tenantId, registration, submittedAt);
    if (suppressed) {
      return this.#applyResitCap(tenantId, registration, rawMark, attemptNumber, noPenalty);
    }

    let percentPerDay: number;
    try {
      const rule = await this.rules.getRule<Record<string, unknown>>(
        { tenantId, programmeId: registration.programmeId ?? '' },
        'late-penalty-rate',
        'default',
        noPenalty.trace,
      );
      percentPerDay = Number(rule['percentPerDay'] ?? rule['rate'] ?? rule['percent'] ?? 0);
    } catch (err) {
      if (err instanceof RuleNotConfiguredError) {
        return this.#applyResitCap(tenantId, registration, rawMark, attemptNumber, noPenalty);
      }
      throw err;
    }

    if (!Number.isFinite(percentPerDay) || percentPerDay <= 0) {
      return this.#applyResitCap(tenantId, registration, rawMark, attemptNumber, noPenalty);
    }

    const daysLate = Math.max(1, Math.ceil((submittedAt.getTime() - dueAt.getTime()) / 86_400_000));
    let penaltyPercent = daysLate * percentPerDay;

    // Stage 3: honour late-penalty-cap rule
    let latePenaltyCapApplied = false;
    let latePenaltyCapPercent: number | null = null;
    try {
      const capRule = await this.rules.getRule<Record<string, unknown>>(
        { tenantId, programmeId: registration.programmeId ?? '' },
        'late-penalty-cap',
        'default',
        noPenalty.trace,
      );
      const cap = Number(capRule['maxPenaltyPercent'] ?? capRule['cap'] ?? 100);
      if (Number.isFinite(cap) && penaltyPercent > cap) {
        latePenaltyCapApplied = true;
        latePenaltyCapPercent = cap;
        penaltyPercent = cap;
      }
    } catch (err) {
      if (!(err instanceof RuleNotConfiguredError)) throw err;
      // no cap configured — no cap applied
    }

    const adjustedAfterPenalty = Math.max(0, roundMark(rawMark - penaltyPercent));
    const afterPenalty: PenaltyResult = {
      adjustedMark: adjustedAfterPenalty,
      penaltyApplied: true,
      penaltyPercent,
      latePenaltyCapApplied,
      latePenaltyCapPercent,
      resitCapApplied: false,
      resitCapMark: null,
      latePenaltyEnabled: true,
      trace: noPenalty.trace,
    };

    return this.#applyResitCap(tenantId, registration, adjustedAfterPenalty, attemptNumber, afterPenalty);
  }

  async #applyResitCap(
    tenantId: string,
    registration: RegistrationContext,
    currentMark: number,
    attemptNumber: number,
    partial: PenaltyResult,
  ): Promise<PenaltyResult> {
    // Stage 3: resit-cap only applies to attempts >= 2 when flag is on
    if (attemptNumber < 2) return partial;

    const resitCapEnabled = await this.#evaluateBooleanFlag(tenantId, 'assessment.resit-cap.enabled', false);
    if (!resitCapEnabled) return partial;

    const ctx = { tenantId, programmeId: registration.programmeId ?? '' };
    let cap: number;
    try {
      cap = await this.rules.getResitMarkCap(ctx, partial.trace);
    } catch (err) {
      if (!(err instanceof RuleNotConfiguredError)) throw err;
      // No resit cap configured: the UK HE convention of 40, recorded as a built-in default (D-35).
      cap = await this.rules.builtInDefault(ctx, 'resit-mark-cap', 'default', 40, partial.trace);
    }
    if (Number.isFinite(cap) && currentMark > cap) {
      return { ...partial, adjustedMark: cap, resitCapApplied: true, resitCapMark: cap };
    }

    return partial;
  }

  async #applyLatePenaltyForUpdate(
    tenantId: string,
    registration: RegistrationContext,
    current: MarkDto,
    rawMark: number,
    input: UpdateMarkInput,
  ): Promise<PenaltyResult> {
    if (input.submittedAt || input.dueAt) {
      return this.#applyLatePenalty(tenantId, registration, rawMark, current.attemptNumber, input);
    }

    if (current.penaltyApplied && current.penaltyPercent !== null) {
      const afterPenalty = Math.max(0, roundMark(rawMark - current.penaltyPercent));
      const partial: PenaltyResult = {
        adjustedMark: afterPenalty,
        penaltyApplied: true,
        penaltyPercent: current.penaltyPercent,
        latePenaltyCapApplied: false,
        latePenaltyCapPercent: null,
        resitCapApplied: false,
        resitCapMark: null,
        latePenaltyEnabled: true,
        trace: new RuleTrace(),
      };
      return this.#applyResitCap(tenantId, registration, afterPenalty, current.attemptNumber, partial);
    }

    const noPenalty: PenaltyResult = {
      adjustedMark: rawMark,
      penaltyApplied: false,
      penaltyPercent: null,
      latePenaltyCapApplied: false,
      latePenaltyCapPercent: null,
      resitCapApplied: false,
      resitCapMark: null,
      latePenaltyEnabled: true,
      trace: new RuleTrace(),
    };
    return this.#applyResitCap(tenantId, registration, rawMark, current.attemptNumber, noPenalty);
  }

  async #evaluateBooleanFlag(tenantId: string, flagKey: string, fallback: boolean): Promise<boolean> {
    if (!this.featureFlags) return fallback;
    try {
      const flag = await this.featureFlags.getFlagByKey(flagKey);
      const result = await this.featureFlags.evaluatePreview(flag.featureFlagId, { tenantId });
      return result.value === true || result.variantKey === 'on';
    } catch {
      return fallback;
    }
  }

  /** Written in the mark's transaction: an evidence failure fails the mark (D-35). */
  async #writeMarkEvidence(
    tx: Pick<Db, 'execute'>,
    tenantId: string,
    markId: string,
    attemptNumber: number,
    rawMark: number,
    penalty: PenaltyResult,
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO mark_calculation_evidence (
        tenant_id, mark_id, attempt_number, raw_mark,
        late_penalty_enabled,
        late_penalty_percent, late_penalty_cap_applied, late_penalty_cap_percent,
        resit_cap_applied, resit_cap_mark,
        adjusted_mark,
        rule_snapshot, rule_versions
      ) VALUES (
        ${tenantId}::uuid, ${markId}::uuid, ${attemptNumber}, ${rawMark},
        ${penalty.latePenaltyEnabled},
        ${penalty.penaltyPercent}, ${penalty.latePenaltyCapApplied}, ${penalty.latePenaltyCapPercent},
        ${penalty.resitCapApplied}, ${penalty.resitCapMark},
        ${penalty.adjustedMark},
        '{}'::jsonb, ${JSON.stringify(penalty.trace.entries)}::jsonb
      )
    `);
  }

  async #hasActiveDeadlineExtension(
    tenantId: string,
    registration: RegistrationContext,
    activeAt: Date,
  ): Promise<boolean> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({ id: reasonableAdjustments.id })
        .from(reasonableAdjustments)
        .where(
          and(
            eq(reasonableAdjustments.enrolmentId, registration.enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(reasonableAdjustments.personId, registration.personId as `${string}-${string}-${string}-${string}-${string}`),
            eq(reasonableAdjustments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            eq(reasonableAdjustments.adjustmentTypeCode, 'deadline-extension'),
            or(
              eq(reasonableAdjustments.scopeCode, 'all'),
              eq(reasonableAdjustments.scopeCode, 'coursework'),
            ),
            lte(reasonableAdjustments.validFrom, activeAt),
            or(isNull(reasonableAdjustments.validTo), gt(reasonableAdjustments.validTo, activeAt)),
            isNull(reasonableAdjustments.recordedUntil),
          ),
        )
        .limit(1),
    );

    return rows.length > 0;
  }
}

function markToDto(row: typeof marks.$inferSelect): MarkDto {
  return {
    markId: row.id,
    moduleRegistrationId: row.moduleRegistrationId,
    assessmentComponentId: row.assessmentComponentId,
    assessmentSubmissionId: row.assessmentSubmissionId,
    attemptNumber: row.attemptNumber,
    rawMark: Number(row.rawMark),
    adjustedMark: Number(row.adjustedMark),
    penaltyApplied: row.penaltyApplied,
    penaltyPercent: row.penaltyPercent === null ? null : Number(row.penaltyPercent),
    locked: row.locked,
    sourceSystem: row.sourceSystem,
    actorId: row.actorId,
    validFrom: row.validFrom,
    validTo: row.validTo,
    recordedAt: row.recordedAt,
    recordedUntil: row.recordedUntil,
  };
}

function roundMark(value: number): number {
  return Math.round(value * 100) / 100;
}
