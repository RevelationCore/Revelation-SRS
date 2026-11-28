import { randomUUID } from 'node:crypto';

import {
  identityMerges,
  identityRedirects,
  identityUnmergeCases,
  personIdentifierAliases,
  persons,
  type Db,
  type IdentityMerge,
  type IdentityUnmergeCase,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, DomainError, EVENT_TYPES, NotFoundError, ValidationError, type PersonUnmergedV1Payload } from '@revelation-srs/domain';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { AuditService } from '../audit/service.js';
import type { BusinessCaseService } from '../cases/business-case-service.js';
import { clockNow } from '../clock.js';
import type { DeliveryService } from '../delivery/delivery-service.js';
import { requestPostUnmergeSnapshots, requestUnmergeNotices, type MergeNoticePlan, type UnmergeForNotices } from '../delivery/producers/merge-notices.js';
import { enqueueWorkflowEvent } from '../platform-controls/workflow-event-outbox.js';

import { postMergeRecords, reverseMoves, type PostMergeRecord } from './person-merge.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export interface UnmergeActor { sub: string; srsPersonId?: string | undefined }

export interface UnmergeCaseDto {
  unmergeCaseId: string;
  mergeId: string;
  survivorPersonId: string;
  restoredPersonId: string;
  statusCode: string;
  proposalVersion: number;
  allocations: Record<string, 'survivor' | 'restored'>;
  /** Records created on the survivor since the merge, for the proposal to allocate. */
  postMergeRecords: PostMergeRecord[];
  openedBy: string;
  proposedBy: string | null;
  decidedBy: string | null;
}

class UnmergeNotAllowedError extends DomainError {
  constructor(message: string) {
    super(message, 'unmerge-not-allowed', 422);
    this.name = 'UnmergeNotAllowedError';
  }
}

const separation = (message: string) => new DomainError(message, 'separation-of-duties', 403);

/**
 * Unmerge (ADR-031 item 10, BL-359): a governed case of its own. One officer
 * opens it and proposes where the records created since the merge go; another
 * decides, on the proposal version they read. The decision reverses the
 * merge's recorded moves, removes its identifier aliases, restores the
 * person, ends the redirect, and tells the modules (srs.person.unmerged),
 * the delivery ledger and IAM, in one transaction.
 */
export class IdentityUnmergeService {
  constructor(
    private readonly db: Db,
    private readonly businessCases: BusinessCaseService,
    private readonly audit?: AuditService,
    private readonly delivery?: DeliveryService,
  ) {}

  async openCase(tenantId: string, mergeId: string, actor: UnmergeActor): Promise<string> {
    const merge = await this.#merge(tenantId, mergeId);
    if (merge.unmergedAt) throw new ConflictError('This merge has already been reversed');
    const businessCaseId = await this.businessCases.openCase(tenantId, {
      subjectType: 'person', subjectId: merge.survivorPersonId, processId: 'BP-08-001', statusCode: 'open', ownerId: actor.sub,
    }, actor.sub);
    const id = randomUUID();
    try {
      await withTenantContext(this.db, tenantId, (tx) => tx.insert(identityUnmergeCases).values({
        id, tenantId: tenantId as Uuid, mergeId: mergeId as Uuid, businessCaseId: businessCaseId as Uuid, openedBy: actor.sub,
      }));
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('This merge already has an unmerge case open');
      throw err;
    }
    return id;
  }

  async getCase(tenantId: string, caseId: string): Promise<UnmergeCaseDto> {
    const kase = await this.#case(tenantId, caseId);
    const merge = await this.#merge(tenantId, kase.mergeId);
    const records = await withTenantContext(this.db, tenantId, (tx) => postMergeRecords(tx, {
      tenantId, mergeId: merge.id, survivorPersonId: merge.survivorPersonId, effectiveAt: merge.effectiveAt,
    }));
    return {
      unmergeCaseId: kase.id, mergeId: merge.id, survivorPersonId: merge.survivorPersonId, restoredPersonId: merge.mergedPersonId,
      statusCode: kase.statusCode, proposalVersion: kase.proposalVersion, allocations: kase.allocations, postMergeRecords: records,
      openedBy: kase.openedBy, proposedBy: kase.proposedBy, decidedBy: kase.decidedBy,
    };
  }

  /** Each listed post-merge record goes to 'survivor' (the default) or 'restored'; a new version each time. */
  async propose(tenantId: string, caseId: string, allocations: Record<string, 'survivor' | 'restored'>, actor: UnmergeActor): Promise<UnmergeCaseDto> {
    const kase = await this.#case(tenantId, caseId);
    if (kase.statusCode !== 'open' && kase.statusCode !== 'proposed') throw new ConflictError(`This unmerge case is already ${kase.statusCode}`);
    const current = await this.getCase(tenantId, caseId);
    const known = new Set(current.postMergeRecords.map((r) => r.key));
    for (const [key, to] of Object.entries(allocations)) {
      if (!known.has(key)) throw new ValidationError(`'${key}' is not a record created on the survivor since the merge`, [{ field: 'allocations', message: 'Allocate only the listed post-merge records' }]);
      if (to !== 'survivor' && to !== 'restored') throw new ValidationError(`Allocation for '${key}' must be survivor or restored`);
    }
    await withTenantContext(this.db, tenantId, (tx) => tx.update(identityUnmergeCases).set({
      allocations, statusCode: 'proposed', proposalVersion: sql`${identityUnmergeCases.proposalVersion} + 1`, proposedBy: actor.sub, proposedAt: clockNow(),
    }).where(and(eq(identityUnmergeCases.tenantId, tenantId as Uuid), eq(identityUnmergeCases.id, caseId as Uuid))));
    return this.getCase(tenantId, caseId);
  }

  async decide(tenantId: string, caseId: string, input: { decisionTypeCode: 'unmerge' | 'reject'; proposalVersion?: number; reason: string }, actor: UnmergeActor): Promise<UnmergeCaseDto> {
    const kase = await this.#case(tenantId, caseId);
    if (kase.statusCode !== 'open' && kase.statusCode !== 'proposed') throw new ConflictError(`This unmerge case is already ${kase.statusCode}`);
    const merge = await this.#merge(tenantId, kase.mergeId);
    // P-22: whoever prepared the case does not decide it, and no one decides about their own record.
    if ([kase.openedBy, kase.proposedBy].includes(actor.sub)) throw separation('An unmerge is decided by someone who did not open the case or write the proposal');
    if (actor.srsPersonId && [merge.survivorPersonId, merge.mergedPersonId].includes(actor.srsPersonId)) throw separation('No one may decide an unmerge about their own record');
    if (!input.reason.trim()) throw new ValidationError('A decision needs a reason');
    const decided = { decidedBy: actor.sub, decidedAt: clockNow(), decisionReason: input.reason.trim() };

    if (input.decisionTypeCode === 'reject') {
      await withTenantContext(this.db, tenantId, (tx) => tx.update(identityUnmergeCases).set({ statusCode: 'rejected', ...decided })
        .where(eq(identityUnmergeCases.id, kase.id)));
      return this.getCase(tenantId, caseId);
    }
    if (kase.statusCode !== 'proposed') throw new ConflictError('There is no proposal to decide on yet');
    if (input.proposalVersion !== kase.proposalVersion) {
      throw new DomainError(`The proposal is now version ${kase.proposalVersion}; read it again before deciding`, 'proposal-changed', 409);
    }
    if (merge.unmergedAt) throw new ConflictError('This merge has already been reversed');

    const now = clockNow();
    let notices: { unmerge: UnmergeForNotices; plan: MergeNoticePlan } | null = null;
    let enrolmentIds: string[] = [];
    await withTenantContext(this.db, tenantId, async (tx) => {
      const [restored] = await tx.select({ anonymisedAt: persons.retentionAnonymisedAt }).from(persons)
        .where(and(eq(persons.tenantId, tenantId as Uuid), eq(persons.id, merge.mergedPersonId as Uuid))).limit(1);
      if (!restored) throw new UnmergeNotAllowedError('The merged person no longer exists');
      if (restored.anonymisedAt) throw new UnmergeNotAllowedError('The merged person has been anonymised since the merge, so the records cannot be restored to them');

      const records = await postMergeRecords(tx, { tenantId, mergeId: merge.id, survivorPersonId: merge.survivorPersonId, effectiveAt: merge.effectiveAt });
      const toRestored = records.filter((r) => kase.allocations[r.key] === 'restored');
      const reallocated = await reverseMoves(tx, {
        tenantId, mergeId: merge.id, survivorPersonId: merge.survivorPersonId, restoredPersonId: merge.mergedPersonId, toRestored, now,
      });

      await tx.delete(personIdentifierAliases).where(and(eq(personIdentifierAliases.tenantId, tenantId as Uuid), eq(personIdentifierAliases.decisionId, merge.decisionId)));
      await tx.update(persons).set({ personStatusCode: merge.mergedPersonStatusCode ?? 'prospective' })
        .where(and(eq(persons.tenantId, tenantId as Uuid), eq(persons.id, merge.mergedPersonId as Uuid)));
      // Tokens and staff routes resolve to the restored person again on the next request.
      await tx.update(identityRedirects).set({ endedAt: now, endedByMergeId: merge.id })
        .where(and(eq(identityRedirects.tenantId, tenantId as Uuid), eq(identityRedirects.mergeId, merge.id), isNull(identityRedirects.endedAt)));
      await tx.update(identityMerges).set({ unmergedAt: now, unmergeDecisionId: kase.id }).where(eq(identityMerges.id, merge.id));
      await tx.update(identityUnmergeCases).set({ statusCode: 'unmerged', ...decided }).where(eq(identityUnmergeCases.id, kase.id));

      const payload: PersonUnmergedV1Payload = {
        mergeId: merge.id, survivorPersonId: merge.survivorPersonId, restoredPersonId: merge.mergedPersonId,
        effectiveAt: now.toISOString(), reallocatedToRestored: reallocated,
      };
      await enqueueWorkflowEvent(tx, {
        tenantId, eventType: EVENT_TYPES.PERSON_UNMERGED, correlationId: kase.id, dataClassification: 'personal',
        payload: payload as unknown as Record<string, unknown>,
      });
      const unmerge: UnmergeForNotices = { mergeId: merge.id, survivorPersonId: merge.survivorPersonId, restoredPersonId: merge.mergedPersonId, effectiveAt: now };
      if (this.delivery) notices = { unmerge, plan: await requestUnmergeNotices(this.delivery, tx, tenantId, unmerge) };
      enrolmentIds = (await tx.execute(sql`SELECT DISTINCT row_key FROM identity_merge_move WHERE merge_id = ${merge.id}::uuid AND table_name = 'enrolment'`) as unknown as Array<{ row_key: string }>).map((r) => r.row_key);
      enrolmentIds.push(...(reallocated['enrolment'] ?? []));

      await this.audit?.record({
        tenantId, entityType: 'identity-merge', entityId: merge.id, actionType: 'update', actorType: 'user', actorId: actor.sub,
        fieldName: 'unmerged_at', afterValue: now.toISOString(),
        reasonText: `Unmerged ${merge.mergedPersonId} from ${merge.survivorPersonId} (case ${kase.id}): ${input.reason.trim()}`,
      }, tx);
    });

    if (notices && this.delivery) {
      const { unmerge, plan } = notices as { unmerge: UnmergeForNotices; plan: MergeNoticePlan };
      await requestPostUnmergeSnapshots(this.delivery, this.db, tenantId, unmerge, plan, [...new Set(enrolmentIds)]);
    }
    return this.getCase(tenantId, caseId);
  }

  async #case(tenantId: string, id: string): Promise<IdentityUnmergeCase> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(identityUnmergeCases)
      .where(and(eq(identityUnmergeCases.tenantId, tenantId as Uuid), eq(identityUnmergeCases.id, id as Uuid))).limit(1));
    if (!row) throw new NotFoundError('IdentityUnmergeCase', id);
    return row;
  }

  async #merge(tenantId: string, id: string): Promise<IdentityMerge> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(identityMerges)
      .where(and(eq(identityMerges.tenantId, tenantId as Uuid), inArray(identityMerges.id, [id as Uuid]))).limit(1));
    if (!row) throw new NotFoundError('IdentityMerge', id);
    return row;
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
