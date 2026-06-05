import { randomUUID } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';
import {
  postRatificationAmendments,
  postRatificationCases,
  enrolments,
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
import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';
import type { ProgressionService } from '../progression/progression-service.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AmendableEntityType = 'mark' | 'module_result' | 'progression_decision';

export type CaseStatusCode =
  | 'submitted'
  | 'under-review'
  | 'upheld'
  | 'dismissed'
  | 'not-eligible';

export interface OpenCaseInput {
  enrolmentId: string;
  caseTypeCode: 'appeal' | 'administrative-correction';
  reference?:   string;
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
}

// ── Allowed status transitions ────────────────────────────────────────────────

const ALLOWED_STATUS_TRANSITIONS: Record<CaseStatusCode, CaseStatusCode[]> = {
  'submitted':    ['under-review', 'dismissed', 'not-eligible'],
  'under-review': ['upheld', 'dismissed', 'not-eligible'],
  'upheld':       [],
  'dismissed':    [],
  'not-eligible': [],
};

// ── Service ───────────────────────────────────────────────────────────────────

export class CorrectionService {
  constructor(
    private readonly db:          Db,
    private readonly eventBus:    IntegrationBusPublisher,
    private readonly markService: MarkService,
    private readonly moduleResultService: ModuleResultService,
    private readonly progressionService:  ProgressionService,
  ) {}

  async openCase(tenantId: string, input: OpenCaseInput, actorId: string): Promise<string> {
    await this.#ensureEnrolmentExists(input.enrolmentId, tenantId);

    const caseId = randomUUID();
    const now    = new Date();

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(postRatificationCases).values({
        versionId:    randomUUID(),
        id:           caseId as `${string}-${string}-${string}-${string}-${string}`,
        tenantId:     tenantId as `${string}-${string}-${string}-${string}-${string}`,
        enrolmentId:  input.enrolmentId as `${string}-${string}-${string}-${string}-${string}`,
        caseTypeCode: input.caseTypeCode,
        statusCode:   'submitted',
        reference:    input.reference ?? null,
        actorId,
        validFrom:    now,
        validTo:      null,
        recordedAt:   now,
        recordedUntil: null,
      });
    });

    return caseId;
  }

  async advanceCaseStatus(
    caseId:     string,
    tenantId:   string,
    newStatus:  CaseStatusCode,
    actorId:    string,
  ): Promise<void> {
    const current = await this.#getCurrentCase(caseId, tenantId);
    if (!current) throw new NotFoundError('CorrectionCase', caseId);

    const allowed = ALLOWED_STATUS_TRANSITIONS[current.statusCode as CaseStatusCode] ?? [];
    if (!allowed.includes(newStatus)) {
      throw new ValidationError(
        `Cannot transition correction case from '${current.statusCode}' to '${newStatus}'`,
      );
    }

    const now = new Date();

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
      });
    });
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

    // Dispatch to the correct service and capture the before-value
    const beforeValue = await this.#dispatchAmendment(tenantId, input, actorId);

    const amendmentId = randomUUID();
    const now         = new Date();

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(postRatificationAmendments).values({
        id:           amendmentId as `${string}-${string}-${string}-${string}-${string}`,
        tenantId:     tenantId as `${string}-${string}-${string}-${string}-${string}`,
        caseId:       caseId as `${string}-${string}-${string}-${string}-${string}`,
        entityType:   input.entityType,
        entityId:     input.entityId as `${string}-${string}-${string}-${string}-${string}`,
        beforeValue:  beforeValue as Record<string, unknown>,
        afterValue:   input.afterValue,
        authorisedBy: actorId,
        amendedAt:    now,
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

  async listCases(enrolmentId: string, tenantId: string): Promise<CorrectionCaseDto[]> {
    await this.#ensureEnrolmentExists(enrolmentId, tenantId);
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(postRatificationCases).where(and(
        eq(postRatificationCases.enrolmentId, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
        eq(postRatificationCases.tenantId,    tenantId    as `${string}-${string}-${string}-${string}-${string}`),
      )).orderBy(postRatificationCases.recordedAt),
    );
    return rows.map(caseToDto);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  async #dispatchAmendment(
    tenantId: string,
    input:    ApplyAmendmentInput,
    actorId:  string,
  ): Promise<unknown> {
    switch (input.entityType) {
      case 'mark': {
        const markPatch: { rawMark?: number; adjustedMark?: number; penaltyApplied?: boolean; penaltyPercent?: number | null } = {};
        if (input.afterValue['rawMark']        != null) markPatch.rawMark        = Number(input.afterValue['rawMark']);
        if (input.afterValue['adjustedMark']   != null) markPatch.adjustedMark   = Number(input.afterValue['adjustedMark']);
        if (input.afterValue['penaltyApplied'] != null) markPatch.penaltyApplied = Boolean(input.afterValue['penaltyApplied']);
        if ('penaltyPercent' in input.afterValue) {
          markPatch.penaltyPercent = input.afterValue['penaltyPercent'] != null ? Number(input.afterValue['penaltyPercent']) : null;
        }
        return this.markService.applyLockedAmendment(input.entityId, tenantId, markPatch, actorId);
      }

      case 'module_result': {
        const resultPatch: { aggregateMark?: number; resultCode?: string } = {};
        if (input.afterValue['aggregateMark'] != null) resultPatch.aggregateMark = Number(input.afterValue['aggregateMark']);
        if (input.afterValue['resultCode']    != null) resultPatch.resultCode    = String(input.afterValue['resultCode']);
        return this.moduleResultService.applyLockedAmendment(input.entityId, tenantId, resultPatch, actorId);
      }

      case 'progression_decision': {
        const decisionPatch: { decisionCode?: string } = {};
        if (input.afterValue['decisionCode'] != null) decisionPatch.decisionCode = String(input.afterValue['decisionCode']);
        return this.progressionService.applyLockedAmendment(input.entityId, tenantId, decisionPatch, actorId);
      }

      default:
        throw new ValidationError(
          `Unsupported entity type '${input.entityType as string}' for post-ratification amendment`,
        );
    }
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
  };
}
