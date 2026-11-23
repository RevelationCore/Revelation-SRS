import { randomUUID } from 'node:crypto';

import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import {
  businessCases,
  deliveryItems,
  enrolments,
  identityMergeProposals,
  identityMerges,
  identityResolutionCases,
  identityResolutionCandidates,
  identityResolutionDecisions,
  personIdentifierAliases,
  personIdentityLinks,
  identityRedirects,
  dataCorrectionCases,
  persons,
  processingRestrictions,
  type Db,
  type IdentityMergeProposal,
  type TenantScopedDb,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, DomainError, EVENT_TYPES, ForbiddenError, NotFoundError, ValidationError, type PersonMergedV1Payload } from '@revelation-srs/domain';

import type { AuditService } from '../audit/service.js';
import type { DeliveryService } from '../delivery/delivery-service.js';
import { requestMergeNotices, requestPostMergeSnapshots, type MergeForNotices, type MergeNoticePlan } from '../delivery/producers/merge-notices.js';
import type { BusinessCaseService } from '../cases/business-case-service.js';
import { clockNow } from '../clock.js';
import { enqueueWorkflowEvent } from '../platform-controls/workflow-event-outbox.js';

import { moveToSurvivor } from './person-merge.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

/**
 * Identity resolution & correction case (BPR-D17). Candidate generation
 * only — a decision is never derived automatically from a match score; it
 * always requires an explicit `decide()` call from an authorised actor.
 */

export interface OpenResolutionCaseInput {
  subjectPersonId: string;
  ownerId:         string;
}

export interface AddCandidateInput {
  candidatePersonId: string;
  matchScore:        number;
  matchReasonCode:   string;
}

export interface DecideInput {
  decisionTypeCode: 'merge' | 'reject' | 'link';
  /** The proposal version the decider read; required for merge and link (ADR-031 item 3). */
  proposalVersion?: number;
  reason:           string;
}

/** The acting user, from the token (P-23). */
export interface IdentityActor { sub: string; srsPersonId?: string | undefined }

export interface ProposalInput {
  survivorPersonId:       string;
  mergedPersonId:         string;
  factChoices?:           Record<string, 'survivor' | 'merged'>;
  identifierResolutions?: Record<string, { keep: 'survivor' | 'merged'; reason: string }>;
  twoAccountsConfirmed?:  boolean;
}

export interface ProposalDto {
  proposalId: string; version: number; survivorPersonId: string; mergedPersonId: string;
  factChoices: Record<string, 'survivor' | 'merged'>;
  identifierResolutions: Record<string, { keep: 'survivor' | 'merged'; reason: string }>;
  twoAccountsConfirmed: boolean; proposedBy: string; proposedAt: string;
  /** Statutory identifier classes whose values differ between the two people. */
  identifierConflicts: IdentifierConflict[];
}

export interface IdentifierConflict { identifierClass: string; survivorValues: string[]; mergedValues: string[]; resolved: boolean }

export type MergeRefusal = 'not-a-candidate' | 'same-person' | 'already-merged' | 'anonymised' | 'restricted' | 'identifier-conflict' | 'two-accounts-unconfirmed';

/** 422: the merge (or link) the proposal describes is not allowed (ADR-031 item 3). */
export class MergeNotAllowedError extends DomainError {
  readonly fields: { reasonCode: MergeRefusal };
  constructor(public readonly reasonCode: MergeRefusal, message: string) {
    super(message, 'merge-not-allowed', 422);
    this.name = 'MergeNotAllowedError';
    this.fields = { reasonCode };
  }
}

/** Fact classes that hold one row per person, which the proposal chooses between. */
const FACT_CLASSES = ['person-identity', 'regulatory-profile'] as const;
/** Statutory identifier classes (ADR-031 item 4); uln and slc-customer-reference have no column yet. */
export const STATUTORY_IDENTIFIER_CLASSES = ['husid', 'ucas-personal-id', 'uln', 'slc-customer-reference'] as const;

export interface IdentityResolutionCaseDto {
  identityResolutionCaseId: string;
  subjectPersonId: string;
  statusCode:      string;
  ownerId:         string;
  createdAt:       Date;
}

export interface DataCorrectionCaseDto {
  dataCorrectionCaseId: string;
  personId:             string;
  correctedEntityType:  string;
  correctedFieldName:   string;
  statusCode:           string;
  ownerId:              string;
  createdAt:            Date;
}

export class IdentityResolutionService {
  constructor(
    private readonly db: Db,
    private readonly businessCases: BusinessCaseService,
    private readonly audit?: AuditService,
    private readonly delivery?: DeliveryService,
  ) {}

  async openCase(tenantId: string, input: OpenResolutionCaseInput, actorId: string): Promise<string> {
    const businessCaseId = await this.businessCases.openCase(tenantId, {
      subjectType: 'person',
      subjectId:   input.subjectPersonId,
      processId:   'BP-08-001',
      statusCode:  'open',
      ownerId:     input.ownerId,
    }, actorId);

    const caseId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(identityResolutionCases).values({
        id:             caseId,
        tenantId:       tenantId as Uuid,
        businessCaseId: businessCaseId as Uuid,
        createdAt:      clockNow(),
      });
    });
    return caseId;
  }

  async addCandidate(tenantId: string, identityResolutionCaseId: string, input: AddCandidateInput, actorId: string): Promise<string> {
    await this.#ensureCaseExists(tenantId, identityResolutionCaseId);

    const id = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(identityResolutionCandidates).values({
        id,
        tenantId:                 tenantId as Uuid,
        identityResolutionCaseId: identityResolutionCaseId as Uuid,
        candidatePersonId:        input.candidatePersonId as Uuid,
        matchScore:               input.matchScore.toFixed(4),
        matchReasonCode:          input.matchReasonCode,
        addedBy:                  actorId,
        createdAt:                clockNow(),
      });
    });
    return id;
  }

  /** A new version of the case's merge proposal; earlier versions are kept (ADR-031 item 3). */
  async putProposal(tenantId: string, caseId: string, input: ProposalInput, actorId: string): Promise<ProposalDto> {
    await this.#ensureCaseExists(tenantId, caseId);
    for (const k of Object.keys(input.factChoices ?? {})) if (!(FACT_CLASSES as readonly string[]).includes(k)) throw new ValidationError(`Unknown fact class '${k}'`);
    for (const k of Object.keys(input.identifierResolutions ?? {})) if (!(STATUTORY_IDENTIFIER_CLASSES as readonly string[]).includes(k)) throw new ValidationError(`Unknown identifier class '${k}'`);
    if (input.survivorPersonId === input.mergedPersonId) throw new MergeNotAllowedError('same-person', 'A merge is between two different people');
    const id = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      const [latest] = await tx.select({ version: identityMergeProposals.version }).from(identityMergeProposals)
        .where(eq(identityMergeProposals.identityResolutionCaseId, caseId as Uuid)).orderBy(desc(identityMergeProposals.version)).limit(1);
      await tx.insert(identityMergeProposals).values({
        id, tenantId: tenantId as Uuid, identityResolutionCaseId: caseId as Uuid, version: (latest?.version ?? 0) + 1,
        survivorPersonId: input.survivorPersonId as Uuid, mergedPersonId: input.mergedPersonId as Uuid,
        factChoices: input.factChoices ?? {}, identifierResolutions: input.identifierResolutions ?? {},
        twoAccountsConfirmed: input.twoAccountsConfirmed ?? false, proposedBy: actorId, proposedAt: clockNow(),
      });
    });
    return (await this.getProposal(tenantId, caseId))!;
  }

  async getProposal(tenantId: string, caseId: string): Promise<ProposalDto | null> {
    return withTenantContext(this.db, tenantId, async (tx) => {
      const p = await currentProposal(tx, caseId);
      if (!p) return null;
      return toProposalDto(p, await identifierConflicts(tx, tenantId, p));
    });
  }

  /**
   * Records an explicit decision (ADR-031). Never derived from a match score.
   * The decider is neither the case's opener, nor anyone who added a
   * candidate or wrote the proposal, nor either person in the case. A merge
   * or link names the current proposal version and passes every check; a
   * merge then creates the merged-into link and the redirect in the same
   * transaction (moving records to the survivor is ADR-031 item 5, BL-355).
   */
  async decide(tenantId: string, identityResolutionCaseId: string, input: DecideInput, actor: IdentityActor): Promise<string> {
    await this.#ensureCaseExists(tenantId, identityResolutionCaseId);
    const decisionId = randomUUID();
    let executed: { merge: MergeForNotices; plan: MergeNoticePlan } | null = null;
    await withTenantContext(this.db, tenantId, async (tx) => {
      const [kase] = await tx.select({ subjectId: businessCases.subjectId, openedBy: businessCases.actorId })
        .from(identityResolutionCases)
        .innerJoin(businessCases, eq(businessCases.id, identityResolutionCases.businessCaseId))
        .where(eq(identityResolutionCases.id, identityResolutionCaseId as Uuid)).limit(1);
      const candidates = await tx.select({ personId: identityResolutionCandidates.candidatePersonId, addedBy: identityResolutionCandidates.addedBy })
        .from(identityResolutionCandidates).where(eq(identityResolutionCandidates.identityResolutionCaseId, identityResolutionCaseId as Uuid));
      const proposal = await currentProposal(tx, identityResolutionCaseId);

      const preparers = new Set([kase?.openedBy, ...candidates.map((c) => c.addedBy), proposal?.proposedBy].filter((x): x is string => Boolean(x)));
      if (preparers.has(actor.sub)) throw new ForbiddenError('A merge decision is taken by someone who did not open the case, add a candidate or write the proposal');
      const people = new Set([kase?.subjectId, ...candidates.map((c) => c.personId)].filter(Boolean));
      if (actor.srsPersonId && people.has(actor.srsPersonId)) throw new ForbiddenError('No one may decide a case about their own record');

      if (input.decisionTypeCode !== 'reject') {
        if (!proposal) throw new ConflictError('There is no proposal to decide on yet');
        if (input.proposalVersion !== proposal.version) {
          throw new DomainError(`The proposal is now version ${proposal.version}; read it again before deciding`, 'proposal-changed', 409);
        }
        const pair = [proposal.survivorPersonId, proposal.mergedPersonId];
        const subject = kase?.subjectId;
        if (!subject || !pair.includes(subject) || !candidates.some((c) => pair.includes(c.personId) && c.personId !== subject)) {
          throw new MergeNotAllowedError('not-a-candidate', 'The proposal must pair the case subject with one of its candidates');
        }
        if (input.decisionTypeCode === 'merge') await assertMergeAllowed(tx, tenantId, proposal);
      }

      await tx.insert(identityResolutionDecisions).values({
        id:                       decisionId,
        tenantId:                 tenantId as Uuid,
        identityResolutionCaseId: identityResolutionCaseId as Uuid,
        decisionTypeCode:         input.decisionTypeCode,
        survivorPersonId:         input.decisionTypeCode === 'merge' && proposal ? proposal.survivorPersonId : null,
        decidedBy:                actor.sub,
        decidedAt:                clockNow(),
        proposalId:               input.decisionTypeCode === 'reject' ? null : proposal?.id ?? null,
        reason:                   input.reason,
      });

      if (input.decisionTypeCode === 'link' && proposal) {
        await tx.insert(personIdentityLinks).values({
          id: randomUUID(), tenantId: tenantId as Uuid, sourcePersonId: proposal.mergedPersonId, targetPersonId: proposal.survivorPersonId,
          linkTypeCode: 'related-record', createdAt: clockNow(),
        });
      }
      if (input.decisionTypeCode === 'merge' && proposal) {
        const now = clockNow();
        const mergeId = randomUUID();
        await tx.insert(personIdentityLinks).values({
          id: randomUUID(), tenantId: tenantId as Uuid, sourcePersonId: proposal.mergedPersonId, targetPersonId: proposal.survivorPersonId,
          linkTypeCode: 'merged-into', createdAt: now,
        });
        const [before] = await tx.select({ status: persons.personStatusCode }).from(persons)
          .where(and(eq(persons.tenantId, tenantId as Uuid), eq(persons.id, proposal.mergedPersonId as Uuid))).limit(1);
        await tx.insert(identityMerges).values({
          id: mergeId, tenantId: tenantId as Uuid, identityResolutionCaseId: identityResolutionCaseId as Uuid, decisionId: decisionId,
          proposalVersion: proposal.version, survivorPersonId: proposal.survivorPersonId as Uuid, mergedPersonId: proposal.mergedPersonId as Uuid,
          effectiveAt: now, decidedBy: actor.sub, mergedPersonStatusCode: before?.status ?? null,
        });
        // ADR-031 item 5 (BL-355): move current ownership, keep history in place, record each move.
        const moved = await moveToSurvivor(tx, {
          tenantId, mergeId, survivorPersonId: proposal.survivorPersonId, mergedPersonId: proposal.mergedPersonId,
          factChoices: proposal.factChoices, now,
        });
        // The merged person's row stays, so the old id stays resolvable.
        await tx.update(persons).set({ personStatusCode: 'merged' })
          .where(and(eq(persons.tenantId, tenantId as Uuid), eq(persons.id, proposal.mergedPersonId as Uuid)));
        // propagated_at: core moves done and the event queued, in this transaction.
        await tx.insert(identityRedirects).values({
          id: randomUUID(), tenantId: tenantId as Uuid, oldPersonId: proposal.mergedPersonId, newPersonId: proposal.survivorPersonId,
          effectiveFrom: now, propagatedAt: now, mergeId: mergeId,
        });
        // ADR-031 items 8 and 9 (BL-357): ledger notices and IAM instructions, in this transaction.
        const merge: MergeForNotices = { mergeId, survivorPersonId: proposal.survivorPersonId, mergedPersonId: proposal.mergedPersonId, effectiveAt: now };
        if (this.delivery) executed = { merge, plan: await requestMergeNotices(this.delivery, tx, tenantId, merge) };
        const payload: PersonMergedV1Payload = { mergeId, survivorPersonId: proposal.survivorPersonId, mergedPersonId: proposal.mergedPersonId, effectiveAt: now.toISOString() };
        await enqueueWorkflowEvent(tx, {
          tenantId, eventType: EVENT_TYPES.PERSON_MERGED, correlationId: decisionId, dataClassification: 'personal',
          payload: payload as unknown as Record<string, unknown>,
        });
        if (this.audit) {
          await this.audit.record({
            tenantId, entityType: 'identity-merge', entityId: mergeId, actionType: 'create', actorType: 'user', actorId: actor.sub,
            reasonText: `Merged ${proposal.mergedPersonId} into ${proposal.survivorPersonId} (decision ${decisionId})`,
          }, tx);
          for (const [tableColumn, count] of Object.entries(moved)) {
            await this.audit.record({
              tenantId, entityType: 'identity-merge', entityId: mergeId, actionType: 'update', actorType: 'user', actorId: actor.sub,
              fieldName: tableColumn, afterValue: count, reasonText: `Merge moved ${count} ${tableColumn} row(s) to the survivor`,
            }, tx);
          }
        }
        // The identifier value not kept still finds the survivor.
        for (const c of await identifierConflicts(tx, tenantId, proposal)) {
          const keep = proposal.identifierResolutions[c.identifierClass]!.keep;
          const dropped = keep === 'survivor' ? c.mergedValues : c.survivorValues;
          for (const value of dropped) {
            await tx.insert(personIdentifierAliases).values({
              tenantId: tenantId as Uuid, personId: proposal.survivorPersonId, identifierClass: c.identifierClass, value,
              sourcePersonId: keep === 'survivor' ? proposal.mergedPersonId : proposal.survivorPersonId, decisionId: decisionId,
            });
          }
        }
      }
    });
    if (executed && this.delivery) {
      const { merge, plan } = executed as { merge: MergeForNotices; plan: MergeNoticePlan };
      const moved = await withTenantContext(this.db, tenantId, (tx) => tx.execute(sql`SELECT DISTINCT row_key FROM identity_merge_move
        WHERE tenant_id = ${tenantId}::uuid AND merge_id = ${merge.mergeId}::uuid AND table_name = 'enrolment'`)) as unknown as Array<{ row_key: string }>;
      // The fresh snapshots read the merged state, so they follow the commit; a failure leaves the notices already queued.
      await requestPostMergeSnapshots(this.delivery, this.db, tenantId, merge, plan, moved.map((m) => m.row_key));
    }
    return decisionId;
  }

  /** Records a related-record link only; a merge is made only by a decision (ADR-031 item 1). */
  async linkPersons(tenantId: string, sourcePersonId: string, targetPersonId: string, linkTypeCode: string): Promise<string> {
    if (linkTypeCode !== 'related-record') {
      throw new DomainError(`Only related-record links are made here; a merge (${linkTypeCode}) is made by a decision on an identity resolution case (ADR-031)`, 'bad-request', 400);
    }
    if (sourcePersonId === targetPersonId) throw new ValidationError('A link is between two different people');
    const id = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(personIdentityLinks).values({
        id,
        tenantId:       tenantId as Uuid,
        sourcePersonId: sourcePersonId as Uuid,
        targetPersonId: targetPersonId as Uuid,
        linkTypeCode,
        createdAt:      clockNow(),
      });
    });
    return id;
  }

  async openCorrectionCase(tenantId: string, personId: string, correctedEntityType: string, correctedFieldName: string, ownerId: string, actorId: string): Promise<string> {
    const businessCaseId = await this.businessCases.openCase(tenantId, {
      subjectType: 'person',
      subjectId:   personId,
      processId:   'BP-08-002',
      statusCode:  'open',
      ownerId,
    }, actorId);

    const id = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(dataCorrectionCases).values({
        id,
        tenantId:            tenantId as Uuid,
        businessCaseId:      businessCaseId as Uuid,
        personId:            personId as Uuid,
        correctedEntityType,
        correctedFieldName,
        createdAt:           clockNow(),
      });
    });
    return id;
  }

  /** Lists current identity-resolution cases, optionally filtered by business-case status. */
  async listCases(tenantId: string, statusCode?: string): Promise<IdentityResolutionCaseDto[]> {
    const businessCaseRows = await this.businessCases.listCasesByProcess(tenantId, 'BP-08-001', statusCode);
    if (businessCaseRows.length === 0) return [];

    const caseRows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(identityResolutionCases).where(and(
        eq(identityResolutionCases.tenantId, tenantId as Uuid),
        inArray(identityResolutionCases.businessCaseId, businessCaseRows.map((r) => r.caseId as Uuid)),
      )),
    );
    const businessCaseById = new Map(businessCaseRows.map((r) => [r.caseId, r]));
    return caseRows
      .map((row) => {
        const bc = businessCaseById.get(row.businessCaseId);
        if (!bc) return null;
        return {
          identityResolutionCaseId: row.id,
          subjectPersonId: bc.subjectId,
          statusCode:      bc.statusCode,
          ownerId:         bc.ownerId,
          createdAt:       row.createdAt,
        };
      })
      .filter((r): r is IdentityResolutionCaseDto => r !== null);
  }

  /** Lists current data-correction cases, optionally filtered by business-case status. */
  async listCorrectionCases(tenantId: string, statusCode?: string): Promise<DataCorrectionCaseDto[]> {
    const businessCaseRows = await this.businessCases.listCasesByProcess(tenantId, 'BP-08-002', statusCode);
    if (businessCaseRows.length === 0) return [];

    const caseRows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(dataCorrectionCases).where(and(
        eq(dataCorrectionCases.tenantId, tenantId as Uuid),
        inArray(dataCorrectionCases.businessCaseId, businessCaseRows.map((r) => r.caseId as Uuid)),
      )),
    );
    const businessCaseById = new Map(businessCaseRows.map((r) => [r.caseId, r]));
    return caseRows
      .map((row) => {
        const bc = businessCaseById.get(row.businessCaseId);
        if (!bc) return null;
        return {
          dataCorrectionCaseId: row.id,
          personId:             row.personId,
          correctedEntityType:  row.correctedEntityType,
          correctedFieldName:   row.correctedFieldName,
          statusCode:           bc.statusCode,
          ownerId:              bc.ownerId,
          createdAt:            row.createdAt,
        };
      })
      .filter((r): r is DataCorrectionCaseDto => r !== null);
  }

  async #ensureCaseExists(tenantId: string, identityResolutionCaseId: string): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ id: identityResolutionCases.id }).from(identityResolutionCases).where(and(
        eq(identityResolutionCases.id,       identityResolutionCaseId as Uuid),
        eq(identityResolutionCases.tenantId, tenantId                  as Uuid),
      )).limit(1),
    );
    if (!rows[0]) throw new NotFoundError('IdentityResolutionCase', identityResolutionCaseId);
  }
}

async function currentProposal(tx: TenantScopedDb, caseId: string): Promise<IdentityMergeProposal | null> {
  const [p] = await tx.select().from(identityMergeProposals)
    .where(eq(identityMergeProposals.identityResolutionCaseId, caseId as Uuid)).orderBy(desc(identityMergeProposals.version)).limit(1);
  return p ?? null;
}

function toProposalDto(p: IdentityMergeProposal, conflicts: IdentifierConflict[]): ProposalDto {
  return {
    proposalId: p.id, version: p.version, survivorPersonId: p.survivorPersonId, mergedPersonId: p.mergedPersonId,
    factChoices: p.factChoices, identifierResolutions: p.identifierResolutions, twoAccountsConfirmed: p.twoAccountsConfirmed,
    proposedBy: p.proposedBy, proposedAt: p.proposedAt.toISOString(), identifierConflicts: conflicts,
  };
}

/** Each person's statutory identifier values, by class (ADR-031 item 4). */
async function identifierValues(tx: TenantScopedDb, tenantId: string, personId: string): Promise<Record<string, string[]>> {
  const [person] = await tx.select({ hesaId: persons.hesaId }).from(persons)
    .where(and(eq(persons.id, personId as Uuid), eq(persons.tenantId, tenantId as Uuid))).limit(1);
  const ucas = await tx.selectDistinct({ v: enrolments.ucasPersonalId }).from(enrolments)
    .where(and(eq(enrolments.personId, personId as Uuid), eq(enrolments.tenantId, tenantId as Uuid), isNull(enrolments.recordedUntil), isNotNull(enrolments.ucasPersonalId)));
  return {
    'husid': person?.hesaId ? [person.hesaId] : [],
    'ucas-personal-id': ucas.map((r) => r.v!).sort(),
    'uln': [],
    'slc-customer-reference': [],
  };
}

/** Classes where both people hold values and they differ. */
async function identifierConflicts(tx: TenantScopedDb, tenantId: string, p: IdentityMergeProposal): Promise<IdentifierConflict[]> {
  const a = await identifierValues(tx, tenantId, p.survivorPersonId);
  const b = await identifierValues(tx, tenantId, p.mergedPersonId);
  return STATUTORY_IDENTIFIER_CLASSES
    .filter((k) => a[k]!.length > 0 && b[k]!.length > 0 && JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((k) => ({ identifierClass: k, survivorValues: a[k]!, mergedValues: b[k]!, resolved: Boolean(p.identifierResolutions[k]) }));
}

/** The checks a merge must pass (ADR-031 item 3), each refused with its reason code. */
async function assertMergeAllowed(tx: TenantScopedDb, tenantId: string, p: IdentityMergeProposal): Promise<void> {
  const pair = [p.survivorPersonId, p.mergedPersonId] as Uuid[];
  const redirects = await tx.select({ id: identityRedirects.id }).from(identityRedirects)
    .where(and(eq(identityRedirects.tenantId, tenantId as Uuid), inArray(identityRedirects.oldPersonId, pair), isNull(identityRedirects.endedAt))).limit(1);
  if (redirects.length > 0) throw new MergeNotAllowedError('already-merged', 'One of these people has already been merged into another record; merges never chain');
  const anonymised = await tx.select({ id: persons.id }).from(persons)
    .where(and(eq(persons.tenantId, tenantId as Uuid), inArray(persons.id, pair), isNotNull(persons.retentionAnonymisedAt))).limit(1);
  if (anonymised.length > 0) throw new MergeNotAllowedError('anonymised', 'One of these people has been anonymised under retention');
  const restricted = await tx.select({ id: processingRestrictions.id }).from(processingRestrictions)
    .where(and(eq(processingRestrictions.tenantId, tenantId as Uuid), inArray(processingRestrictions.personId, pair), isNull(processingRestrictions.liftedAt))).limit(1);
  if (restricted.length > 0) throw new MergeNotAllowedError('restricted', 'One of these people has an active processing restriction; refer the case to the DPO');
  const unresolved = (await identifierConflicts(tx, tenantId, p)).filter((c) => !c.resolved);
  if (unresolved.length > 0) throw new MergeNotAllowedError('identifier-conflict', `Resolve the conflicting identifiers first: ${unresolved.map((c) => c.identifierClass).join(', ')}`);
  const accounts = await tx.selectDistinct({ personId: deliveryItems.personId }).from(deliveryItems)
    .where(and(eq(deliveryItems.tenantId, tenantId as Uuid), eq(deliveryItems.flowCode, 'F-SIS-IAM-01'), eq(deliveryItems.statusCode, 'delivered'),
      or(eq(deliveryItems.personId, pair[0]!), eq(deliveryItems.personId, pair[1]!))));
  if (accounts.length === 2 && !p.twoAccountsConfirmed) {
    throw new MergeNotAllowedError('two-accounts-unconfirmed', 'Both people have institutional accounts; confirm in the proposal that one will be ended');
  }
}
