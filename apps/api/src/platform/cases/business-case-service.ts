import { randomUUID } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';
import {
  businessCases,
  caseEvidenceReferences,
  caseDecisions,
  sourceVersionReferences,
  distributionItems,
  distributionAttempts,
  distributionAcknowledgements,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError } from '@revelation-srs/domain';

import { clockNow } from '../clock.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

/**
 * Shared case/evidence/decision/distribution primitives (BPR "Shared
 * primitives"). Domain services (CAS, support outcome, moderation, board
 * authority, correction, regulatory, identity, rights, audit review) call
 * this service to open/track their governed case instances and to record
 * exchange state, instead of re-implementing case or distribution semantics.
 *
 * This service intentionally has no public routes: it is infrastructure
 * consumed by domain services, not a stand-alone capability.
 */

export interface OpenBusinessCaseInput {
  subjectType: string;
  subjectId:   string;
  processId:   string;
  statusCode:  string;
  ownerId:     string;
}

export interface BusinessCaseDto {
  caseId:      string;
  tenantId:    string;
  subjectType: string;
  subjectId:   string;
  processId:   string;
  statusCode:  string;
  ownerId:     string;
  actorId:     string;
  validFrom:   Date;
  validTo:     Date | null;
  recordedAt:  Date;
  recordedUntil: Date | null;
}

export interface RecordEvidenceInput {
  evidenceRef:        string;
  classificationCode: string;
  sourceSystem:        string;
  sourceReference?:    string;
  contentHash?:        string;
  receivedBy:          string;
}

export interface RecordDecisionInput {
  decisionTypeCode: string;
  authorityActorId: string;
  policyVersion?:   string;
  reasonCode?:      string;
  reasonText?:      string;
  effectiveAt:      Date;
}

export interface CreateDistributionItemInput {
  sourceDecisionId?: string;
  targetSystemCode:  string;
  contentRef:        string;
}

export interface RecordAttemptInput {
  transportCode: string;
  payloadHash?:  string;
  responseCode?: string;
  errorDetail?:  string;
}

export interface RecordAcknowledgementInput {
  resultCode:         string;
  reconciliationRef?: string;
  detail?:            Record<string, unknown>;
}

export class BusinessCaseService {
  constructor(private readonly db: Db) {}

  async openCase(tenantId: string, input: OpenBusinessCaseInput, actorId: string): Promise<string> {
    const caseId = randomUUID();
    const now    = clockNow();

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(businessCases).values({
        versionId:    randomUUID(),
        id:           caseId as Uuid,
        tenantId:     tenantId as Uuid,
        subjectType:  input.subjectType,
        subjectId:    input.subjectId as Uuid,
        processId:    input.processId,
        statusCode:   input.statusCode,
        ownerId:      input.ownerId,
        actorId,
        validFrom:    now,
        validTo:      null,
        recordedAt:   now,
        recordedUntil: null,
      });
    });

    return caseId;
  }

  async advanceCaseStatus(caseId: string, tenantId: string, statusCode: string, actorId: string): Promise<void> {
    const current = await this.getCurrentCase(caseId, tenantId);
    if (!current) throw new NotFoundError('BusinessCase', caseId);

    const now = clockNow();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.update(businessCases)
        .set({ recordedUntil: now, validTo: now })
        .where(and(
          eq(businessCases.id,       caseId   as Uuid),
          eq(businessCases.tenantId, tenantId as Uuid),
          isNull(businessCases.recordedUntil),
        ));

      await tx.insert(businessCases).values({
        versionId:    randomUUID(),
        id:           caseId as Uuid,
        tenantId:     tenantId as Uuid,
        subjectType:  current.subjectType,
        subjectId:    current.subjectId as Uuid,
        processId:    current.processId,
        statusCode,
        ownerId:      current.ownerId,
        actorId,
        validFrom:    now,
        validTo:      null,
        recordedAt:   now,
        recordedUntil: null,
      });
    });
  }

  async getCurrentCase(caseId: string, tenantId: string): Promise<BusinessCaseDto | null> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(businessCases).where(and(
        eq(businessCases.id,       caseId   as Uuid),
        eq(businessCases.tenantId, tenantId as Uuid),
        isNull(businessCases.recordedUntil),
      )).limit(1),
    );
    return rows[0] ? caseToDto(rows[0]) : null;
  }

  /**
   * Lists current business cases for a process, optionally filtered by
   * status. Used by domain services (identity resolution, rights requests,
   * audit review, ...) to give their write-only workflow consoles a
   * browsable case list, joined in the caller against the domain's own
   * aggregate table for the domain-specific case ID.
   */
  async listCasesByProcess(
    tenantId: string,
    processId: string,
    statusCode?: string,
  ): Promise<BusinessCaseDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(businessCases).where(and(
        eq(businessCases.tenantId,  tenantId  as Uuid),
        eq(businessCases.processId, processId),
        isNull(businessCases.recordedUntil),
        ...(statusCode ? [eq(businessCases.statusCode, statusCode)] : []),
      )),
    );
    return rows.map(caseToDto);
  }

  async addEvidence(caseId: string, tenantId: string, input: RecordEvidenceInput): Promise<string> {
    const evidenceId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(caseEvidenceReferences).values({
        id:                  evidenceId,
        tenantId:            tenantId as Uuid,
        businessCaseId:      caseId as Uuid,
        evidenceRef:         input.evidenceRef,
        classificationCode:  input.classificationCode,
        sourceSystem:        input.sourceSystem,
        sourceReference:     input.sourceReference ?? null,
        contentHash:         input.contentHash ?? null,
        receivedAt:          clockNow(),
        receivedBy:          input.receivedBy,
      });
    });
    return evidenceId;
  }

  async recordDecision(caseId: string, tenantId: string, input: RecordDecisionInput): Promise<string> {
    const decisionId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(caseDecisions).values({
        id:               decisionId,
        tenantId:         tenantId as Uuid,
        businessCaseId:   caseId as Uuid,
        decisionTypeCode: input.decisionTypeCode,
        authorityActorId: input.authorityActorId,
        policyVersion:    input.policyVersion ?? null,
        reasonCode:       input.reasonCode ?? null,
        reasonText:       input.reasonText ?? null,
        effectiveAt:      input.effectiveAt,
        decidedAt:        clockNow(),
      });
    });
    return decisionId;
  }

  async recordSourceVersion(
    tenantId: string,
    entityType: string,
    entityId: string,
    versionId: string,
    purposeCode: string,
    caseDecisionId?: string,
  ): Promise<string> {
    const id = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(sourceVersionReferences).values({
        id,
        tenantId:       tenantId as Uuid,
        caseDecisionId: caseDecisionId ? (caseDecisionId as Uuid) : null,
        entityType,
        entityId:       entityId as Uuid,
        versionId:      versionId as Uuid,
        purposeCode,
        createdAt:      clockNow(),
      });
    });
    return id;
  }

  async createDistributionItem(tenantId: string, input: CreateDistributionItemInput): Promise<string> {
    const id  = randomUUID();
    const now = clockNow();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(distributionItems).values({
        id,
        tenantId:         tenantId as Uuid,
        sourceDecisionId: input.sourceDecisionId ? (input.sourceDecisionId as Uuid) : null,
        targetSystemCode: input.targetSystemCode,
        contentRef:       input.contentRef,
        statusCode:       'pending',
        createdAt:        now,
        updatedAt:        now,
      });
    });
    return id;
  }

  async recordAttempt(distributionItemId: string, tenantId: string, input: RecordAttemptInput): Promise<void> {
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(distributionAttempts).values({
        id:                  randomUUID(),
        tenantId:            tenantId as Uuid,
        distributionItemId:  distributionItemId as Uuid,
        attemptedAt:         clockNow(),
        transportCode:       input.transportCode,
        payloadHash:         input.payloadHash ?? null,
        responseCode:        input.responseCode ?? null,
        errorDetail:         input.errorDetail ?? null,
      });

      await tx.update(distributionItems)
        .set({ statusCode: input.errorDetail ? 'failed' : 'sent', updatedAt: clockNow() })
        .where(and(
          eq(distributionItems.id,       distributionItemId as Uuid),
          eq(distributionItems.tenantId, tenantId            as Uuid),
        ));
    });
  }

  async recordAcknowledgement(distributionItemId: string, tenantId: string, input: RecordAcknowledgementInput): Promise<void> {
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(distributionAcknowledgements).values({
        id:                  randomUUID(),
        tenantId:            tenantId as Uuid,
        distributionItemId:  distributionItemId as Uuid,
        acknowledgedAt:      clockNow(),
        resultCode:          input.resultCode,
        reconciliationRef:   input.reconciliationRef ?? null,
        detail:              input.detail ?? null,
      });

      await tx.update(distributionItems)
        .set({
          statusCode: input.resultCode === 'applied' || input.resultCode === 'reconciled' ? 'acknowledged' : 'failed',
          updatedAt: clockNow(),
        })
        .where(and(
          eq(distributionItems.id,       distributionItemId as Uuid),
          eq(distributionItems.tenantId, tenantId            as Uuid),
        ));
    });
  }
}

function caseToDto(row: typeof businessCases.$inferSelect): BusinessCaseDto {
  return {
    caseId:        row.id,
    tenantId:      row.tenantId,
    subjectType:   row.subjectType,
    subjectId:     row.subjectId,
    processId:     row.processId,
    statusCode:    row.statusCode,
    ownerId:       row.ownerId,
    actorId:       row.actorId,
    validFrom:     row.validFrom,
    validTo:       row.validTo,
    recordedAt:    row.recordedAt,
    recordedUntil: row.recordedUntil,
  };
}
