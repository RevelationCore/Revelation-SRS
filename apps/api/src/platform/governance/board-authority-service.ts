import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import {
  boardMemberConflicts,
  boardQuorumDecisions,
  examBoardDecisions,
  ratificationRecords,
  resultPublications,
  examBoardDataPacks,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError, ValidationError } from '@revelation-srs/domain';

import { clockNow } from '../clock.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

/**
 * Board authority & ratification (BPR-D11). Additive to the existing
 * BoardService — that service still owns pack generation and the
 * lock-triggering ratifyBoard action. This service records the structured
 * decision chain (conflicts, quorum decision, board decision, ratification
 * record, publication lifecycle) that proves exactly what a ratification
 * was based on, without changing the existing ratify/lock semantics.
 */

export interface DeclareConflictInput {
  enrolmentId?:      string;
  conflictTypeCode:  string;
}

export interface RecordQuorumDecisionInput {
  requiredCount:  number;
  attendingCount: number;
}

export interface RecordBoardDecisionInput {
  dataPackId:        string;
  decisionTypeCode:  string;
  rationale?:        string;
}

export class BoardAuthorityService {
  constructor(private readonly db: Db) {}

  async declareConflict(tenantId: string, examBoardId: string, input: DeclareConflictInput, actorId: string): Promise<string> {
    const conflictId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(boardMemberConflicts).values({
        id:                conflictId,
        tenantId:          tenantId as Uuid,
        examBoardId:       examBoardId as Uuid,
        actorId,
        enrolmentId:       input.enrolmentId ? (input.enrolmentId as Uuid) : null,
        conflictTypeCode:  input.conflictTypeCode,
        declaredAt:        clockNow(),
        recusedAt:         null,
      });
    });
    return conflictId;
  }

  async recuseMember(tenantId: string, conflictId: string): Promise<void> {
    await withTenantContext(this.db, tenantId, async (tx) => {
      const existing = await tx.select({ id: boardMemberConflicts.id }).from(boardMemberConflicts).where(and(
        eq(boardMemberConflicts.id,       conflictId as Uuid),
        eq(boardMemberConflicts.tenantId, tenantId    as Uuid),
      )).limit(1);
      if (!existing[0]) throw new NotFoundError('BoardMemberConflict', conflictId);

      await tx.update(boardMemberConflicts)
        .set({ recusedAt: clockNow() })
        .where(and(
          eq(boardMemberConflicts.id,       conflictId as Uuid),
          eq(boardMemberConflicts.tenantId, tenantId    as Uuid),
        ));
    });
  }

  async recordQuorumDecision(tenantId: string, examBoardId: string, input: RecordQuorumDecisionInput, decidedBy: string): Promise<string> {
    const id = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(boardQuorumDecisions).values({
        id,
        tenantId:        tenantId as Uuid,
        examBoardId:     examBoardId as Uuid,
        requiredCount:   input.requiredCount,
        attendingCount:  input.attendingCount,
        quorumMet:       input.attendingCount >= input.requiredCount,
        decidedBy,
        decidedAt:       clockNow(),
      });
    });
    return id;
  }

  async recordBoardDecision(tenantId: string, examBoardId: string, input: RecordBoardDecisionInput, decidedBy: string): Promise<string> {
    const packRows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ id: examBoardDataPacks.id }).from(examBoardDataPacks).where(and(
        eq(examBoardDataPacks.id,       input.dataPackId as Uuid),
        eq(examBoardDataPacks.tenantId, tenantId          as Uuid),
      )).limit(1),
    );
    if (!packRows[0]) throw new NotFoundError('ExamBoardDataPack', input.dataPackId);

    const decisionId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(examBoardDecisions).values({
        id:                decisionId,
        tenantId:          tenantId as Uuid,
        examBoardId:       examBoardId as Uuid,
        dataPackId:        input.dataPackId as Uuid,
        decisionTypeCode:  input.decisionTypeCode,
        decidedBy,
        decidedAt:         clockNow(),
        rationale:         input.rationale ?? null,
      });
    });
    return decisionId;
  }

  async createRatificationRecord(tenantId: string, examBoardDecisionId: string, ratifiedBy: string): Promise<string> {
    const decisionRows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(examBoardDecisions).where(and(
        eq(examBoardDecisions.id,       examBoardDecisionId as Uuid),
        eq(examBoardDecisions.tenantId, tenantId             as Uuid),
      )).limit(1),
    );
    const decision = decisionRows[0];
    if (!decision) throw new NotFoundError('ExamBoardDecision', examBoardDecisionId);
    if (decision.decisionTypeCode !== 'ratify') {
      throw new ValidationError(`Only a 'ratify' decision can produce a ratification record; decision is '${decision.decisionTypeCode}'`);
    }

    const recordId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(ratificationRecords).values({
        id:                    recordId,
        tenantId:              tenantId as Uuid,
        examBoardDecisionId:   examBoardDecisionId as Uuid,
        examBoardId:           decision.examBoardId,
        ratifiedAt:            clockNow(),
        ratifiedBy,
      });

      await tx.insert(resultPublications).values({
        id:                     randomUUID(),
        tenantId:               tenantId as Uuid,
        ratificationRecordId:   recordId as Uuid,
        statusCode:             'locked',
        publishedAt:            null,
        publishedBy:            null,
      });
    });
    return recordId;
  }

  async publishResults(tenantId: string, ratificationRecordId: string, publishedBy: string): Promise<void> {
    await withTenantContext(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(resultPublications).where(and(
        eq(resultPublications.ratificationRecordId, ratificationRecordId as Uuid),
        eq(resultPublications.tenantId,              tenantId              as Uuid),
      )).limit(1);
      const publication = rows[0];
      if (!publication) throw new NotFoundError('ResultPublication', ratificationRecordId);
      if (publication.statusCode !== 'locked') {
        throw new ValidationError(`Result publication is '${publication.statusCode}', not 'locked'`);
      }

      await tx.update(resultPublications)
        .set({ statusCode: 'published', publishedAt: clockNow(), publishedBy })
        .where(eq(resultPublications.id, publication.id));
    });
  }
}
