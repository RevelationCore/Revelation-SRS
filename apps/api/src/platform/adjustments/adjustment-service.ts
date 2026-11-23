import { createHash, randomUUID } from 'node:crypto';

import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  adjustmentDistributions,
  adjustmentMigrationReleases,
  adjustmentRequests,
  enrolments,
  personIdentities,
  persons,
  reasonableAdjustments,
  type Db,
  type TenantScopedDb,
  withTenantContext,
} from '@revelation-srs/db';
import { DocumentNotFoundError, type RetrievedDocument } from '@revelation-srs/documents';
import {
  ConflictError,
  DomainError,
  EVENT_TYPES,
  NotFoundError,
  ValidationError,
} from '@revelation-srs/domain';
import type {
  AdjustmentAmountV1,
  AdjustmentApprovedV1Payload,
  AdjustmentDistributedV1Payload,
  AdjustmentExpiredV1Payload,
} from '@revelation-srs/domain';

import type { ApiDocumentStore } from '../documents/document-store.js';
import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';
import type { ValueSetService } from '../value-sets/service.js';
import { clockNow } from '../clock.js';

import { amountFromRow, validateAmountForType } from './amount.js';
import type { AdjustmentDistributionDispatcher } from './distribution-dispatcher.js';
import {
  isAdjustmentTarget,
  type AdjustmentTargetConfigService,
} from './target-config.js';

/**
 * Who is replying to a distribution: an integration connector (or the SRS
 * itself, for its own file targets), or a person working the manual task
 * queue — who may only reply for distributions whose target is 'manual'.
 */
export type ReplyActor = 'connector' | 'person';

export interface AdjustmentTaskDto {
  distributionId:     string;
  adjustmentId:       string;
  targetSystem:       string;
  /** apply: make it so in the target system; remove: undo it (the adjustment ended). */
  action:             'apply' | 'remove';
  statusCode:         string;
  failureReason:      string | null;
  personId:           string;
  studentNumber:      string | null;
  studentName:        string | null;
  enrolmentId:        string;
  adjustmentTypeCode: string;
  scopeCode:          string;
  amount:             AdjustmentAmountV1 | null;
  validFrom:          Date;
  validTo:            Date | null;
  /** When the task became due: created (apply) or withdrawal requested (remove). */
  dueSince:           Date;
  ownerDescription:   string | null;
  overdue:            boolean;
}

export interface RecordAdjustmentInput {
  enrolmentId: string;
  adjustmentTypeCode: string;
  scopeCode: string;
  validFrom: string;
  validTo?: string;
  /** Structured amount, e.g. { value: 25, unitCode: 'percent-of-duration' }.
   * Target systems that compute per-assessment values need it. */
  amount?: AdjustmentAmountV1;
}

/**
 * The authority an adjustment is recorded under (ADR-033). There is no way to
 * record one without it: the wellbeing case that approved it (ADR-029 hand-off),
 * or a manual proposal a second person approved (BL-378).
 */
export type AdjustmentAuthority =
  | { kind: 'wellbeing-case'; sourceCaseId: string }
  | { kind: 'manual-proposal'; proposalId: string };

export interface RecordAdjustmentResult {
  adjustmentId: string;
  /** True when an earlier request with the same idempotency key and payload
   * already recorded this adjustment; nothing new was written or published. */
  replayed: boolean;
}

export interface AdjustmentDto {
  adjustmentId: string;
  enrolmentId: string;
  personId: string;
  adjustmentTypeCode: string;
  scopeCode: string;
  amount: AdjustmentAmountV1 | null;
  notes: string | null;
  actorId: string;
  validFrom: Date;
  validTo: Date | null;
  recordedAt: Date;
  recordedUntil: Date | null;
  sourceCaseId: string | null;
  outcomeDocumentId: string | null;
  /** ADR-033: wellbeing-case | manual-approved | migrated | legacy-direct. */
  provenanceCode: string;
  manualProposalId: string | null;
}

export interface AttachOutcomeDocumentInput {
  filename: string;
  mimeType: string;
  content: Buffer;
}

export interface AdjustmentDistributionDto {
  distributionId: string;
  adjustmentId: string;
  targetSystem: string;
  statusCode: string;
  distributedAt: Date | null;
  failureReason: string | null;
  /** connected | manual | file — how this distribution is fulfilled. */
  fulfilmentModeCode: string;
  /** When the instruction was issued: published as an event (connected), or
   * created as a task / file delivery (manual, file). Null: not yet. */
  requestPublishedAt: Date | null;
  withdrawalRequestedAt: Date | null;
  withdrawalPublishedAt: Date | null;
  withdrawnAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MigrationBatchSummary {
  batchId: string;
  /** Every version recorded in the batch. */
  total: number;
  /** Current versions: what expectedCount is checked against. */
  current: number;
  released: number;
  /** Current, in force or future, and not yet released. */
  unreleased: number;
  /** Current but ended before release; never distributed. */
  ended: number;
}

export interface MigrationBatchRelease {
  released: number;
  alreadyReleased: number;
  ended: number;
}

/** 409: the batch does not hold the number of adjustments the legacy report says. */
export class MigrationCountMismatchError extends DomainError {
  constructor(actual: number, expected: number) {
    super(`This batch holds ${actual} current adjustments, not ${expected}; reconcile it against the legacy report before releasing`, 'migration-count-mismatch', 409);
    this.name = 'MigrationCountMismatchError';
  }
}

const TARGET_SYSTEMS_BY_SCOPE: Record<string, string[]> = {
  all: ['vle', 'attendance', 'exams'],
  coursework: ['vle'],
  attendance: ['attendance'],
  exam: ['exams'],
};

export class AdjustmentService {
  constructor(
    private readonly db: Db,
    private readonly eventBus: IntegrationBusPublisher,
    private readonly valueSets: ValueSetService,
    private readonly dispatcher: AdjustmentDistributionDispatcher,
    private readonly targetConfig: AdjustmentTargetConfigService,
    private readonly documents: ApiDocumentStore,
  ) {}

  async recordAuthorisedAdjustment(
    tenantId: string,
    personId: string,
    input: RecordAdjustmentInput,
    authority: AdjustmentAuthority,
    actorId: string,
    idempotencyKey?: string,
    /** Runs in the recording transaction, after the adjustment is written (not on a replay). */
    inTransaction?: (tx: TenantScopedDb, adjustmentId: string) => Promise<void>,
  ): Promise<RecordAdjustmentResult> {
    const sourceCaseId = authority.kind === 'wellbeing-case' ? authority.sourceCaseId : null;
    await this.#ensureEnrolmentBelongsToPerson(input.enrolmentId, personId, tenantId);
    await this.#validateInput(tenantId, input);

    const now = clockNow();
    const validFrom = new Date(input.validFrom);
    const validTo = input.validTo ? new Date(input.validTo) : null;
    const targetSystems = this.#targetSystemsForScope(input.scopeCode);
    const payloadHash = hashRequest({
      personId,
      enrolmentId: input.enrolmentId,
      adjustmentTypeCode: input.adjustmentTypeCode,
      scopeCode: input.scopeCode,
      validFrom: validFrom.toISOString(),
      validTo: validTo ? validTo.toISOString() : null,
      amount: input.amount ? { value: input.amount.value, unitCode: input.amount.unitCode } : null,
      // Kept so request hashes recorded before notes were refused still match.
      notes: null,
      sourceCaseId,
      manualProposalId: authority.kind === 'manual-proposal' ? authority.proposalId : null,
    });

    const result = await withTenantContext(this.db, tenantId, async (tx): Promise<RecordAdjustmentResult> => {
      const adjustmentId = randomUUID();

      // Claim the key first. A concurrent request with the same key waits on
      // the primary key until this transaction ends, then finds the row.
      if (idempotencyKey) {
        const claimed = await tx.insert(adjustmentRequests).values({
          tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`,
          idempotencyKey,
          payloadHash,
          adjustmentId,
          createdAt: now,
        }).onConflictDoNothing().returning();

        if (claimed.length === 0) {
          const existing = await tx.select().from(adjustmentRequests).where(and(
            eq(adjustmentRequests.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            eq(adjustmentRequests.idempotencyKey, idempotencyKey),
          )).limit(1);
          const prior = existing[0];
          if (!prior) throw new ConflictError('This idempotency key is in use by a request that did not complete');
          if (prior.payloadHash !== payloadHash) {
            throw new ConflictError('This idempotency key was already used for a different adjustment request');
          }
          return { adjustmentId: prior.adjustmentId, replayed: true };
        }
      }

      await tx.insert(reasonableAdjustments).values({
        versionId: randomUUID(),
        id: adjustmentId,
        tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`,
        enrolmentId: input.enrolmentId as `${string}-${string}-${string}-${string}-${string}`,
        personId: personId as `${string}-${string}-${string}-${string}-${string}`,
        adjustmentTypeCode: input.adjustmentTypeCode,
        scopeCode: input.scopeCode,
        notes: null,
        actorId,
        validFrom,
        validTo,
        recordedAt: now,
        recordedUntil: null,
        sourceCaseId,
        amountValue: input.amount ? input.amount.value.toFixed(2) : null,
        amountUnitCode: input.amount?.unitCode ?? null,
        provenanceCode: authority.kind === 'wellbeing-case' ? 'wellbeing-case' : 'manual-approved',
        manualProposalId: authority.kind === 'manual-proposal' ? authority.proposalId : null,
      });

      await this.#createDistributions(tx, tenantId, adjustmentId, targetSystems, now);

      if (inTransaction) await inTransaction(tx, adjustmentId);
      return { adjustmentId, replayed: false };
    });

    if (result.replayed) {
      // The original attempt may have stopped before dispatching.
      await this.dispatcher.dispatchTenant(tenantId);
      return result;
    }
    const { adjustmentId } = result;

    await this.#publishApproved(tenantId, actorId, {
      adjustmentId, enrolmentId: input.enrolmentId, personId, adjustmentTypeCode: input.adjustmentTypeCode,
      scopeCode: input.scopeCode, amount: input.amount ?? null, validFrom, validTo,
    });

    // Instruct each target. Failures leave the rows due; the worker's
    // reconcile loop republishes them.
    await this.dispatcher.dispatchTenant(tenantId);

    return result;
  }

  /**
   * The checks recording would make, without writing anything: the person and
   * enrolment, the dates, the value-set codes and the amount. A manual
   * proposal is checked on the way in, and again when it is approved.
   */
  async validateForRecording(tenantId: string, personId: string, input: RecordAdjustmentInput): Promise<void> {
    await this.#ensurePersonExists(personId, tenantId);
    await this.#ensureEnrolmentBelongsToPerson(input.enrolmentId, personId, tenantId);
    await this.#validateInput(tenantId, input);
  }

  /**
   * A migration batch (ADR-033 item 7): its current adjustments, how many are
   * released, how many are still to release, and how many have ended.
   */
  async summariseMigrationBatch(tenantId: string, batchId: string): Promise<MigrationBatchSummary> {
    return withTenantContext(this.db, tenantId, (tx) => this.#summarise(tx, tenantId, batchId));
  }

  /**
   * Distributes a reconciled migration batch: for each current adjustment in
   * the batch still in force and not yet released, the same per-target
   * distributions a newly approved adjustment gets, and its approved event.
   * Ended adjustments are skipped. expectedCount must equal the batch's
   * current adjustments (SME-8), and the release names the legacy report it
   * was checked against. Safe to repeat: a released adjustment is skipped.
   */
  async releaseMigrationBatch(
    tenantId: string,
    batchId: string,
    input: { expectedCount: number; reconciliationReference: string },
    actorId: string,
  ): Promise<MigrationBatchRelease> {
    const reference = input.reconciliationReference.trim();
    if (reference.length < 1 || reference.length > 100) {
      throw new ValidationError('reconciliationReference must be 1 to 100 characters', [{ field: 'reconciliationReference', message: 'The reference of the legacy report the count was checked against' }]);
    }
    const now = clockNow();
    const outcome = await withTenantContext(this.db, tenantId, async (tx) => {
      // One release of a batch at a time.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`adjustment-migration-batch:${batchId}`}))`);
      const summary = await this.#summarise(tx, tenantId, batchId);
      if (summary.current !== input.expectedCount) throw new MigrationCountMismatchError(summary.current, input.expectedCount);

      const toRelease = await tx.select().from(reasonableAdjustments)
        .leftJoin(adjustmentMigrationReleases, and(
          eq(adjustmentMigrationReleases.tenantId, reasonableAdjustments.tenantId),
          eq(adjustmentMigrationReleases.adjustmentId, reasonableAdjustments.id),
        ))
        .where(and(
          eq(reasonableAdjustments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(reasonableAdjustments.migrationBatchId, batchId as `${string}-${string}-${string}-${string}-${string}`),
          isNull(reasonableAdjustments.recordedUntil),
          isNull(adjustmentMigrationReleases.adjustmentId),
          or(isNull(reasonableAdjustments.validTo), gt(reasonableAdjustments.validTo, now)),
        ));
      for (const { reasonable_adjustment: a } of toRelease) {
        await this.#createDistributions(tx, tenantId, a.id, this.#targetSystemsForScope(a.scopeCode), now);
        await tx.insert(adjustmentMigrationReleases).values({
          tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`,
          adjustmentId: a.id, migrationBatchId: batchId as `${string}-${string}-${string}-${string}-${string}`,
          reconciliationReference: reference, releasedBy: actorId, releasedAt: now,
        });
      }
      return { released: toRelease.map((r) => r.reasonable_adjustment), summary };
    });

    for (const a of outcome.released) {
      await this.#publishApproved(tenantId, actorId, {
        adjustmentId: a.id, enrolmentId: a.enrolmentId, personId: a.personId, adjustmentTypeCode: a.adjustmentTypeCode,
        scopeCode: a.scopeCode, amount: amountFromRow(a), validFrom: a.validFrom, validTo: a.validTo,
      });
    }
    if (outcome.released.length > 0) await this.dispatcher.dispatchTenant(tenantId);
    return {
      released: outcome.released.length,
      alreadyReleased: outcome.summary.released,
      ended: outcome.summary.ended,
    };
  }

  async #summarise(tx: TenantScopedDb, tenantId: string, batchId: string): Promise<MigrationBatchSummary> {
    const now = clockNow();
    const rows = await tx.select({
      validTo: reasonableAdjustments.validTo,
      recordedUntil: reasonableAdjustments.recordedUntil,
      releasedAt: adjustmentMigrationReleases.releasedAt,
    }).from(reasonableAdjustments)
      .leftJoin(adjustmentMigrationReleases, and(
        eq(adjustmentMigrationReleases.tenantId, reasonableAdjustments.tenantId),
        eq(adjustmentMigrationReleases.adjustmentId, reasonableAdjustments.id),
      ))
      .where(and(
        eq(reasonableAdjustments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
        eq(reasonableAdjustments.migrationBatchId, batchId as `${string}-${string}-${string}-${string}-${string}`),
      ));
    if (rows.length === 0) throw new NotFoundError('AdjustmentMigrationBatch', batchId);
    const current = rows.filter((r) => r.recordedUntil === null);
    const ended = current.filter((r) => r.validTo !== null && r.validTo <= now && r.releasedAt === null).length;
    const released = current.filter((r) => r.releasedAt !== null).length;
    return { batchId, total: rows.length, current: current.length, released, unreleased: current.length - released - ended, ended };
  }

  async listAdjustments(
    personId: string,
    tenantId: string,
    enrolmentId?: string,
  ): Promise<AdjustmentDto[]> {
    await this.#ensurePersonExists(personId, tenantId);
    if (enrolmentId) await this.#ensureEnrolmentBelongsToPerson(enrolmentId, personId, tenantId);

    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(reasonableAdjustments)
        .where(
          and(
            eq(reasonableAdjustments.personId, personId as `${string}-${string}-${string}-${string}-${string}`),
            eq(reasonableAdjustments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            ...(enrolmentId ? [eq(reasonableAdjustments.enrolmentId, enrolmentId as `${string}-${string}-${string}-${string}-${string}`)] : []),
            isNull(reasonableAdjustments.recordedUntil),
          ),
        )
        .orderBy(reasonableAdjustments.validFrom, reasonableAdjustments.recordedAt),
    );

    return rows.map(adjustmentToDto);
  }

  async listDistributions(adjustmentId: string, tenantId: string): Promise<AdjustmentDistributionDto[]> {
    await this.#ensureAdjustmentExists(adjustmentId, tenantId);

    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(adjustmentDistributions)
        .where(
          and(
            eq(adjustmentDistributions.adjustmentId, adjustmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(adjustmentDistributions.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        )
        .orderBy(adjustmentDistributions.createdAt, adjustmentDistributions.targetSystem),
    );

    return rows.map(distributionToDto);
  }

  async getAdjustment(adjustmentId: string, tenantId: string): Promise<AdjustmentDto> {
    return this.#getCurrentAdjustment(adjustmentId, tenantId);
  }

  async acknowledgeDistribution(
    adjustmentId: string,
    distributionId: string,
    tenantId: string,
    targetSystem: string,
    actor: ReplyActor = 'connector',
  ): Promise<void> {
    const adjustment = await this.#getCurrentAdjustment(adjustmentId, tenantId);
    const distribution = await this.#getDistribution(adjustmentId, distributionId, tenantId);
    if (distribution.targetSystem !== targetSystem) {
      throw new NotFoundError('AdjustmentDistribution', distributionId);
    }
    assertActorMayReply(distribution, actor);

    // A repeated acknowledgement (e.g. a consumer retrying after a lost
    // response) is a no-op: the first one already recorded and published it.
    if (distribution.statusCode === 'distributed') return;
    assertStillApplicable(distribution.statusCode);

    const now = clockNow();
    const updated = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .update(adjustmentDistributions)
        .set({
          statusCode: 'distributed',
          distributedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(adjustmentDistributions.id, distributionId as `${string}-${string}-${string}-${string}-${string}`),
            eq(adjustmentDistributions.adjustmentId, adjustmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(adjustmentDistributions.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            inArray(adjustmentDistributions.statusCode, ['pending', 'failed']),
          ),
        )
        .returning({ id: adjustmentDistributions.id }),
    );

    // Lost a race with a concurrent acknowledgement or expiry.
    if (updated.length === 0) {
      const latest = await this.#getDistribution(adjustmentId, distributionId, tenantId);
      assertStillApplicable(latest.statusCode);
      return;
    }

    if (this.eventBus.isConnected()) {
      const payload: AdjustmentDistributedV1Payload = {
        adjustmentId,
        distributionId,
        targetSystem,
        distributedAt:      now.toISOString(),
        personId:           adjustment.personId,
        enrolmentId:        adjustment.enrolmentId,
        adjustmentTypeCode: adjustment.adjustmentTypeCode,
        scopeCode:          adjustment.scopeCode,
        ...(adjustment.amount ? { amount: adjustment.amount } : {}),
        validFrom:          adjustment.validFrom.toISOString(),
        ...(adjustment.validTo ? { validTo: adjustment.validTo.toISOString() } : {}),
      };
      await this.eventBus.publish(
        EVENT_TYPES.ADJUSTMENT_DISTRIBUTED,
        '1.0.0',
        tenantId,
        distributionId,
        'sensitive',
        payload,
      );
    }
  }

  /**
   * The manual task queue: distributions for 'manual' targets that need a
   * person — apply (pending, or failed and to retry) or remove (the
   * adjustment ended). Oldest first. Carries what is needed to act in the
   * target system — who, what, how much, from when — and nothing more: no
   * notes, evidence or case reference.
   */
  async listTasks(
    tenantId: string,
    opts: { targetSystem?: string; now?: Date } = {},
  ): Promise<AdjustmentTaskDto[]> {
    const now = opts.now ?? clockNow();
    const configs = await this.targetConfig.list(tenantId);
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({
          d: adjustmentDistributions,
          a: reasonableAdjustments,
          studentNumber: persons.studentNumber,
          firstName: personIdentities.preferredName,
          legalFirstName: personIdentities.legalFirstName,
          familyName: personIdentities.legalFamilyName,
        })
        .from(adjustmentDistributions)
        .innerJoin(reasonableAdjustments, and(
          eq(reasonableAdjustments.id, adjustmentDistributions.adjustmentId),
          eq(reasonableAdjustments.tenantId, adjustmentDistributions.tenantId),
          isNull(reasonableAdjustments.recordedUntil),
        ))
        .leftJoin(persons, and(eq(persons.id, reasonableAdjustments.personId), eq(persons.tenantId, reasonableAdjustments.tenantId)))
        .leftJoin(personIdentities, and(
          eq(personIdentities.personId, reasonableAdjustments.personId),
          eq(personIdentities.tenantId, reasonableAdjustments.tenantId),
          isNull(personIdentities.recordedUntil),
        ))
        .where(and(
          eq(adjustmentDistributions.tenantId, tenantId as Uuid),
          eq(adjustmentDistributions.fulfilmentModeCode, 'manual'),
          inArray(adjustmentDistributions.statusCode, ['pending', 'failed', 'withdrawal-requested']),
          ...(opts.targetSystem ? [eq(adjustmentDistributions.targetSystem, opts.targetSystem)] : []),
        ))
        .orderBy(adjustmentDistributions.createdAt),
    );

    const seen = new Set<string>();
    const tasks: AdjustmentTaskDto[] = [];
    for (const { d, a, studentNumber, firstName, legalFirstName, familyName } of rows) {
      if (seen.has(d.id)) continue; // one row per distribution even if identity history overlaps
      seen.add(d.id);
      const config = configs.find((c) => c.targetSystem === d.targetSystem);
      const removing = d.statusCode === 'withdrawal-requested';
      const dueSince = removing ? (d.withdrawalRequestedAt ?? d.updatedAt) : d.createdAt;
      const alertMs = (config?.alertAfterHours ?? 72) * 3_600_000;
      tasks.push({
        distributionId: d.id,
        adjustmentId: a.id,
        targetSystem: d.targetSystem,
        action: removing ? 'remove' : 'apply',
        statusCode: d.statusCode,
        failureReason: d.failureReason,
        personId: a.personId,
        studentNumber,
        studentName: familyName ? `${firstName ?? legalFirstName ?? ''} ${familyName}`.trim() : null,
        enrolmentId: a.enrolmentId,
        adjustmentTypeCode: a.adjustmentTypeCode,
        scopeCode: a.scopeCode,
        amount: amountFromRow(a),
        validFrom: a.validFrom,
        validTo: a.validTo,
        dueSince,
        ownerDescription: config?.ownerDescription ?? null,
        overdue: now.getTime() - dueSince.getTime() > alertMs,
      });
    }
    return tasks;
  }

  /**
   * A target's integration layer reports that it cannot apply (or keep
   * applied) a distribution — for example a VLE time accommodation with no
   * recorded amount, a student unknown to the VLE, or an API failure it has
   * stopped retrying. Recorded on the row for staff to act on; the target may
   * still acknowledge later. During withdrawal the reason is recorded and the
   * row stays 'withdrawal-requested', since the removal is still outstanding.
   */
  async reportDistributionFailure(
    adjustmentId: string,
    distributionId: string,
    tenantId: string,
    targetSystem: string,
    reason: string,
    actor: ReplyActor = 'connector',
  ): Promise<void> {
    await this.#ensureAdjustmentExists(adjustmentId, tenantId);
    const distribution = await this.#getDistribution(adjustmentId, distributionId, tenantId);
    if (distribution.targetSystem !== targetSystem) {
      throw new NotFoundError('AdjustmentDistribution', distributionId);
    }
    assertActorMayReply(distribution, actor);

    const nextStatus = (() => {
      switch (distribution.statusCode) {
        case 'pending':
        case 'failed':               return 'failed';
        case 'withdrawal-requested': return 'withdrawal-requested';
        case 'distributed':
          throw new ConflictError('This distribution was acknowledged as applied; it cannot now be reported as failed');
        default:
          throw new ConflictError(`This distribution is ${distribution.statusCode} and needs no further action`);
      }
    })();

    const now = clockNow();
    const updated = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .update(adjustmentDistributions)
        .set({ statusCode: nextStatus, failureReason: reason, updatedAt: now })
        .where(and(
          eq(adjustmentDistributions.id, distributionId as Uuid),
          eq(adjustmentDistributions.tenantId, tenantId as Uuid),
          eq(adjustmentDistributions.statusCode, distribution.statusCode),
        ))
        .returning({ id: adjustmentDistributions.id }),
    );
    if (updated.length === 0) {
      throw new ConflictError('This distribution changed while the failure was being recorded; retry');
    }
  }

  /**
   * A target confirms it removed an adjustment it had been told to withdraw.
   * Repeating the confirmation has no effect.
   */
  async acknowledgeWithdrawal(
    adjustmentId: string,
    distributionId: string,
    tenantId: string,
    targetSystem: string,
    actor: ReplyActor = 'connector',
  ): Promise<void> {
    await this.#ensureAdjustmentExists(adjustmentId, tenantId);
    const distribution = await this.#getDistribution(adjustmentId, distributionId, tenantId);
    if (distribution.targetSystem !== targetSystem) {
      throw new NotFoundError('AdjustmentDistribution', distributionId);
    }
    assertActorMayReply(distribution, actor);
    if (distribution.statusCode === 'withdrawn') return;
    if (distribution.statusCode !== 'withdrawal-requested') {
      throw new ConflictError(`This distribution is ${distribution.statusCode}; no withdrawal was requested`);
    }

    const now = clockNow();
    await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .update(adjustmentDistributions)
        .set({ statusCode: 'withdrawn', withdrawnAt: now, failureReason: null, updatedAt: now })
        .where(and(
          eq(adjustmentDistributions.id, distributionId as Uuid),
          eq(adjustmentDistributions.tenantId, tenantId as Uuid),
          eq(adjustmentDistributions.statusCode, 'withdrawal-requested'),
        )),
    );
  }

  /**
   * End an adjustment's valid period now (or immediately after it starts,
   * if it has not started yet).
   *
   * A bitemporal update, like attachOutcomeDocument: the current version is
   * closed in transaction time and a successor is recorded with the new
   * validTo. The closed version keeps its original validTo, so a query
   * "as recorded before the expiry" still shows what was then believed, and
   * the expired adjustment stays visible (with its end date) for history,
   * board packs and later reconstruction. An adjustment whose period has
   * already ended keeps its recorded end date and gains no new version.
   * The expired event is still published, as before: there is no scheduler
   * that announces a natural end, so this call may be consumers' only signal.
   *
   * Distributions: a row whose instruction was never published is simply
   * superseded. A row whose instruction was published — acknowledged or not,
   * since the target may have applied it without the acknowledgement arriving
   * — moves to 'withdrawal-requested' and its target is sent a withdrawal
   * instruction. The rows are locked first, so a dispatcher mid-publish
   * finishes (and stamps request_published_at) before this decides.
   */
  async expireAdjustment(adjustmentId: string, tenantId: string, actorId: string): Promise<void> {
    const now = clockNow();

    const outcome = await withTenantContext(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(reasonableAdjustments)
        .where(
          and(
            eq(reasonableAdjustments.id, adjustmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(reasonableAdjustments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(reasonableAdjustments.recordedUntil),
          ),
        )
        .for('update')
        .limit(1);
      const current = rows[0];
      if (!current) throw new NotFoundError('ReasonableAdjustment', adjustmentId);

      const endAt = now > current.validFrom
        ? now
        : new Date(current.validFrom.getTime() + 1);
      const alreadyEnded = current.validTo !== null && current.validTo <= endAt;

      if (!alreadyEnded) {
        await tx
          .update(reasonableAdjustments)
          .set({ recordedUntil: now })
          .where(eq(reasonableAdjustments.versionId, current.versionId));

        await tx.insert(reasonableAdjustments).values({
          ...current,
          versionId:     randomUUID(),
          validTo:       endAt,
          actorId,
          recordedAt:    now,
          recordedUntil: null,
        });
      }

      const distributions = await tx
        .select({
          id: adjustmentDistributions.id,
          statusCode: adjustmentDistributions.statusCode,
          requestPublishedAt: adjustmentDistributions.requestPublishedAt,
        })
        .from(adjustmentDistributions)
        .where(and(
          eq(adjustmentDistributions.adjustmentId, adjustmentId as Uuid),
          eq(adjustmentDistributions.tenantId, tenantId as Uuid),
        ))
        .for('update');

      for (const d of distributions) {
        if (!['pending', 'distributed', 'failed'].includes(d.statusCode)) continue;
        if (d.requestPublishedAt === null && d.statusCode !== 'distributed') {
          await tx
            .update(adjustmentDistributions)
            .set({ statusCode: 'superseded', updatedAt: now })
            .where(eq(adjustmentDistributions.id, d.id));
        } else {
          await tx
            .update(adjustmentDistributions)
            .set({
              statusCode: 'withdrawal-requested',
              withdrawalEventId: randomUUID(),
              withdrawalRequestedAt: now,
              failureReason: null,
              updatedAt: now,
            })
            .where(eq(adjustmentDistributions.id, d.id));
        }
      }

      return {
        current,
        endedAt: alreadyEnded ? current.validTo! : endAt,
      };
    });

    if (this.eventBus.isConnected()) {
      const payload: AdjustmentExpiredV1Payload = {
        adjustmentId,
        enrolmentId: outcome.current.enrolmentId,
        personId: outcome.current.personId,
        expiredAt: outcome.endedAt.toISOString(),
      };
      await this.eventBus.publish(
        EVENT_TYPES.ADJUSTMENT_EXPIRED,
        '1.0.0',
        tenantId,
        actorId,
        'sensitive',
        payload,
      );
    }

    await this.dispatcher.dispatchTenant(tenantId);
  }

  /**
   * Attach a detail document expanding on the coded adjustment (e.g. a
   * specific seating/equipment/software specification) — for when the
   * type/scope/notes fields alone aren't expressive enough. Stored via
   * this service's own packages/documents install, independent of
   * whatever the wellbeing module holds for the case that originated
   * this record (if any) — see sourceCaseId's doc comment on why that's
   * a deliberate choice, not an oversight.
   *
   * A bitemporal correction: the current version is closed and a new one
   * inserted with the same valid-time range (the adjustment itself
   * hasn't changed, only our documentation of it) — never an in-place
   * overwrite.
   */
  async attachOutcomeDocument(
    adjustmentId: string,
    personId:     string,
    tenantId:     string,
    actorId:      string,
    input:        AttachOutcomeDocumentInput,
  ): Promise<{ documentId: string; checksumSha256: string }> {
    // ADR-030: check, then scan with no transaction open, then re-check and write.
    const current = async (tx: TenantScopedDb) => {
      const rows = await tx
        .select()
        .from(reasonableAdjustments)
        .where(
          and(
            eq(reasonableAdjustments.id, adjustmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(reasonableAdjustments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(reasonableAdjustments.recordedUntil),
          ),
        )
        .limit(1);
      const row = rows[0];
      // Not-found (rather than forbidden) for a personId/adjustmentId
      // mismatch — consistent with #ensureEnrolmentBelongsToPerson, and
      // avoids letting a caller probe which adjustment IDs exist.
      if (!row || row.personId !== personId) throw new NotFoundError('ReasonableAdjustment', adjustmentId);
      return row;
    };
    await withTenantContext(this.db, tenantId, current);

    const scanned = await this.documents.scanUpload({
      tenantId, ownerService: 'srs-adjustments', ownerRef: adjustmentId,
      filename: input.filename, mimeType: input.mimeType, content: input.content, actorId,
    });

    return withTenantContext(this.db, tenantId, async (tx) => {
      const row = await current(tx);
      const stored = await this.documents.adapter(tx).store(scanned);

      const now = clockNow();
      await tx
        .update(reasonableAdjustments)
        .set({ recordedUntil: now })
        .where(eq(reasonableAdjustments.versionId, row.versionId));

      await tx.insert(reasonableAdjustments).values({
        ...row,
        versionId:         randomUUID(),
        actorId,
        recordedAt:        now,
        recordedUntil:     null,
        outcomeDocumentId: stored.documentId,
      });

      return { documentId: stored.documentId, checksumSha256: stored.checksumSha256 };
    });
  }

  async getOutcomeDocument(adjustmentId: string, personId: string, tenantId: string, actorId: string): Promise<RetrievedDocument> {
    return withTenantContext(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select({ personId: reasonableAdjustments.personId, outcomeDocumentId: reasonableAdjustments.outcomeDocumentId })
        .from(reasonableAdjustments)
        .where(
          and(
            eq(reasonableAdjustments.id, adjustmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(reasonableAdjustments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(reasonableAdjustments.recordedUntil),
          ),
        )
        .limit(1);

      const current = rows[0];
      if (!current || current.personId !== personId) throw new NotFoundError('ReasonableAdjustment', adjustmentId);
      if (!current.outcomeDocumentId) throw new NotFoundError('AdjustmentOutcomeDocument', adjustmentId);

      try {
        return await this.documents.adapter(tx).retrieve(tenantId, current.outcomeDocumentId, actorId);
      } catch (err) {
        if (err instanceof DocumentNotFoundError) throw new NotFoundError('AdjustmentOutcomeDocument', adjustmentId);
        throw err;
      }
    });
  }

  /**
   * One distribution per target the tenant delivers to. A 'not-used' target
   * gets none; manual and file targets are issued straight away (a task in the
   * queue, or the next file exchange), so only connected targets wait for the
   * dispatcher to publish an event.
   */
  async #createDistributions(tx: TenantScopedDb, tenantId: string, adjustmentId: string, targetSystems: string[], now: Date): Promise<void> {
    const modes = await this.targetConfig.modesIn(tx, tenantId);
    const delivered = targetSystems
      .map((targetSystem) => ({ targetSystem, mode: isAdjustmentTarget(targetSystem) ? modes[targetSystem] : 'connected' }))
      .filter((t) => t.mode !== 'not-used');
    if (delivered.length === 0) return;
    await tx.insert(adjustmentDistributions).values(delivered.map(({ targetSystem, mode }) => ({
      id: randomUUID(),
      tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`,
      adjustmentId,
      targetSystem,
      fulfilmentModeCode: mode,
      statusCode: 'pending',
      distributedAt: null,
      failureReason: null,
      requestPublishedAt: mode === 'connected' ? null : now,
      createdAt: now,
      updatedAt: now,
    })));
  }

  async #publishApproved(tenantId: string, actorId: string, a: {
    adjustmentId: string; enrolmentId: string; personId: string; adjustmentTypeCode: string; scopeCode: string;
    amount: AdjustmentAmountV1 | null; validFrom: Date; validTo: Date | null;
  }): Promise<void> {
    if (!this.eventBus.isConnected()) return;
    const payload: AdjustmentApprovedV1Payload = {
      adjustmentId: a.adjustmentId,
      enrolmentId: a.enrolmentId,
      personId: a.personId,
      adjustmentTypeCode: a.adjustmentTypeCode,
      scopeCode: a.scopeCode,
      ...(a.amount ? { amount: { value: a.amount.value, unitCode: a.amount.unitCode } } : {}),
      validFrom: a.validFrom.toISOString(),
      ...(a.validTo ? { validTo: a.validTo.toISOString() } : {}),
    };
    await this.eventBus.publish(EVENT_TYPES.ADJUSTMENT_APPROVED, '1.0.0', tenantId, actorId, 'sensitive', payload);
  }

  async #validateInput(tenantId: string, input: RecordAdjustmentInput): Promise<void> {
    const validFrom = new Date(input.validFrom);
    const validTo = input.validTo ? new Date(input.validTo) : null;
    if (Number.isNaN(validFrom.getTime())) {
      throw new ValidationError('Adjustment validFrom must be a valid date-time', [
        { field: 'validFrom', message: 'Must be a valid date-time' },
      ]);
    }
    if (validTo && (Number.isNaN(validTo.getTime()) || validTo <= validFrom)) {
      throw new ValidationError('Adjustment validTo must be after validFrom', [
        { field: 'validTo', message: 'Must be after validFrom' },
      ]);
    }

    await this.#validateFieldValue(tenantId, 'reasonable_adjustment', 'adjustment_type_code', input.adjustmentTypeCode);
    await this.#validateFieldValue(tenantId, 'reasonable_adjustment', 'scope_code', input.scopeCode);
    if (input.amount) {
      await this.#validateFieldValue(tenantId, 'reasonable_adjustment', 'amount_unit_code', input.amount.unitCode);
    }
    validateAmountForType(input.adjustmentTypeCode, input.amount);
  }

  async #validateFieldValue(
    tenantId: string,
    entityName: string,
    fieldName: string,
    value: string,
  ): Promise<void> {
    const isValid = await this.valueSets.validateFieldValue(entityName, fieldName, value, tenantId);
    if (isValid === false) {
      throw new ValidationError(
        `Invalid value '${value}' for ${entityName}.${fieldName}`,
        [{ field: fieldName, message: 'Value is not active in the configured value set' }],
      );
    }
  }

  async #ensurePersonExists(personId: string, tenantId: string): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({ id: persons.id })
        .from(persons)
        .where(
          and(
            eq(persons.id, personId as `${string}-${string}-${string}-${string}-${string}`),
            eq(persons.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        )
        .limit(1),
    );

    if (rows.length === 0) throw new NotFoundError('Person', personId);
  }

  async #ensureEnrolmentBelongsToPerson(
    enrolmentId: string,
    personId: string,
    tenantId: string,
  ): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({ id: enrolments.id })
        .from(enrolments)
        .where(
          and(
            eq(enrolments.id, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(enrolments.personId, personId as `${string}-${string}-${string}-${string}-${string}`),
            eq(enrolments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(enrolments.recordedUntil),
          ),
        )
        .limit(1),
    );

    if (rows.length === 0) throw new NotFoundError('Enrolment', enrolmentId);
  }

  async #getCurrentAdjustment(adjustmentId: string, tenantId: string): Promise<AdjustmentDto> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(reasonableAdjustments)
        .where(
          and(
            eq(reasonableAdjustments.id, adjustmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(reasonableAdjustments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(reasonableAdjustments.recordedUntil),
          ),
        )
        .limit(1),
    );

    const row = rows[0];
    if (!row) throw new NotFoundError('ReasonableAdjustment', adjustmentId);
    return adjustmentToDto(row);
  }

  /**
   * Checks any version (current or historical) exists — deliberately not
   * limited to the current version. listDistributions is a read/history
   * operation and must still work after the adjustment has been expired
   * (expireAdjustment closes the current version with no replacement row),
   * otherwise there would be no way to see that its pending distributions
   * were marked superseded.
   */
  async #ensureAdjustmentExists(adjustmentId: string, tenantId: string): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({ id: reasonableAdjustments.id })
        .from(reasonableAdjustments)
        .where(
          and(
            eq(reasonableAdjustments.id, adjustmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(reasonableAdjustments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        )
        .limit(1),
    );

    if (rows.length === 0) throw new NotFoundError('ReasonableAdjustment', adjustmentId);
  }

  async #getDistribution(
    adjustmentId: string,
    distributionId: string,
    tenantId: string,
  ): Promise<AdjustmentDistributionDto> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(adjustmentDistributions)
        .where(
          and(
            eq(adjustmentDistributions.id, distributionId as `${string}-${string}-${string}-${string}-${string}`),
            eq(adjustmentDistributions.adjustmentId, adjustmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(adjustmentDistributions.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        )
        .limit(1),
    );

    const row = rows[0];
    if (!row) throw new NotFoundError('AdjustmentDistribution', distributionId);
    return distributionToDto(row);
  }

  #targetSystemsForScope(scopeCode: string): string[] {
    return TARGET_SYSTEMS_BY_SCOPE[scopeCode] ?? ['vle', 'attendance', 'exams'];
  }
}

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

/**
 * People reply only for manual targets. A connected or file target's
 * replies belong to its connector (or the SRS's own exchange); a person
 * confirming one by hand would record a delivery no system made.
 */
function assertActorMayReply(distribution: { fulfilmentModeCode: string }, actor: ReplyActor): void {
  if (actor === 'person' && distribution.fulfilmentModeCode !== 'manual') {
    throw new ConflictError(
      `This distribution is fulfilled by a ${distribution.fulfilmentModeCode} target; only its integration can reply`,
    );
  }
}

/** An acknowledgement only applies while the target is still meant to apply it. */
function assertStillApplicable(statusCode: string): void {
  if (statusCode === 'superseded') {
    throw new ConflictError('This distribution was superseded and can no longer be acknowledged');
  }
  if (statusCode === 'withdrawal-requested' || statusCode === 'withdrawn') {
    throw new ConflictError('This adjustment has ended and its withdrawal was requested; remove it rather than acknowledge it');
  }
}

function hashRequest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function adjustmentToDto(row: typeof reasonableAdjustments.$inferSelect): AdjustmentDto {
  return {
    adjustmentId: row.id,
    enrolmentId: row.enrolmentId,
    personId: row.personId,
    adjustmentTypeCode: row.adjustmentTypeCode,
    scopeCode: row.scopeCode,
    amount: amountFromRow(row),
    notes: row.notes,
    actorId: row.actorId,
    validFrom: row.validFrom,
    validTo: row.validTo,
    recordedAt: row.recordedAt,
    recordedUntil: row.recordedUntil,
    sourceCaseId: row.sourceCaseId,
    outcomeDocumentId: row.outcomeDocumentId,
    provenanceCode: row.provenanceCode,
    manualProposalId: row.manualProposalId,
  };
}

function distributionToDto(row: typeof adjustmentDistributions.$inferSelect): AdjustmentDistributionDto {
  return {
    distributionId: row.id,
    adjustmentId: row.adjustmentId,
    targetSystem: row.targetSystem,
    statusCode: row.statusCode,
    distributedAt: row.distributedAt,
    failureReason: row.failureReason,
    fulfilmentModeCode: row.fulfilmentModeCode,
    requestPublishedAt: row.requestPublishedAt,
    withdrawalRequestedAt: row.withdrawalRequestedAt,
    withdrawalPublishedAt: row.withdrawalPublishedAt,
    withdrawnAt: row.withdrawnAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
