import { randomUUID } from 'node:crypto';

import { and, eq, inArray } from 'drizzle-orm';
import {
  individualRightsRequests,
  rightsRequestScopes,
  rightsSearchManifests,
  rightsDecisions,
  processingRestrictions,
  retentionSchedules,
  retentionAssignments,
  recordHolds,
  recordDispositions,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError, ValidationError } from '@revelation-srs/domain';

import { BusinessCaseService } from '../cases/business-case-service.js';
import { clockNow } from '../clock.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

/**
 * Individual rights, retention & disposal (BPR-D18). Distinct from FOI
 * (regulatory.ts `foi_request`) — a DSAR/individual-rights request covers
 * GDPR Art. 15-21, broader than FOI's public-authority disclosure regime.
 */

export interface OpenRightsRequestInput {
  personId:              string;
  requestTypeCode:       string;
  statutoryDeadlineDate: string; // ISO date
  ownerId:               string;
}

export interface RecordSearchInput {
  searchedSystem: string;
  recordCount:    number;
}

export interface DecideRightsRequestInput {
  decisionTypeCode: 'granted' | 'partially-granted' | 'refused';
  legalBasis?:       string;
}

export interface IndividualRightsRequestDto {
  individualRightsRequestId: string;
  personId:                  string;
  requestTypeCode:           string;
  statusCode:                string;
  ownerId:                   string;
  receivedAt:                Date;
  statutoryDeadlineDate:     string;
}

export interface RetentionScheduleDto {
  retentionScheduleId:   string;
  entityType:            string;
  retentionPeriodMonths: string;
  triggerEventCode:      string;
  description:           string | null;
}

export interface RetentionAssignmentDto {
  retentionAssignmentId: string;
  retentionScheduleId:   string;
  entityType:             string;
  entityId:               string;
  assignedAt:             Date;
  scheduledDisposalDate:  string | null;
  hasActiveHold:          boolean;
  disposed:               boolean;
}

export class RightsRequestService {
  constructor(
    private readonly db: Db,
    private readonly businessCases: BusinessCaseService,
  ) {}

  async openRequest(tenantId: string, input: OpenRightsRequestInput, actorId: string): Promise<string> {
    const businessCaseId = await this.businessCases.openCase(tenantId, {
      subjectType: 'person',
      subjectId:   input.personId,
      processId:   'BP-08-003',
      statusCode:  'open',
      ownerId:     input.ownerId,
    }, actorId);

    const id = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(individualRightsRequests).values({
        id,
        tenantId:              tenantId as Uuid,
        businessCaseId:        businessCaseId as Uuid,
        personId:              input.personId as Uuid,
        requestTypeCode:       input.requestTypeCode,
        receivedAt:            clockNow(),
        statutoryDeadlineDate: input.statutoryDeadlineDate,
      });
    });
    return id;
  }

  async addScope(tenantId: string, requestId: string, scopeEntityType: string, scopeDescription?: string): Promise<string> {
    const id = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(rightsRequestScopes).values({
        id,
        tenantId:                  tenantId as Uuid,
        individualRightsRequestId: requestId as Uuid,
        scopeEntityType,
        scopeDescription:          scopeDescription ?? null,
      });
    });
    return id;
  }

  async recordSearch(tenantId: string, requestId: string, input: RecordSearchInput): Promise<string> {
    const id = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(rightsSearchManifests).values({
        id,
        tenantId:                  tenantId as Uuid,
        individualRightsRequestId: requestId as Uuid,
        searchedSystem:            input.searchedSystem,
        searchedAt:                clockNow(),
        recordCount:               input.recordCount,
      });
    });
    return id;
  }

  async decide(tenantId: string, requestId: string, input: DecideRightsRequestInput, decidedBy: string): Promise<string> {
    const id = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(rightsDecisions).values({
        id,
        tenantId:                  tenantId as Uuid,
        individualRightsRequestId: requestId as Uuid,
        decisionTypeCode:          input.decisionTypeCode,
        legalBasis:                input.legalBasis ?? null,
        decidedBy,
        decidedAt:                 clockNow(),
      });
    });
    return id;
  }

  async applyRestriction(tenantId: string, personId: string, restrictionTypeCode: string, appliedBy: string, rightsDecisionId?: string): Promise<string> {
    const id = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(processingRestrictions).values({
        id,
        tenantId:            tenantId as Uuid,
        personId:            personId as Uuid,
        rightsDecisionId:    rightsDecisionId ? (rightsDecisionId as Uuid) : null,
        restrictionTypeCode,
        appliedBy,
        appliedAt:           clockNow(),
        liftedAt:            null,
      });
    });
    return id;
  }

  async liftRestriction(tenantId: string, restrictionId: string): Promise<void> {
    await withTenantContext(this.db, tenantId, async (tx) => {
      const existing = await tx.select({ id: processingRestrictions.id }).from(processingRestrictions).where(and(
        eq(processingRestrictions.id,       restrictionId as Uuid),
        eq(processingRestrictions.tenantId, tenantId       as Uuid),
      )).limit(1);
      if (!existing[0]) throw new NotFoundError('ProcessingRestriction', restrictionId);

      await tx.update(processingRestrictions)
        .set({ liftedAt: clockNow() })
        .where(and(
          eq(processingRestrictions.id,       restrictionId as Uuid),
          eq(processingRestrictions.tenantId, tenantId       as Uuid),
        ));
    });
  }

  // ── Retention/disposal (new, prospective; the existing anonymisation
  //    sweep in retention-service.ts is unchanged) ──────────────────────────

  async createSchedule(tenantId: string, entityType: string, retentionPeriodMonths: string, triggerEventCode: string, description?: string): Promise<string> {
    const id = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(retentionSchedules).values({
        id,
        tenantId:              tenantId as Uuid,
        entityType,
        retentionPeriodMonths,
        triggerEventCode,
        description:           description ?? null,
      });
    });
    return id;
  }

  async assignSchedule(tenantId: string, retentionScheduleId: string, entityType: string, entityId: string, scheduledDisposalDate?: string): Promise<string> {
    const id = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(retentionAssignments).values({
        id,
        tenantId:              tenantId as Uuid,
        retentionScheduleId:   retentionScheduleId as Uuid,
        entityType,
        entityId:              entityId as Uuid,
        assignedAt:            clockNow(),
        scheduledDisposalDate: scheduledDisposalDate ?? null,
      });
    });
    return id;
  }

  async placeHold(tenantId: string, retentionAssignmentId: string, holdReasonCode: string, appliedBy: string): Promise<string> {
    const id = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(recordHolds).values({
        id,
        tenantId:              tenantId as Uuid,
        retentionAssignmentId: retentionAssignmentId as Uuid,
        holdReasonCode,
        appliedBy,
        appliedAt:             clockNow(),
        liftedAt:              null,
      });
    });
    return id;
  }

  async recordDisposition(tenantId: string, retentionAssignmentId: string, dispositionTypeCode: string, executedBy: string, evidenceRef?: string): Promise<string> {
    const unliftedHolds = await withTenantContext(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(recordHolds).where(and(
        eq(recordHolds.retentionAssignmentId, retentionAssignmentId as Uuid),
        eq(recordHolds.tenantId,               tenantId               as Uuid),
      ));
      return rows.filter((r) => r.liftedAt === null);
    });
    if (unliftedHolds.length > 0) {
      throw new ValidationError(`Retention assignment '${retentionAssignmentId}' has an active hold; disposition is blocked`);
    }

    const id = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(recordDispositions).values({
        id,
        tenantId:              tenantId as Uuid,
        retentionAssignmentId: retentionAssignmentId as Uuid,
        dispositionTypeCode,
        executedAt:            clockNow(),
        executedBy,
        evidenceRef:           evidenceRef ?? null,
      });
    });
    return id;
  }

  /** Lists individual rights requests, optionally filtered by business-case status. */
  async listRequests(tenantId: string, statusCode?: string): Promise<IndividualRightsRequestDto[]> {
    const businessCaseRows = await this.businessCases.listCasesByProcess(tenantId, 'BP-08-003', statusCode);
    if (businessCaseRows.length === 0) return [];

    const requestRows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(individualRightsRequests).where(and(
        eq(individualRightsRequests.tenantId, tenantId as Uuid),
        inArray(individualRightsRequests.businessCaseId, businessCaseRows.map((r) => r.caseId as Uuid)),
      )),
    );
    const businessCaseById = new Map(businessCaseRows.map((r) => [r.caseId, r]));
    return requestRows
      .map((row) => {
        const bc = businessCaseById.get(row.businessCaseId);
        if (!bc) return null;
        return {
          individualRightsRequestId: row.id,
          personId:                  row.personId,
          requestTypeCode:           row.requestTypeCode,
          statusCode:                bc.statusCode,
          ownerId:                   bc.ownerId,
          receivedAt:                row.receivedAt,
          statutoryDeadlineDate:     row.statutoryDeadlineDate,
        };
      })
      .filter((r): r is IndividualRightsRequestDto => r !== null);
  }

  /** Lists configured retention schedules (reference data, not per-request). */
  async listSchedules(tenantId: string): Promise<RetentionScheduleDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(retentionSchedules).where(eq(retentionSchedules.tenantId, tenantId as Uuid)),
    );
    return rows.map((row) => ({
      retentionScheduleId:   row.id,
      entityType:            row.entityType,
      retentionPeriodMonths: row.retentionPeriodMonths,
      triggerEventCode:      row.triggerEventCode,
      description:           row.description,
    }));
  }

  /** Lists retention assignments, with derived active-hold and disposed status. */
  async listAssignments(tenantId: string, retentionScheduleId?: string): Promise<RetentionAssignmentDto[]> {
    const assignmentRows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(retentionAssignments).where(and(
        eq(retentionAssignments.tenantId, tenantId as Uuid),
        ...(retentionScheduleId ? [eq(retentionAssignments.retentionScheduleId, retentionScheduleId as Uuid)] : []),
      )),
    );
    if (assignmentRows.length === 0) return [];

    const assignmentIds = assignmentRows.map((r) => r.id as Uuid);
    const [holdRows, dispositionRows] = await withTenantContext(this.db, tenantId, async (tx) => Promise.all([
      tx.select().from(recordHolds).where(and(
        eq(recordHolds.tenantId, tenantId as Uuid),
        inArray(recordHolds.retentionAssignmentId, assignmentIds),
      )),
      tx.select({ retentionAssignmentId: recordDispositions.retentionAssignmentId }).from(recordDispositions).where(and(
        eq(recordDispositions.tenantId, tenantId as Uuid),
        inArray(recordDispositions.retentionAssignmentId, assignmentIds),
      )),
    ]));
    const activeHoldByAssignment = new Set(holdRows.filter((h) => h.liftedAt === null).map((h) => h.retentionAssignmentId));
    const disposedAssignments = new Set(dispositionRows.map((d) => d.retentionAssignmentId));

    return assignmentRows.map((row) => ({
      retentionAssignmentId: row.id,
      retentionScheduleId:   row.retentionScheduleId,
      entityType:            row.entityType,
      entityId:              row.entityId,
      assignedAt:            row.assignedAt,
      scheduledDisposalDate: row.scheduledDisposalDate,
      hasActiveHold:         activeHoldByAssignment.has(row.id),
      disposed:              disposedAssignments.has(row.id),
    }));
  }
}
