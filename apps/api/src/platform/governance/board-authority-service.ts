import { randomUUID } from 'node:crypto';

import { and, asc, eq } from 'drizzle-orm';
import {
  boardMemberConflicts,
  boardQuorumDecisions,
  examBoardCandidateProfiles,
  examBoardDecisions,
  examBoards,
  ratificationRecords,
  resultPublications,
  examBoardDataPacks,
  ruleManifests,
  tenants,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@revelation-srs/domain';

import { canonicalHash } from '../canonical-hash.js';
import { clockNow } from '../clock.js';

import { packHash, type RuleManifestContent } from './pack-evidence.js';

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
  /** The hash of the pack the decider was shown (D-36). */
  packHash:          string;
  decisionTypeCode:  string;
  rationale?:        string;
}

export interface PackVerification {
  dataPackId: string;
  storedHash: string | null;
  recomputedHash: string | null;
  status: 'verified' | 'mismatch' | 'unhashed';
  superseded: boolean;
  supersededById: string | null;
  ruleManifestRef: string | null;
  manifestHashMatches: boolean | null;
  drift: Array<{ versionId: string; ruleTypeCode: string }>;
  decisions: Array<{ decisionId: string; decisionTypeCode: string; packHash: string | null; matches: boolean; decidedAt: Date }>;
  ratifiedAgainst: { dataPackId: string | null; packHash: string | null } | null;
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

  /**
   * Records a board decision on a data pack (D-36). The decision names the
   * hash of the pack the board was shown: it must be this board's current
   * pack, with that hash. With examBoard.pack.blockOnRuleDrift, a pack whose
   * calculations cite superseded rule versions cannot be decided.
   */
  async recordBoardDecision(tenantId: string, examBoardId: string, input: RecordBoardDecisionInput, decidedBy: string): Promise<string> {
    const [pack] = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(examBoardDataPacks).where(and(
        eq(examBoardDataPacks.id,       input.dataPackId as Uuid),
        eq(examBoardDataPacks.tenantId, tenantId          as Uuid),
      )).limit(1),
    );
    if (!pack) throw new NotFoundError('ExamBoardDataPack', input.dataPackId);
    if (pack.examBoardId !== examBoardId) throw new ConflictError('This data pack belongs to another exam board');
    if (pack.supersededById) throw new ConflictError('This data pack has been superseded by a newer one; decide on the current pack');
    if (!pack.packHash || pack.packHash !== input.packHash) {
      throw new ConflictError('The data pack has changed since it was shown; reload it before deciding');
    }
    if (await this.#blocksOnDrift(tenantId)) {
      const manifest = await this.#manifest(tenantId, pack.ruleManifestRef);
      if (manifest && manifest.drift.length > 0) {
        throw new ConflictError(`The pack's calculations cite ${manifest.drift.length} rule version(s) no longer in force; recalculate and regenerate the pack`);
      }
    }

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
        packHash:          pack.packHash,
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
    // Separation of duties (BL-065): whoever recorded the board's decision cannot also ratify it.
    if (decision.decidedBy === ratifiedBy) {
      throw new ForbiddenError('You recorded the board\'s decision, so someone else must ratify it');
    }
    if (decision.decisionTypeCode !== 'ratify') {
      throw new ValidationError(`Only a 'ratify' decision can produce a ratification record; decision is '${decision.decisionTypeCode}'`);
    }
    const [pack] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ supersededById: examBoardDataPacks.supersededById })
      .from(examBoardDataPacks).where(and(eq(examBoardDataPacks.tenantId, tenantId as Uuid), eq(examBoardDataPacks.id, decision.dataPackId))).limit(1));
    if (pack?.supersededById) throw new ConflictError('The data pack this decision was made on has since been superseded; decide on the current pack');

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
        ratificationRecordId:   recordId,
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

  /**
   * Recomputes a pack's hash from its stored rows (D-36) and checks its
   * manifest and the decisions made on it.
   */
  async verifyDataPack(tenantId: string, examBoardId: string, dataPackId: string): Promise<PackVerification> {
    const [pack] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(examBoardDataPacks).where(and(
      eq(examBoardDataPacks.tenantId, tenantId as Uuid), eq(examBoardDataPacks.id, dataPackId as Uuid), eq(examBoardDataPacks.examBoardId, examBoardId as Uuid),
    )).limit(1));
    if (!pack) throw new NotFoundError('ExamBoardDataPack', dataPackId);
    const [profiles, decisions, board, manifestRow] = await withTenantContext(this.db, tenantId, async (tx) => [
      await tx.select().from(examBoardCandidateProfiles).where(and(eq(examBoardCandidateProfiles.tenantId, tenantId as Uuid), eq(examBoardCandidateProfiles.dataPackId, pack.id))),
      await tx.select().from(examBoardDecisions).where(and(eq(examBoardDecisions.tenantId, tenantId as Uuid), eq(examBoardDecisions.dataPackId, pack.id))).orderBy(asc(examBoardDecisions.decidedAt)),
      (await tx.select({ ratifiedDataPackId: examBoards.ratifiedDataPackId, ratifiedPackHash: examBoards.ratifiedPackHash, ratifiedAt: examBoards.ratifiedAt })
        .from(examBoards).where(and(eq(examBoards.tenantId, tenantId as Uuid), eq(examBoards.id, examBoardId as Uuid))).limit(1))[0],
      pack.ruleManifestRef
        ? (await tx.select().from(ruleManifests).where(and(eq(ruleManifests.tenantId, tenantId as Uuid), eq(ruleManifests.manifestHash, pack.ruleManifestRef))).limit(1))[0]
        : undefined,
    ] as const);
    const recomputed = pack.packHash ? packHash({
      tenantId, examBoardId, dataPackId: pack.id, packVersion: pack.packVersion, sourceTransactionTime: pack.sourceTransactionTime,
      ruleManifestRef: pack.ruleManifestRef,
      candidates: profiles.map((p) => ({ enrolmentId: p.enrolmentId, personId: p.personId, profileData: p.profileData })),
    }) : null;
    const manifest = manifestRow?.content as RuleManifestContent | undefined;
    return {
      dataPackId: pack.id,
      storedHash: pack.packHash,
      recomputedHash: recomputed,
      status: !pack.packHash ? 'unhashed' : recomputed === pack.packHash ? 'verified' : 'mismatch',
      superseded: pack.supersededById !== null,
      supersededById: pack.supersededById,
      ruleManifestRef: pack.ruleManifestRef,
      manifestHashMatches: manifestRow ? canonicalHash(manifestRow.content) === pack.ruleManifestRef : null,
      drift: manifest?.drift ?? [],
      decisions: decisions.map((d) => ({ decisionId: d.id, decisionTypeCode: d.decisionTypeCode, packHash: d.packHash, matches: d.packHash !== null && d.packHash === pack.packHash, decidedAt: d.decidedAt })),
      ratifiedAgainst: board?.ratifiedAt ? { dataPackId: board.ratifiedDataPackId, packHash: board.ratifiedPackHash } : null,
    };
  }

  /** A pack's rule manifest content (D-36). */
  async getRuleManifest(tenantId: string, examBoardId: string, dataPackId: string): Promise<{ manifestHash: string; content: RuleManifestContent }> {
    const [pack] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(examBoardDataPacks).where(and(
      eq(examBoardDataPacks.tenantId, tenantId as Uuid), eq(examBoardDataPacks.id, dataPackId as Uuid), eq(examBoardDataPacks.examBoardId, examBoardId as Uuid),
    )).limit(1));
    if (!pack) throw new NotFoundError('ExamBoardDataPack', dataPackId);
    const content = await this.#manifest(tenantId, pack.ruleManifestRef);
    if (!content || !pack.ruleManifestRef) throw new NotFoundError('RuleManifest', dataPackId);
    return { manifestHash: pack.ruleManifestRef, content };
  }

  async #manifest(tenantId: string, ref: string | null): Promise<RuleManifestContent | null> {
    if (!ref) return null;
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(ruleManifests)
      .where(and(eq(ruleManifests.tenantId, tenantId as Uuid), eq(ruleManifests.manifestHash, ref))).limit(1));
    return (row?.content as RuleManifestContent | undefined) ?? null;
  }

  async #blocksOnDrift(tenantId: string): Promise<boolean> {
    const [row] = await this.db.select({ configuration: tenants.configuration }).from(tenants).where(eq(tenants.id, tenantId as Uuid)).limit(1);
    const examBoard = (row?.configuration?.['examBoard'] ?? {}) as Record<string, unknown>;
    const pack = (examBoard['pack'] ?? {}) as Record<string, unknown>;
    return pack['blockOnRuleDrift'] === true;
  }
}
