import { randomUUID } from 'node:crypto';

import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  marks,
  moduleRegistrations,
  moduleResults,
  postRatificationAmendments,
  postRatificationCases,
  enrolments,
  progressionDecisions,
  sourceVersionReferences,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import {
  EVENT_TYPES,
  NotFoundError,
  ValidationError,
} from '@revelation-srs/domain';
import type { GovernanceRecordAmendedPostRatificationV1Payload } from '@revelation-srs/domain';

import type { MarkService } from '../assessment/mark-service.js';
import type { ModuleResultService } from '../assessment/module-result-service.js';
import type { BusinessCaseService } from '../cases/business-case-service.js';
import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';
import type { ProgressionService } from '../progression/progression-service.js';
import type { ValueSetService } from '../value-sets/service.js';
import { TransitionValidator, type TransitionValidationResult } from '../workflow/transition-service.js';
import { clockNow } from '../clock.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AmendableEntityType = 'mark' | 'module_result' | 'progression_decision';

export type CaseStatusCode =
  | 'open'
  | 'under-review'
  | 'upheld'
  | 'not-upheld'
  | 'withdrawn';

export interface OpenCaseInput {
  enrolmentId: string;
  caseTypeCode: 'appeal' | 'administrative-correction';
  reference?:   string;
  // BPR-D13: optional at open time — an error category and evidence
  // reference are often only known once the case has been investigated.
  errorCategoryCode?: string;
  evidenceRef?:       string;
  authorisedBy?:      string;
}

export interface ApplyAmendmentInput {
  entityType:  AmendableEntityType;
  entityId:    string;
  afterValue:  Record<string, unknown>;
}

export interface CorrectionCaseDto {
  caseId:       string;
  enrolmentId:  string;
  caseTypeCode: string;
  statusCode:   string;
  reference:    string | null;
  actorId:      string;
  validFrom:    Date;
  validTo:      Date | null;
  recordedAt:   Date;
  recordedUntil: Date | null;
  errorCategoryCode: string | null;
  evidenceRef:       string | null;
  authorisedBy:      string | null;
}

export interface AmendmentDto {
  amendmentId:  string;
  caseId:       string;
  entityType:   string;
  entityId:     string;
  beforeValue:  unknown;
  afterValue:   unknown;
  authorisedBy: string;
  amendedAt:    Date;
  /** The exact versions before and after the correction (D-37); null for amendments recorded before that. */
  before:       { versionId: string; recordedAt: Date } | null;
  after:        { versionId: string; recordedAt: Date } | null;
}

// ── Allowed status transitions ────────────────────────────────────────────────

const ALLOWED_STATUS_TRANSITIONS: Record<CaseStatusCode, CaseStatusCode[]> = {
  'open':         ['under-review', 'not-upheld', 'withdrawn'],
  'under-review': ['upheld', 'not-upheld', 'withdrawn'],
  'upheld':       [],
  'not-upheld':   [],
  'withdrawn':    [],
};

// ── Service ───────────────────────────────────────────────────────────────────

export class CorrectionService {
  private readonly transitionValidator: TransitionValidator;

  constructor(
    private readonly db:          Db,
    private readonly eventBus:    IntegrationBusPublisher,
    private readonly markService: MarkService,
    private readonly moduleResultService: ModuleResultService,
    private readonly progressionService:  ProgressionService,
    valueSets: ValueSetService,
    private readonly businessCases?: BusinessCaseService,
  ) {
    this.transitionValidator = new TransitionValidator(valueSets);
  }

  async openCase(tenantId: string, input: OpenCaseInput, actorId: string): Promise<string> {
    await this.#ensureEnrolmentExists(input.enrolmentId, tenantId);

    const caseId = randomUUID();
    const now    = clockNow();

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(postRatificationCases).values({
        versionId:    randomUUID(),
        id:           caseId,
        tenantId:     tenantId as `${string}-${string}-${string}-${string}-${string}`,
        enrolmentId:  input.enrolmentId as `${string}-${string}-${string}-${string}-${string}`,
        caseTypeCode: input.caseTypeCode,
        statusCode:   'open',
        reference:    input.reference ?? null,
        actorId,
        validFrom:    now,
        validTo:      null,
        recordedAt:   now,
        recordedUntil: null,
        supersededVersionId: null,
        errorCategoryCode:   input.errorCategoryCode ?? null,
        evidenceRef:         input.evidenceRef ? (input.evidenceRef as `${string}-${string}-${string}-${string}-${string}`) : null,
        authorisedBy:        input.authorisedBy ?? null,
      });
    });

    return caseId;
  }

  /**
   * Creates a distribution_item per downstream consumer for an already
   * -recorded amendment (BPR-D13), so each consumer's application/
   * acknowledgement can be tracked individually rather than assuming the
   * amendment record alone notifies anyone.
   */
  async distributeAmendment(amendmentId: string, tenantId: string, targetSystemCodes: string[]): Promise<string[]> {
    if (!this.businessCases) {
      throw new ValidationError('Distribution is not configured for this correction service instance');
    }
    const itemIds: string[] = [];
    for (const targetSystemCode of targetSystemCodes) {
      const itemId = await this.businessCases.createDistributionItem(tenantId, {
        targetSystemCode,
        contentRef: amendmentId,
      });
      itemIds.push(itemId);
    }
    return itemIds;
  }

  async advanceCaseStatus(
    caseId:     string,
    tenantId:   string,
    newStatus:  CaseStatusCode,
    actorId:    string,
  ): Promise<TransitionValidationResult<CaseStatusCode>> {
    const current = await this.#getCurrentCase(caseId, tenantId);
    if (!current) throw new NotFoundError('CorrectionCase', caseId);

    const now = clockNow();
    const transitionDecision = await this.transitionValidator.assertAllowed({
      tenantId,
      entityName: 'post_ratification_case',
      fieldName: 'status_code',
      entityLabel: 'correction case',
      fromStatus: current.statusCode as CaseStatusCode,
      toStatus: newStatus,
      defaultTransitions: ALLOWED_STATUS_TRANSITIONS,
      asAt: now,
    });

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.update(postRatificationCases)
        .set({ recordedUntil: now, validTo: now })
        .where(and(
          eq(postRatificationCases.id,       caseId   as `${string}-${string}-${string}-${string}-${string}`),
          eq(postRatificationCases.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          isNull(postRatificationCases.recordedUntil),
        ));

      await tx.insert(postRatificationCases).values({
        versionId:    randomUUID(),
        id:           caseId as `${string}-${string}-${string}-${string}-${string}`,
        tenantId:     tenantId as `${string}-${string}-${string}-${string}-${string}`,
        enrolmentId:  current.enrolmentId as `${string}-${string}-${string}-${string}-${string}`,
        caseTypeCode: current.caseTypeCode,
        statusCode:   newStatus,
        reference:    current.reference,
        actorId,
        validFrom:    now,
        validTo:      null,
        recordedAt:   now,
        recordedUntil: null,
        supersededVersionId: null,
        errorCategoryCode:   current.errorCategoryCode,
        evidenceRef:         current.evidenceRef ? (current.evidenceRef as `${string}-${string}-${string}-${string}-${string}`) : null,
        authorisedBy:        current.authorisedBy,
      });
    });

    return transitionDecision;
  }

  async applyAmendment(
    caseId:   string,
    tenantId: string,
    input:    ApplyAmendmentInput,
    actorId:  string,
  ): Promise<string> {
    const currentCase = await this.#getCurrentCase(caseId, tenantId);
    if (!currentCase) throw new NotFoundError('CorrectionCase', caseId);

    if (currentCase.statusCode !== 'upheld') {
      throw new ValidationError(
        `Amendment can only be applied to an upheld case; case '${caseId}' is '${currentCase.statusCode}'`,
      );
    }

    const amendmentId = randomUUID();
    const now         = clockNow();

    await withTenantContext(this.db, tenantId, async (tx) => {
      const { beforeValue, beforeVersionId, afterVersionId } = await this.#dispatchAmendment(tx, tenantId, currentCase.enrolmentId, input, actorId, now);

      // The exact versions before and after, so the correction can be reproduced (D-37, BPR-D13).
      const ref = async (versionId: string, purposeCode: 'amendment-before' | 'amendment-after') => {
        const id = randomUUID();
        await tx.insert(sourceVersionReferences).values({
          id, tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`, caseDecisionId: null,
          entityType: input.entityType, entityId: input.entityId as `${string}-${string}-${string}-${string}-${string}`,
          versionId: versionId as `${string}-${string}-${string}-${string}-${string}`, purposeCode, createdAt: now,
        });
        return id;
      };
      const beforeVersionRef = await ref(beforeVersionId, 'amendment-before');
      const afterVersionRef = await ref(afterVersionId, 'amendment-after');

      await tx.insert(postRatificationAmendments).values({
        id:           amendmentId,
        tenantId:     tenantId as `${string}-${string}-${string}-${string}-${string}`,
        caseId:       caseId as `${string}-${string}-${string}-${string}-${string}`,
        entityType:   input.entityType,
        entityId:     input.entityId as `${string}-${string}-${string}-${string}-${string}`,
        beforeValue,
        afterValue:   input.afterValue,
        authorisedBy: actorId,
        amendedAt:    now,
        beforeVersionRef: beforeVersionRef,
        afterVersionRef:  afterVersionRef,
      });
    });

    if (this.eventBus.isConnected()) {
      const payload: GovernanceRecordAmendedPostRatificationV1Payload = {
        amendmentId,
        caseId,
        entityType: input.entityType,
        entityId:   input.entityId,
        amendedBy:  actorId,
        amendedAt:  now.toISOString(),
        ...(currentCase.reference ? { appealReference: currentCase.reference } : {}),
      };
      await this.eventBus.publish(
        EVENT_TYPES.GOVERNANCE_RECORD_AMENDED,
        '1.0.0',
        tenantId,
        actorId,
        'personal',
        payload,
      );
    }

    return amendmentId;
  }

  /** A case's amendments, with the versions each replaced and created (D-37). */
  async listAmendments(caseId: string, tenantId: string): Promise<AmendmentDto[]> {
    if (!(await this.#getCurrentCase(caseId, tenantId))) throw new NotFoundError('CorrectionCase', caseId);
    return withTenantContext(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(postRatificationAmendments).where(and(
        eq(postRatificationAmendments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
        eq(postRatificationAmendments.caseId, caseId as `${string}-${string}-${string}-${string}-${string}`),
      )).orderBy(postRatificationAmendments.amendedAt);
      const refIds = rows.flatMap((r) => [r.beforeVersionRef, r.afterVersionRef]).filter((v): v is `${string}-${string}-${string}-${string}-${string}` => v !== null);
      const refs = refIds.length === 0 ? [] : await tx.select().from(sourceVersionReferences).where(inArray(sourceVersionReferences.id, refIds));
      const versionRow = async (entityType: string, versionId: string): Promise<Date | null> => {
        const table = entityType === 'mark' ? marks : entityType === 'module_result' ? moduleResults : progressionDecisions;
        const [v] = await tx.select({ recordedAt: table.recordedAt }).from(table).where(eq(table.versionId, versionId as `${string}-${string}-${string}-${string}-${string}`)).limit(1);
        return v?.recordedAt ?? null;
      };
      const out: AmendmentDto[] = [];
      for (const r of rows) {
        const side = async (refId: string | null) => {
          const ref = refs.find((x) => x.id === refId);
          if (!ref) return null;
          const recordedAt = await versionRow(r.entityType, ref.versionId);
          return recordedAt ? { versionId: ref.versionId, recordedAt } : null;
        };
        out.push({
          amendmentId: r.id, caseId: r.caseId, entityType: r.entityType, entityId: r.entityId, beforeValue: r.beforeValue, afterValue: r.afterValue,
          authorisedBy: r.authorisedBy, amendedAt: r.amendedAt, before: await side(r.beforeVersionRef), after: await side(r.afterVersionRef),
        });
      }
      return out;
    });
  }

  async listCases(enrolmentId: string, tenantId: string): Promise<CorrectionCaseDto[]> {
    await this.#ensureEnrolmentExists(enrolmentId, tenantId);
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(postRatificationCases).where(and(
        eq(postRatificationCases.enrolmentId, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
        eq(postRatificationCases.tenantId,    tenantId    as `${string}-${string}-${string}-${string}-${string}`),
        isNull(postRatificationCases.recordedUntil),
      )).orderBy(postRatificationCases.recordedAt),
    );
    return rows.map(caseToDto);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  async #dispatchAmendment(
    tx: Parameters<Parameters<typeof withTenantContext>[2]>[0],
    tenantId: string,
    caseEnrolmentId: string,
    input:    ApplyAmendmentInput,
    actorId:  string,
    now: Date,
  ): Promise<{ beforeValue: unknown; beforeVersionId: string; afterVersionId: string }> {
    // ADR-013: a correction restates the same valid period. The superseded
    // version leaves the current record (recorded_until) but keeps its valid
    // time, so history still shows what was believed true, and when.
    const afterVersionId = randomUUID();
    switch (input.entityType) {
      case 'mark': {
        const rows = await tx.select({
          versionId: marks.versionId,
          id: marks.id,
          tenantId: marks.tenantId,
          moduleRegistrationId: marks.moduleRegistrationId,
          assessmentComponentId: marks.assessmentComponentId,
          assessmentSubmissionId: marks.assessmentSubmissionId,
          attemptNumber: marks.attemptNumber,
          rawMark: marks.rawMark,
          adjustedMark: marks.adjustedMark,
          penaltyApplied: marks.penaltyApplied,
          penaltyPercent: marks.penaltyPercent,
          locked: marks.locked,
          sourceSystem: marks.sourceSystem,
          actorId: marks.actorId,
          validFrom: marks.validFrom,
          validTo: marks.validTo,
          recordedAt: marks.recordedAt,
          recordedUntil: marks.recordedUntil,
          enrolmentId: moduleRegistrations.enrolmentId,
        })
          .from(marks)
          .innerJoin(moduleRegistrations, eq(marks.moduleRegistrationId, moduleRegistrations.id))
          .where(and(
            eq(marks.id, input.entityId as `${string}-${string}-${string}-${string}-${string}`),
            eq(marks.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleRegistrations.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(marks.recordedUntil),
          )).limit(1);
        const current = rows[0];
        if (!current) throw new NotFoundError('Mark', input.entityId);
        this.#assertCaseOwnsEntity(caseEnrolmentId, current.enrolmentId, input.entityType, input.entityId);

        const rawMark = input.afterValue['rawMark'] != null ? Number(input.afterValue['rawMark']) : Number(current.rawMark);
        const adjustedMark = input.afterValue['adjustedMark'] != null ? Number(input.afterValue['adjustedMark']) : Number(current.adjustedMark);
        const penaltyApplied = input.afterValue['penaltyApplied'] != null
          ? Boolean(input.afterValue['penaltyApplied'])
          : current.penaltyApplied;
        let penaltyPercent = current.penaltyPercent === null ? null : Number(current.penaltyPercent);
        if ('penaltyPercent' in input.afterValue) {
          penaltyPercent = input.afterValue['penaltyPercent'] != null ? Number(input.afterValue['penaltyPercent']) : null;
        }

        await tx.update(marks)
          .set({ recordedUntil: now })
          .where(and(
            eq(marks.id, input.entityId as `${string}-${string}-${string}-${string}-${string}`),
            eq(marks.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(marks.recordedUntil),
          ));
        await tx.insert(marks).values({
          versionId: afterVersionId,
          id: input.entityId as `${string}-${string}-${string}-${string}-${string}`,
          tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`,
          moduleRegistrationId: current.moduleRegistrationId,
          assessmentComponentId: current.assessmentComponentId,
          assessmentSubmissionId: current.assessmentSubmissionId,
          attemptNumber: current.attemptNumber,
          rawMark: rawMark.toFixed(2),
          adjustedMark: adjustedMark.toFixed(2),
          penaltyApplied,
          penaltyPercent: penaltyPercent?.toFixed(2) ?? null,
          locked: true,
          sourceSystem: current.sourceSystem,
          actorId,
          validFrom: current.validFrom,
          validTo: current.validTo,
          recordedAt: now,
          recordedUntil: null,
        });
        return { beforeValue: this.#markBeforeValue(current), beforeVersionId: current.versionId, afterVersionId };
      }

      case 'module_result': {
        const rows = await tx.select({
          versionId: moduleResults.versionId,
          id: moduleResults.id,
          moduleRegistrationId: moduleResults.moduleRegistrationId,
          aggregateMark: moduleResults.aggregateMark,
          resultCode: moduleResults.resultCode,
          locked: moduleResults.locked,
          calculatedAt: moduleResults.calculatedAt,
          validFrom: moduleResults.validFrom,
          validTo: moduleResults.validTo,
          recordedAt: moduleResults.recordedAt,
          recordedUntil: moduleResults.recordedUntil,
          enrolmentId: moduleRegistrations.enrolmentId,
        })
          .from(moduleResults)
          .innerJoin(moduleRegistrations, eq(moduleResults.moduleRegistrationId, moduleRegistrations.id))
          .where(and(
            eq(moduleResults.id, input.entityId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleResults.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleRegistrations.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(moduleResults.recordedUntil),
          )).limit(1);
        const current = rows[0];
        if (!current) throw new NotFoundError('ModuleResult', input.entityId);
        this.#assertCaseOwnsEntity(caseEnrolmentId, current.enrolmentId, input.entityType, input.entityId);

        const aggregateMark = input.afterValue['aggregateMark'] != null
          ? Number(input.afterValue['aggregateMark'])
          : Number(current.aggregateMark);
        const resultCodeValue = input.afterValue['resultCode'];
        const resultCode = typeof resultCodeValue === 'string'
          ? resultCodeValue
          : current.resultCode;

        await tx.update(moduleResults)
          .set({ recordedUntil: now })
          .where(and(
            eq(moduleResults.id, input.entityId as `${string}-${string}-${string}-${string}-${string}`),
            eq(moduleResults.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(moduleResults.recordedUntil),
          ));
        await tx.insert(moduleResults).values({
          versionId: afterVersionId,
          id: input.entityId as `${string}-${string}-${string}-${string}-${string}`,
          tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`,
          moduleRegistrationId: current.moduleRegistrationId,
          aggregateMark: aggregateMark.toFixed(2),
          resultCode,
          locked: true,
          calculatedAt: now,
          validFrom: current.validFrom,
          validTo: current.validTo,
          recordedAt: now,
          recordedUntil: null,
        });
        return { beforeValue: this.#moduleResultBeforeValue(current), beforeVersionId: current.versionId, afterVersionId };
      }

      case 'progression_decision': {
        const rows = await tx.select().from(progressionDecisions).where(and(
          eq(progressionDecisions.id, input.entityId as `${string}-${string}-${string}-${string}-${string}`),
          eq(progressionDecisions.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          isNull(progressionDecisions.recordedUntil),
        )).limit(1);
        const current = rows[0];
        if (!current) throw new NotFoundError('ProgressionDecision', input.entityId);
        this.#assertCaseOwnsEntity(caseEnrolmentId, current.enrolmentId, input.entityType, input.entityId);

        const decisionCodeValue = input.afterValue['decisionCode'];
        const decisionCode = typeof decisionCodeValue === 'string'
          ? decisionCodeValue
          : current.decisionCode;

        await tx.update(progressionDecisions)
          .set({ recordedUntil: now })
          .where(and(
            eq(progressionDecisions.id, input.entityId as `${string}-${string}-${string}-${string}-${string}`),
            eq(progressionDecisions.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(progressionDecisions.recordedUntil),
          ));
        await tx.insert(progressionDecisions).values({
          versionId: afterVersionId,
          id: input.entityId as `${string}-${string}-${string}-${string}-${string}`,
          tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`,
          enrolmentId: current.enrolmentId,
          academicYear: current.academicYear,
          yearOfStudy: current.yearOfStudy,
          decisionCode,
          examBoardId: current.examBoardId,
          locked: true,
          actorId,
          validFrom: current.validFrom,
          validTo: current.validTo,
          recordedAt: now,
          recordedUntil: null,
        });
        return { beforeValue: this.#progressionBeforeValue(current), beforeVersionId: current.versionId, afterVersionId };
      }

      default:
        throw new ValidationError(
          `Unsupported entity type '${input.entityType as string}' for post-ratification amendment`,
        );
    }
  }

  #assertCaseOwnsEntity(caseEnrolmentId: string, entityEnrolmentId: string, entityType: string, entityId: string): void {
    if (caseEnrolmentId !== entityEnrolmentId) {
      throw new ValidationError(
        `Correction case enrolment does not match ${entityType} '${entityId}'`,
        [{ field: 'entityId', message: 'Entity does not belong to the correction case enrolment' }],
      );
    }
  }

  #markBeforeValue(row: {
    id: string;
    moduleRegistrationId: string;
    assessmentComponentId: string;
    assessmentSubmissionId: string | null;
    attemptNumber: number;
    rawMark: string;
    adjustedMark: string;
    penaltyApplied: boolean;
    penaltyPercent: string | null;
    locked: boolean;
    sourceSystem: string | null;
  }): Record<string, unknown> {
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
    };
  }

  #moduleResultBeforeValue(row: {
    id: string;
    moduleRegistrationId: string;
    aggregateMark: string;
    resultCode: string;
    locked: boolean;
    calculatedAt: Date;
  }): Record<string, unknown> {
    return {
      moduleResultId: row.id,
      moduleRegistrationId: row.moduleRegistrationId,
      aggregateMark: Number(row.aggregateMark),
      resultCode: row.resultCode,
      locked: row.locked,
      calculatedAt: row.calculatedAt.toISOString(),
    };
  }

  #progressionBeforeValue(row: typeof progressionDecisions.$inferSelect): Record<string, unknown> {
    return {
      progressionDecisionId: row.id,
      enrolmentId: row.enrolmentId,
      academicYear: row.academicYear,
      yearOfStudy: row.yearOfStudy,
      decisionCode: row.decisionCode,
      examBoardId: row.examBoardId,
      locked: row.locked,
    };
  }

  async #getCurrentCase(caseId: string, tenantId: string): Promise<CorrectionCaseDto | null> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(postRatificationCases).where(and(
        eq(postRatificationCases.id,       caseId   as `${string}-${string}-${string}-${string}-${string}`),
        eq(postRatificationCases.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
        isNull(postRatificationCases.recordedUntil),
      )).limit(1),
    );
    return rows[0] ? caseToDto(rows[0]) : null;
  }

  async #ensureEnrolmentExists(enrolmentId: string, tenantId: string): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ id: enrolments.id }).from(enrolments).where(and(
        eq(enrolments.id,       enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
        eq(enrolments.tenantId, tenantId    as `${string}-${string}-${string}-${string}-${string}`),
        isNull(enrolments.recordedUntil),
      )).limit(1),
    );
    if (!rows[0]) throw new NotFoundError('Enrolment', enrolmentId);
  }
}

// ── Mapper ────────────────────────────────────────────────────────────────────

function caseToDto(row: typeof postRatificationCases.$inferSelect): CorrectionCaseDto {
  return {
    caseId:       row.id,
    enrolmentId:  row.enrolmentId,
    caseTypeCode: row.caseTypeCode,
    statusCode:   row.statusCode,
    reference:    row.reference,
    actorId:      row.actorId,
    validFrom:    row.validFrom,
    validTo:      row.validTo,
    recordedAt:   row.recordedAt,
    recordedUntil: row.recordedUntil,
    errorCategoryCode: row.errorCategoryCode,
    evidenceRef:       row.evidenceRef,
    authorisedBy:      row.authorisedBy,
  };
}
